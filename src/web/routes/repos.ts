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
import { createConcurrencyLimiter } from '../../utils/concurrency-limiter.js';

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
   */
  router.post('/api/repos', async (req: Request, res: Response) => {
    try {
      const { path: repoPath } = req.body;
      if (!repoPath) {
        res.status(400).json({ error: 'Repository path is required' });
        return;
      }

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
          }),
          repos
        );

        if (!registerResult.success) {
          res.status(400).json({ error: registerResult.error });
          return;
        }
        repo = registerResult.data!;
        // repoId is already declared above and equals repo.id

        // Load commits using simpleGit
        const { simpleGit } = await import('simple-git');
        const gitRepo = simpleGit(absolutePath);
        const log = await gitRepo.log(['--all']);

        const { createCommit } = await import('../../domain/commit.js');

        // Process commits in parallel with concurrency limit to avoid overwhelming git
        const limit = createConcurrencyLimiter(10);

        const commits = await Promise.all(
          log.all.map((entry) =>
            limit(async () => {
              let diffSummary = {
                filesAdded: 0,
                filesModified: 0,
                filesDeleted: 0,
                linesAdded: 0,
                linesDeleted: 0,
                affectedFiles: [] as string[],
              };

              try {
                const diffFiles = await gitRepo.diff([`${entry.hash}^`, entry.hash, '--name-status']);
                const lines = diffFiles.trim().split('\n').filter((l: string) => l.length > 0);

                for (const line of lines) {
                  const [status, ...pathParts] = line.split('\t');
                  const filePath = pathParts.join('\t');
                  if (filePath) diffSummary.affectedFiles.push(filePath);

                  switch (status?.[0]) {
                    case 'A': diffSummary.filesAdded++; break;
                    case 'D': diffSummary.filesDeleted++; break;
                    default: diffSummary.filesModified++; break;
                  }
                }
              } catch {
                // Initial commit or error
              }

              return createCommit({
                id: uuid(),
                repoId,
                sha: entry.hash,
                message: entry.message,
                authorName: entry.author_name,
                authorEmail: entry.author_email,
                committedAt: new Date(entry.date),
                diffSummary,
              });
            })
          )
        );

        // Use LoadRepositoryCommits command
        await handleLoadRepositoryCommits(
          createLoadRepositoryCommitsCommand(repo.id, commits),
          repos
        );
      }

      res.json({ id: repo.id, fullName: repo.fullName, status: repo.status });
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
