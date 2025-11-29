/**
 * CodeWiki Web Server.
 *
 * Provides a web interface for managing repositories and browsing wikis.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRepositories } from '../repositories/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { createGitService } from '../services/git/git-service.js';
import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createAnthropicLLM } from '../services/llm/anthropic-llm-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import { createOrchestrator } from '../agents/orchestrator/orchestrator.js';
import { createResearchAgent } from '../agents/research/research-agent.js';
import { createExecutor } from '../executor/executor.js';
import { createRepo } from '../domain/repo.js';
import { v4 as uuid } from 'uuid';

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
        const summary = await orchestrator.getWorkSummary(repo.id);
        return {
          id: repo.id,
          fullName: repo.fullName,
          status: repo.status,
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
    const summary = await orchestrator.getWorkSummary(repo.id);

    res.json({
      id: repo.id,
      fullName: repo.fullName,
      status: repo.status,
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
      // Create new repo record
      repo = createRepo({
        id: uuid(),
        fullName: absolutePath,
        cloneUrl: absolutePath,
        defaultBranch: 'main',
      });
      repo.status = 'pending';
      await repos.repos.save(repo);

      // Load commits
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

      await repos.commits.saveMany(commits);
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

    // Update status
    repo.status = 'processing';
    await repos.repos.save(repo);

    // Create orchestrator and executor
    const orchestrator = createOrchestrator(repos);
    const executor = createExecutor(repos, git, llm, orchestrator);

    // Run in background (don't await)
    executor.runIterations(repo.id, iterations).then(async (result) => {
      repo.status = 'ready';
      await repos.repos.save(repo);
      console.log(`Processing complete for ${repo.fullName}:`, result);
    }).catch(async (error) => {
      repo.status = 'error';
      await repos.repos.save(repo);
      console.error(`Processing failed for ${repo.fullName}:`, error);
    });

    res.json({ message: 'Processing started', iterations });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get wiki pages for a repository.
 */
app.get('/api/repos/:id/wiki', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const pages = await repos.wikiPages.findByRepo(repo.id);

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
 */
app.get('/api/repos/:id/wiki/:path(*)', async (req: Request, res: Response) => {
  try {
    const repo = await repos.repos.findById(req.params.id!);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const page = await repos.wikiPages.findByPath(repo.id, req.params.path!);
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
    const result = await research.query(repo.id, question);

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
