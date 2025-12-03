/**
 * Repository management routes.
 */

import { Router, type Request, type Response } from 'express';
import { resolve } from 'path';
import { v4 as uuid } from 'uuid';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import {
  createRegisterRepositoryCommand,
  handleRegisterRepository,
  createLoadRepositoryCommitsCommand,
  handleLoadRepositoryCommits,
  createUpdateRepositoryStatusCommand,
  handleUpdateRepositoryStatus,
} from '../../commands/repository.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { createExecutor } from '../../executor/executor.js';
import type { Dependencies } from './index.js';
import type { GitAuthOptions } from '../../services/git/git-service.js';
import { GITHUB_SESSION_COOKIE } from '../middleware/github-auth.js';

/**
 * Validate a GitHub URL.
 * Accepts formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - http://github.com/owner/repo
 */
export function isValidGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return false;
    // Path should be /owner/repo or /owner/repo.git
    const pathMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
    return pathMatch !== null;
  } catch {
    return false;
  }
}

/**
 * Extract owner/repo from GitHub URL.
 */
export function extractRepoNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
    if (pathMatch) {
      return `${pathMatch[1]}/${pathMatch[2]}`;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Normalize GitHub URL to https format with .git extension.
 */
export function normalizeGitHubUrl(url: string): string {
  const parsed = new URL(url);
  const pathMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (pathMatch) {
    return `https://github.com/${pathMatch[1]}/${pathMatch[2]}.git`;
  }
  return url;
}

// Import CQRS queries
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createGetRepositoryByFullNameQuery,
  handleGetRepositoryByFullName,
  createListRepositoriesQuery,
  handleListRepositories,
  createListWikisQuery,
  handleListWikis,
  createListCommitsQuery,
  handleListCommits,
} from '../../queries/index.js';

/**
 * Helper to extract GitHub auth options from request if user is authenticated.
 */
async function getGitAuthFromRequest(
  req: Request,
  deps: Dependencies
): Promise<GitAuthOptions | undefined> {
  const { repos, jwtService } = deps;

  // No JWT service means no auth available
  if (!jwtService) {
    return undefined;
  }

  // Try to get session from signed cookie
  const signedCookies = req.signedCookies as Record<string, string>;
  const token = signedCookies[GITHUB_SESSION_COOKIE];
  if (!token) {
    return undefined;
  }

  // Verify the session token
  const session = jwtService.verifySessionToken(token);
  if (!session) {
    return undefined;
  }

  // Look up user to get access token
  const user = await repos.users.findById(session.userId);
  if (!user || !user.accessToken) {
    return undefined;
  }

  // Return auth options for GitHub (x-access-token is the standard username for token auth)
  return {
    username: 'x-access-token',
    password: user.accessToken,
  };
}

/**
 * Create repository management routes.
 */
