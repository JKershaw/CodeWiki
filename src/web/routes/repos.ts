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
  createDeleteRepositoryCommand,
  handleDeleteRepository,
} from '../../commands/repository.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { createExecutor } from '../../executor/executor.js';
import { createUnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import type { Dependencies } from './index.js';
import { GITHUB_SESSION_COOKIE } from '../middleware/github-auth.js';
import { createGitHubRepoService, type GitHubRepoService } from '../../services/github/github-repo-service.js';
import { createGitHubApiCache, createCachedGitHubRepoService } from '../../services/github/github-api-cache.js';
import { ensureValidToken, TokenRefreshError } from '../../services/github/token-refresh.js';

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
 * Get the user ID from the current request session.
 * Returns undefined if user is not authenticated.
 */
async function getUserIdFromRequest(
  req: Request,
  deps: Dependencies
): Promise<string | undefined> {
  const { jwtService } = deps;

  if (!jwtService) {
    return undefined;
  }

  const signedCookies = req.signedCookies as Record<string, string>;
  const token = signedCookies[GITHUB_SESSION_COOKIE];
  if (!token) {
    return undefined;
  }

  const session = jwtService.verifySessionToken(token);
  if (!session) {
    return undefined;
  }

  return session.userId;
}

/**
 * Get an authenticated GitHub repo service for the current request.
 * Returns undefined if user is not authenticated.
 * Automatically refreshes expired tokens if possible.
 */
async function getAuthenticatedGitHubService(
  req: Request,
  deps: Dependencies
): Promise<GitHubRepoService | undefined> {
  const { repos, jwtService, githubAuthService } = deps;

  if (!jwtService) {
    return undefined;
  }

  const signedCookies = req.signedCookies as Record<string, string>;
  const token = signedCookies[GITHUB_SESSION_COOKIE];
  if (!token) {
    return undefined;
  }

  const session = jwtService.verifySessionToken(token);
  if (!session) {
    return undefined;
  }

  const user = await repos.users.findById(session.userId);
  if (!user || !user.accessToken) {
    return undefined;
  }

  // Ensure token is valid (refresh if expired)
  let accessToken = user.accessToken;
  if (githubAuthService) {
    try {
      const result = await ensureValidToken(user, githubAuthService, repos.users);
      accessToken = result.accessToken;
    } catch (error) {
      if (error instanceof TokenRefreshError) {
        console.warn(`Token refresh failed for user ${user.login}: ${error.message}`);
        return undefined;
      }
      throw error;
    }
  }

  // Create an authenticated service with user's token
  const cache = createGitHubApiCache();
  const baseService = createGitHubRepoService({ accessToken });
  return createCachedGitHubRepoService(baseService, cache);
}

/**
 * Extract owner and repo name from a GitHub URL.
 */
function extractOwnerAndRepo(url: string): { owner: string; repo: string } | null {
  const fullName = extractRepoNameFromUrl(url);
  if (!fullName) return null;

  const parts = fullName.split('/');
  if (parts.length !== 2) return null;

  return { owner: parts[0]!, repo: parts[1]! };
}

/**
 * Create repository management routes.
 */
export function createReposRoutes(deps: Dependencies): Router {
  const { repos, git, createLLM } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos:
   *   get:
   *     summary: List all repositories
   *     description: Retrieves a list of all registered repositories with their status, active wiki information, and work summary
   *     tags: [Repositories]
   *     responses:
   *       200:
   *         description: Array of repositories
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: string
   *                     description: Repository unique identifier
   *                   fullName:
   *                     type: string
   *                     description: Repository full name (e.g., owner/repo or local path)
   *                   status:
   *                     type: string
   *                     enum: [pending, processing, ready, error]
   *                     description: Current processing status
   *                   activeWiki:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       slug:
   *                         type: string
   *                   wikiCount:
   *                     type: number
   *                     description: Number of wikis for this repository
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
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
   * @swagger
   * /api/repos/{id}:
   *   get:
   *     summary: Get repository details
   *     description: Retrieves detailed information about a specific repository including status, active wiki, and work summary
   *     tags: [Repositories]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository unique identifier
   *     responses:
   *       200:
   *         description: Repository details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   description: Repository unique identifier
   *                 fullName:
   *                   type: string
   *                   description: Repository full name (e.g., owner/repo or local path)
   *                 status:
   *                   type: string
   *                   enum: [pending, processing, ready, error]
   *                   description: Current processing status
   *                 activeWiki:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     name:
   *                       type: string
   *                     slug:
   *                       type: string
   *                 wikiCount:
   *                   type: number
   *                   description: Number of wikis for this repository
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
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
   * @swagger
   * /api/repos:
   *   post:
   *     summary: Add a new repository
   *     description: Registers a new repository for processing. Accepts either a local filesystem path or a GitHub URL. For GitHub repositories, the API will verify access and load commits.
   *     tags: [Repositories]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             oneOf:
   *               - type: object
   *                 properties:
   *                   path:
   *                     type: string
   *                     description: Absolute path to a local Git repository
   *                 required:
   *                   - path
   *               - type: object
   *                 properties:
   *                   url:
   *                     type: string
   *                     description: GitHub repository URL (e.g., https://github.com/owner/repo)
   *                 required:
   *                   - url
   *     responses:
   *       200:
   *         description: Repository added successfully (or already exists)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   description: Repository unique identifier
   *                 fullName:
   *                   type: string
   *                   description: Repository full name (e.g., owner/repo or local path)
   *                 status:
   *                   type: string
   *                   enum: [pending, processing, ready, error]
   *                   description: Current processing status
   *       400:
   *         description: Bad request (missing path/url, invalid GitHub URL, or registration error)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       403:
   *         description: Repository is private or requires authentication
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       404:
   *         description: GitHub repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
  /**
   * Add a new repository for processing.
   * Accepts either:
   * - { path: string } for local filesystem repositories
   * - { url: string } for GitHub repositories (accessed via GitHub API)
   */
  router.post('/api/repos', async (req: Request, res: Response) => {
    try {
      const { path: repoPath, url: repoUrl } = req.body;

      // Determine if this is a local path or GitHub URL
      const isGitHubRepoUrl = !!repoUrl;

      if (!repoPath && !repoUrl) {
        res.status(400).json({ error: 'Repository path or URL is required' });
        return;
      }

      if (isGitHubRepoUrl) {
        // Validate GitHub URL
        if (!isValidGitHubUrl(repoUrl)) {
          res.status(400).json({ error: 'Invalid GitHub URL. Must be in format: https://github.com/owner/repo' });
          return;
        }

        // Extract owner/repo from URL
        const ownerRepo = extractOwnerAndRepo(repoUrl);
        if (!ownerRepo) {
          res.status(400).json({ error: 'Could not extract repository name from URL' });
          return;
        }

        const { owner, repo: repoName } = ownerRepo;
        const fullName = `${owner}/${repoName}`;
        const cloneUrl = normalizeGitHubUrl(repoUrl);

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

        // Get GitHub service (authenticated if user is logged in, or public access)
        const authGitHubService = await getAuthenticatedGitHubService(req, deps);
        const githubService = authGitHubService ?? deps.githubRepoService ?? createGitHubRepoService();

        // Get the user ID if authenticated (for background processing)
        const userId = await getUserIdFromRequest(req, deps);

        // Verify the repository exists and get info via GitHub API
        const repoId = uuid();
        let defaultBranch = 'main';

        try {
          const repoInfo = await githubService.getRepository(owner, repoName);
          defaultBranch = repoInfo.defaultBranch;
        } catch (apiError) {
          const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
          if (errorMessage.includes('404')) {
            res.status(404).json({ error: 'Repository not found. Make sure it exists and is public.' });
          } else if (errorMessage.includes('403') || errorMessage.includes('401')) {
            res.status(403).json({ error: 'Repository is private or requires authentication. Log in with GitHub to access private repositories.' });
          } else {
            res.status(500).json({ error: `Failed to access repository: ${errorMessage}` });
          }
          return;
        }

        // Register the repository (no local clone needed)
        // Include userId so background processing can use user's auth token
        const registerResult = await handleRegisterRepository(
          createRegisterRepositoryCommand({
            id: repoId,
            fullName,
            cloneUrl,
            defaultBranch,
            owner,
            repoName,
            isGitHubRepo: true,
            ...(userId && { userId }),
          }),
          repos
        );

        if (!registerResult.success) {
          res.status(400).json({ error: registerResult.error });
          return;
        }

        const registeredRepo = registerResult.data!;

        // Load commits using GitHub API
        try {
          const commits = await githubService.listCommits(owner, repoName, registeredRepo.id, { limit: 100 });

          await handleLoadRepositoryCommits(
            createLoadRepositoryCommitsCommand(registeredRepo.id, commits),
            repos
          );
        } catch (commitError) {
          console.warn(`Failed to load commits for ${fullName}:`, commitError);
          // Continue even if commits fail - the repo is still registered
        }

        res.json({ id: registeredRepo.id, fullName: registeredRepo.fullName, status: registeredRepo.status });
      } else {
        // Local repository path
        const absolutePath = resolve(repoPath);

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
              isGitHubRepo: false,
            }),
            repos
          );

          if (!registerResult.success) {
            res.status(400).json({ error: registerResult.error });
            return;
          }
          repo = registerResult.data!;

          // Load commits using GitService (for local repos)
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
   * @swagger
   * /api/repos/{id}/process:
   *   post:
   *     summary: Start processing a repository
   *     description: Initiates background processing of a repository to generate wiki content. The orchestrator will analyze the codebase and create documentation pages. Processing runs asynchronously.
   *     tags: [Repositories]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository unique identifier
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               iterations:
   *                 type: number
   *                 default: 5
   *                 description: Number of processing iterations to run
   *     responses:
   *       200:
   *         description: Processing started successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Processing started
   *                 iterations:
   *                   type: number
   *                   description: Number of iterations that will be executed
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
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

      // Create unified repo access factory for orchestrator
      const repoAccessFactory = deps.repoServiceFactory
        ? createUnifiedRepoAccessFactory({
            repos,
            repoServiceFactory: deps.repoServiceFactory,
            gitService: git,
          })
        : undefined;

      // Create orchestrator and executor (uses LLM-powered orchestration)
      const orchestrator = createOrchestrator(repos, llm, { useLLM: true }, repoAccessFactory);
      const executor = createExecutor(repos, git, llm, orchestrator, deps.repoServiceFactory);

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
   * @swagger
   * /api/repos/{id}/commits:
   *   get:
   *     summary: Get commits for a repository
   *     description: Retrieves the list of commits for the specified repository
   *     tags: [Repositories]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository unique identifier
   *     responses:
   *       200:
   *         description: Array of commits
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   sha:
   *                     type: string
   *                     description: Commit SHA hash
   *                   message:
   *                     type: string
   *                     description: Commit message
   *                   author:
   *                     type: string
   *                     description: Commit author
   *                   date:
   *                     type: string
   *                     format: date-time
   *                     description: Commit date
   *                   repositoryId:
   *                     type: string
   *                     description: Repository ID this commit belongs to
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
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

  /**
   * @swagger
   * /api/repos/{id}:
   *   delete:
   *     summary: Delete a repository
   *     description: Deletes a repository and all associated data including wikis, pages, commits, and work items. This operation cannot be undone.
   *     tags: [Repositories]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository unique identifier
   *     responses:
   *       204:
   *         description: Repository deleted successfully (no content)
   *       400:
   *         description: Bad request (deletion error)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
  /**
   * Delete a repository and all associated data.
   */
  router.delete('/api/repos/:id', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to verify repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Use DeleteRepository command to delete the repo and all associated data
      const deleteResult = await handleDeleteRepository(
        createDeleteRepositoryCommand(req.params.id!),
        repos
      );

      if (!deleteResult.success) {
        res.status(400).json({ error: deleteResult.error });
        return;
      }

      // Return 204 No Content on successful deletion
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
