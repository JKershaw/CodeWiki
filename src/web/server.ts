/**
 * CodeWiki Web Server.
 *
 * Provides a web interface for managing repositories and browsing wikis.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { createRepositories } from '../repositories/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { createGitService } from '../services/git/git-service.js';
import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createAnthropicLLM } from '../services/llm/anthropic-llm-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import { createOrchestrator } from '../agents/orchestrator/orchestrator.js';
import { createResearchAgent } from '../agents/research/research-agent.js';
import { createSpecAgent } from '../agents/spec/spec-agent.js';
import { createExecutor } from '../executor/executor.js';
import { createRepo } from '../domain/repo.js';
import { v4 as uuid } from 'uuid';
import { getOrCreateActiveWiki, handleCreateWiki, createCreateWikiCommand } from '../commands/create-wiki.js';
import { handleSetActiveWiki, createSetActiveWikiCommand } from '../commands/set-active-wiki.js';
import {
  createRegisterRepositoryCommand,
  handleRegisterRepository,
  createLoadRepositoryCommitsCommand,
  handleLoadRepositoryCommits,
  createUpdateRepositoryStatusCommand,
  handleUpdateRepositoryStatus,
} from '../commands/repository.js';
import {
  createUpdateWikiSettingsCommand,
  handleUpdateWikiSettings,
  createDeleteWikiCommand,
  handleDeleteWiki,
} from '../commands/wiki.js';

const app = express();
const PORT = process.env['PORT'] || 3000;

// Initialize services
const repos = createRepositories({ type: 'file' });
const git = createGitService();

function createLLM(): LLMService {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey) {
    return createAnthropicLLM({ apiKey });
  }
  return createMockLLMForCodeAnalysis();
}

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API Routes

/**
 * List all repositories.
 */