export function createReposRoutes(deps: Dependencies): Router {
  const { repos, git, createLLM } = deps;
  const router = Router();

  /**
   * List all repositories.
   */
  router.get('/api/repos', async (_req: Request, res: Response) => {
    try {
      // Use CQRS query to list repositories
      const listQuery = createListRepositoriesQuery();
      const listResult = await handleListRepositories(listQuery, repos);
      const allRepos = listResult.data || [];

      const reposWithStatus = await Promise.all(
        allRepos.map(async (repo) => {
          const orchestrator = createOrchestrator(repos);
          const wiki = await getOrCreateActiveWiki(repo.id, repos);
          // Use CQRS query to list wikis
          const wikisQuery = createListWikisQuery(repo.id);
          const wikisResult = await handleListWikis(wikisQuery, repos);
          const allWikis = wikisResult.data || [];
          const summary = await orchestrator.getWorkSummary(repo.id, wiki.id);
          return {
            id: repo.id,
            fullName: repo.fullName,
            status: repo.status,
            activeWiki: {
              id: wiki.id,
              name: wiki.name,
              slug: wiki.slug,
            },
            wikiCount: allWikis.length,
            ...summary,
          };
        })
      );
      res.json(reposWithStatus);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Get repository details.
   */
  router.get('/api/repos/:id', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      const orchestrator = createOrchestrator(repos);
      const wiki = await getOrCreateActiveWiki(repo.id, repos);
      // Use CQRS query to list wikis
      const wikisQuery = createListWikisQuery(repo.id);
      const wikisResult = await handleListWikis(wikisQuery, repos);
      const allWikis = wikisResult.data || [];
      const summary = await orchestrator.getWorkSummary(repo.id, wiki.id);

      res.json({
        id: repo.id,
        fullName: repo.fullName,
        status: repo.status,
        activeWiki: {
          id: wiki.id,
          name: wiki.name,
          slug: wiki.slug,
        },
        wikiCount: allWikis.length,
        ...summary,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Add a new repository for processing.
   * Accepts either:
   * - { path: string } for local filesystem repositories
   * - { url: string } for GitHub repositories (will be cloned)
   */
  router.post('/api/repos', async (req: Request, res: Response) => {
    try {
      const { path: repoPath, url: repoUrl } = req.body;

      // Determine if this is a local path or GitHub URL
      const isGitHubRepo = !!repoUrl;

      if (!repoPath && !repoUrl) {
        res.status(400).json({ error: 'Repository path or URL is required' });
        return;
      }

      let absolutePath: string;
      let fullName: string;
      let cloneUrl: string;

      if (isGitHubRepo) {
        // Validate GitHub URL
        if (!isValidGitHubUrl(repoUrl)) {
          res.status(400).json({ error: 'Invalid GitHub URL. Must be in format: https://github.com/owner/repo' });
          return;
        }

        // Extract repo name from URL
        const extractedName = extractRepoNameFromUrl(repoUrl);
        if (!extractedName) {
          res.status(400).json({ error: 'Could not extract repository name from URL' });
          return;
        }

        fullName = extractedName;
        cloneUrl = normalizeGitHubUrl(repoUrl);

        // Check if repo already exists by fullName
        const existingQuery = createGetRepositoryByFullNameQuery(fullName);
        const existingResult = await handleGetRepositoryByFullName(existingQuery, repos);

        if (existingResult.data) {
          // Repository already exists, return it
          res.json({
            id: existingResult.data.id,
            fullName: existingResult.data.fullName,
            status: existingResult.data.status,
          });
          return;
        }

        // Clone the repository
        const repoId = uuid();
        try {
          // Get authentication if user is logged in
          const auth = await getGitAuthFromRequest(req, deps);
          absolutePath = await git.clone(cloneUrl, repoId, auth);
        } catch (cloneError) {
          const errorMessage = cloneError instanceof Error ? cloneError.message : String(cloneError);
          // Check for common clone errors
          if (errorMessage.includes('not found') || errorMessage.includes('404')) {
            res.status(404).json({ error: 'Repository not found. Make sure it exists and is public.' });
          } else if (errorMessage.includes('Authentication') || errorMessage.includes('403')) {
            res.status(403).json({ error: 'Repository is private or requires authentication. Log in with GitHub to access private repositories.' });
          } else {
            res.status(500).json({ error: `Failed to clone repository: ${errorMessage}` });
          }
          return;
        }

        // Register the repository
        const registerResult = await handleRegisterRepository(
          createRegisterRepositoryCommand({
            id: repoId,
            fullName,
            cloneUrl,
            defaultBranch: 'main',
          }),
          repos
        );

        if (!registerResult.success) {
          res.status(400).json({ error: registerResult.error });
          return;
        }

        const repo = registerResult.data!;

        // Load commits using GitService
        git.registerLocalRepo(repo.id, absolutePath);
        const commits = await git.loadCommits(repo.id);

        await handleLoadRepositoryCommits(
          createLoadRepositoryCommitsCommand(repo.id, commits),
          repos
        );

        res.json({ id: repo.id, fullName: repo.fullName, status: repo.status });
      } else {
        // Local repository path
        absolutePath = resolve(repoPath);
        fullName = absolutePath;
        cloneUrl = absolutePath;

        // Check if repo already exists (via CQRS query)
        const repoQuery = createGetRepositoryByFullNameQuery(absolutePath);
        const repoResult = await handleGetRepositoryByFullName(repoQuery, repos);
        let repo = repoResult.data ?? null;

        if (!repo) {
          // Use RegisterRepository command
          const repoId = uuid();
          const registerResult = await handleRegisterRepository(
            createRegisterRepositoryCommand({
              id: repoId,
              fullName: absolutePath,
              cloneUrl: absolutePath,
              defaultBranch: 'main',
            }),
            repos
          );

          if (!registerResult.success) {
            res.status(400).json({ error: registerResult.error });
            return;
          }
          repo = registerResult.data!;

          // Load commits using GitService
          git.registerLocalRepo(repo.id, absolutePath);
          const commits = await git.loadCommits(repo.id);

          // Use LoadRepositoryCommits command
          await handleLoadRepositoryCommits(
            createLoadRepositoryCommitsCommand(repo.id, commits),
            repos
          );
        }

        res.json({ id: repo.id, fullName: repo.fullName, status: repo.status });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Start processing a repository.
   */
  router.post('/api/repos/:id/process', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      const iterations = req.body.iterations || 5;
      const llm = createLLM();

      // Register the local repo path
      git.registerLocalRepo(repo.id, repo.fullName);

      // Update status using CQRS command
      await handleUpdateRepositoryStatus(
        createUpdateRepositoryStatusCommand(repo.id, 'processing'),
        repos
      );

      // Create orchestrator and executor (uses LLM-powered orchestration)
      const orchestrator = createOrchestrator(repos, llm, { useLLM: true });
      const executor = createExecutor(repos, git, llm, orchestrator);

      // Run in background (don't await)
      executor.runIterations(repo.id, iterations).then(async (result) => {
        await handleUpdateRepositoryStatus(
          createUpdateRepositoryStatusCommand(repo.id, 'ready'),
          repos
        );
        console.log(`Processing complete for ${repo.fullName}:`, result);
      }).catch(async (error) => {
        await handleUpdateRepositoryStatus(
          createUpdateRepositoryStatusCommand(repo.id, 'error'),
          repos
        );
        console.error(`Processing failed for ${repo.fullName}:`, error);
      });

      res.json({ message: 'Processing started', iterations });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Get commits for a repository.
   */
  router.get('/api/repos/:id/commits', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Use CQRS query to get commits
      const commitsQuery = createListCommitsQuery(repo.id);
      const commitsResult = await handleListCommits(commitsQuery, repos);
      res.json(commitsResult.data || []);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