app.get('/api/repos', async (_req: Request, res: Response) => {
  try {
    const allRepos = await repos.repos.findAll();
    const reposWithStatus = await Promise.all(
      allRepos.map(async (repo) => {
        const orchestrator = createOrchestrator(repos);
        const wiki = await getOrCreateActiveWiki(repo.id, repos);
        const allWikis = await repos.wikis.findByRepo(repo.id);
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
app.get('/api/repos/:id', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const orchestrator = createOrchestrator(repos);
    const wiki = await getOrCreateActiveWiki(repo.id, repos);
    const allWikis = await repos.wikis.findByRepo(repo.id);
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
app.post('/api/repos', async (req: Request, res: Response) => {
  try {
    const { path: repoPath } = req.body;
    if (!repoPath) {
      res.status(400).json({ error: 'Repository path is required' });
      return;
    }

    const absolutePath = resolve(repoPath);

    // Check if repo already exists
    let repo = await repos.repos.findByFullName(absolutePath);

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

      // Load commits using simpleGit
      const { simpleGit } = await import('simple-git');
      const gitRepo = simpleGit(absolutePath);
      const log = await gitRepo.log(['--all']);

      const { createCommit } = await import('../domain/commit.js');
      const commits = [];

      for (const entry of log.all) {
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

        commits.push(createCommit({
          id: uuid(),
          repoId: repo.id,
          sha: entry.hash,
          message: entry.message,
          authorName: entry.author_name,
          authorEmail: entry.author_email,
          committedAt: new Date(entry.date),
          diffSummary,
        }));
      }

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
app.post('/api/repos/:id/process', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const iterations = req.body.iterations || 5;
    const llm = createLLM();

    // Register the local repo path
    git.registerLocalRepo(repo.id, repo.fullName);

    // Update status using CQRS command
    await handleUpdateRepositoryStatus(
      createUpdateRepositoryStatusCommand(repo.id, 'processing'),
      repos
    );

    // Create orchestrator and executor
    const orchestrator = createOrchestrator(repos);
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
 * Get processing status for a repository.
 * Returns the active or most recent processing run with iteration details.
 */
app.get('/api/repos/:id/processing', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // Try to find an active processing run first
    let processingRun = await repos.processingRuns.findActive(repo.id);

    // If no active run, get the most recent one
    if (!processingRun) {
      processingRun = await repos.processingRuns.findMostRecent(repo.id);
    }

    if (!processingRun) {
      res.json({ processing: null });
      return;
    }

    // Get iterations for this processing run
    const iterations = await repos.iterations.findByProcessingRun(processingRun.id);

    // Find the currently running iteration (if any)
    const currentIteration = iterations.find(i => i.status === 'running');

    res.json({
      processing: {
        id: processingRun.id,
        status: processingRun.status,
        totalIterations: processingRun.totalIterations,
        completedIterations: processingRun.completedIterations,
        successfulIterations: processingRun.successfulIterations,
        failedIterations: processingRun.failedIterations,
        totalCostUsd: processingRun.totalCostUsd,
        wikiPagesCreated: processingRun.wikiPagesCreated,
        wikiPagesUpdated: processingRun.wikiPagesUpdated,
        startedAt: processingRun.startedAt,
        completedAt: processingRun.completedAt,
        error: processingRun.error,
        currentIteration: currentIteration ? {
          iterationNumber: currentIteration.iterationNumber,
          agentType: currentIteration.agentType,
          startedAt: currentIteration.startedAt,
        } : null,
        iterations: iterations.map(i => ({
          iterationNumber: i.iterationNumber,
          status: i.status,
          agentType: i.agentType,
          durationMs: i.durationMs,
          costUsd: i.costUsd,
          pagesCreated: i.pagesCreated,
          pagesUpdated: i.pagesUpdated,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get wiki pages for a repository.
 * Supports optional ?wikiId query param to get pages for a specific wiki.
 */
app.get('/api/repos/:id/wiki', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // Use specified wiki or active wiki
    let wiki;
    if (req.query.wikiId) {
      wiki = await repos.wikis.findById(req.query.wikiId as string);
      if (!wiki || wiki.repoId !== repo.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
    } else {
      wiki = await getOrCreateActiveWiki(repo.id, repos);
    }
    const pages = await repos.wikiPages.findByWiki(wiki.id);

    // Group by category (first part of path)
    const grouped: Record<string, typeof pages> = {};
    for (const page of pages) {
      const category = page.path.split('/')[0] || 'uncategorized';
      if (!grouped[category]) grouped[category] = [];
      grouped[category]!.push(page);
    }

    res.json({ pages, grouped });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get a specific wiki page.
 * Supports optional ?wikiId query param to get page from a specific wiki.
 */
app.get('/api/repos/:id/wiki/:path(*)', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // Use specified wiki or active wiki
    let wiki;
    if (req.query.wikiId) {
      wiki = await repos.wikis.findById(req.query.wikiId as string);
      if (!wiki || wiki.repoId !== repo.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
    } else {
      wiki = await getOrCreateActiveWiki(repo.id, repos);
    }
    const page = await repos.wikiPages.findByPath(wiki.id, req.params.path!);
    if (!page) {
      res.status(404).json({ error: 'Wiki page not found' });
      return;
    }

    res.json(page);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Query the wiki.
 */
app.post('/api/repos/:id/query', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const { question } = req.body;
    if (!question) {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const llm = createLLM();
    const research = createResearchAgent(repos, llm);
    const wiki = await getOrCreateActiveWiki(repo.id, repos);
    const result = await research.query(wiki.id, question);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Generate a spec for a coding agent task.
 */
app.post('/api/repos/:id/spec', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const { task } = req.body;
    if (!task) {
      res.status(400).json({ error: 'Task description is required' });
      return;
    }

    const llm = createLLM();
    const specAgent = createSpecAgent(repos, llm);
    const wiki = await getOrCreateActiveWiki(repo.id, repos);
    const result = await specAgent.generateSpec(wiki.id, task);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get commits for a repository.
 */
app.get('/api/repos/:id/commits', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const commits = await repos.commits.findByRepo(repo.id);
    res.json(commits);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Browse filesystem directories.
 * Restricted to home directory and subdirectories for security.
 */
app.get('/api/filesystem/browse', async (req: Request, res: Response) => {
  try {
    const home = homedir();
    const requestedPath = (req.query.path as string) || home;
    const absolutePath = resolve(requestedPath);

    // Security: only allow browsing within home directory
    if (!absolutePath.startsWith(home) && absolutePath !== home) {
      res.status(403).json({ error: 'Access denied: can only browse within home directory' });
      return;
    }

    // Check if path exists and is a directory
    const pathStat = await stat(absolutePath);
    if (!pathStat.isDirectory()) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    // Read directory contents
    const entries = await readdir(absolutePath, { withFileTypes: true });

    // Filter to directories only and check for git repos
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = join(absolutePath, entry.name);
        const isGitRepo = existsSync(join(fullPath, '.git'));
        return {
          name: entry.name,
          path: fullPath,
          isGitRepo,
        };
      })
      .sort((a, b) => {
        // Git repos first, then alphabetical
        if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // Get parent directory (null if at home or root)
    const parent = absolutePath === '/' || absolutePath === home ? null : dirname(absolutePath);

    res.json({
      currentPath: absolutePath,
      parent,
      directories,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============ Wiki Management API ============

/**
 * List all wikis for a repository.
 */
app.get('/api/repos/:id/wikis', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const wikis = await repos.wikis.findByRepo(repo.id);
    res.json(wikis);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Create a new wiki for a repository.
 */
app.post('/api/repos/:id/wikis', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const { name, description, branchFilter, pathFilters, setActive } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Wiki name is required' });
      return;
    }

    const command = createCreateWikiCommand({
      repoId: repo.id,
      name,
      description,
      branchFilter,
      pathFilters,
      setActive: setActive ?? false,
    });

    const result = await handleCreateWiki(command, repos);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json(result.data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get a specific wiki with stats.
 */
app.get('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
  try {
    const wiki = await repos.wikis.findById(req.params.wikiId!);
    if (!wiki || wiki.repoId !== req.params.id) {
      res.status(404).json({ error: 'Wiki not found' });
      return;
    }

    const pages = await repos.wikiPages.findByWiki(wiki.id);

    res.json({
      ...wiki,
      stats: {
        pageCount: pages.length,
        avgConfidence: pages.length > 0
          ? pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length
          : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Update a wiki's settings.
 */
app.put('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
  try {
    const wiki = await repos.wikis.findById(req.params.wikiId!);
    if (!wiki || wiki.repoId !== req.params.id) {
      res.status(404).json({ error: 'Wiki not found' });
      return;
    }

    const { name, description, branchFilter, pathFilters } = req.body;

    // Use UpdateWikiSettings CQRS command
    const result = await handleUpdateWikiSettings(
      createUpdateWikiSettingsCommand(wiki.id, {
        name,
        description,
        branchFilter,
        pathFilters,
      }),
      repos
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Fetch updated wiki to return
    const updatedWiki = await repos.wikis.findById(wiki.id);
    res.json(updatedWiki);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Delete a wiki.
 */
app.delete('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
  try {
    const wiki = await repos.wikis.findById(req.params.wikiId!);
    if (!wiki || wiki.repoId !== req.params.id) {
      res.status(404).json({ error: 'Wiki not found' });
      return;
    }

    // Use DeleteWiki CQRS command (handles active check and page deletion)
    const result = await handleDeleteWiki(
      createDeleteWikiCommand(wiki.id),
      repos
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Set a wiki as active.
 */
app.post('/api/repos/:id/wikis/:wikiId/activate', async (req: Request, res: Response) => {
  try {
    const wiki = await repos.wikis.findById(req.params.wikiId!);
    if (!wiki || wiki.repoId !== req.params.id) {
      res.status(404).json({ error: 'Wiki not found' });
      return;
    }

    const command = createSetActiveWikiCommand(wiki.id);
    const result = await handleSetActiveWiki(command, repos);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Serve index.html for all non-API routes (SPA support)
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server
export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`CodeWiki web server running at http://localhost:${port}`);
  });
}

// Export for testing
export { app };

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
