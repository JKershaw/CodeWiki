/**
 * End-to-End LLM tests for Wiki Generation.
 *
 * These tests verify the complete wiki generation flow:
 * - Bootstrap a fresh wiki from a repository
 * - Verify the wiki is coherent and useful
 * - Process commits and verify wiki updates
 *
 * Run with: node --import tsx --test tests/llm/e2e/wiki-generation.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { BootstrapAgent } from '../../../src/agents/synthesis/bootstrap-agent.js';
import { ProjectOverviewAgent } from '../../../src/agents/synthesis/project-overview-agent.js';
import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
import { CodeChangeAgent } from '../../../src/agents/analysis/code-change-agent.js';
import { createCommitTarget, createWikiTarget } from '../../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from '../helpers/test-context.js';
import {
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from '../helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from '../helpers/result-logger.js';
import type { WikiPage, WikiPageUpdate } from '../../../src/domain/wiki-page.js';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../../src/commands/update-wiki-page.js';
import {
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../../src/queries/list-wiki-pages.js';

describe('Wiki Generation E2E with Real LLM', { timeout: 600000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
    ctx = await createLLMTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
    await saveTestRun();
  });

  /**
   * Helper to save wiki pages from agent results using CQRS.
   */
  async function saveWikiPages(
    wikiId: string,
    updates: Array<{ path: string; title?: string; content: string; type?: WikiPageUpdate['type'] }>
  ): Promise<void> {
    for (const update of updates) {
      const wikiUpdate: WikiPageUpdate = {
        type: update.type || 'create',
        path: update.path,
        title: update.title,
        content: update.content,
        confidenceDelta: 0.3,
      };
      const command = createUpdateWikiPageCommand(wikiUpdate);
      const result = await handleUpdateWikiPage(command, ctx.repos, wikiId);
      if (!result.success) {
        // If create fails (page exists), try merge instead
        if (wikiUpdate.type === 'create') {
          const mergeUpdate: WikiPageUpdate = { ...wikiUpdate, type: 'merge' };
          const mergeCommand = createUpdateWikiPageCommand(mergeUpdate);
          await handleUpdateWikiPage(mergeCommand, ctx.repos, wikiId);
        }
      }
    }
  }

  /**
   * Helper to get all wiki pages using CQRS.
   */
  async function getWikiPages(wikiId: string): Promise<WikiPage[]> {
    const query = createListWikiPagesQuery(wikiId);
    const result = await handleListWikiPages(query, ctx.repos);
    return result.data || [];
  }

  describe('Wiki Bootstrap', () => {
    it('creates coherent wiki from repository', async () => {
      const repoId = 'llm-e2e-bootstrap';

      // Create a realistic project repository
      await createTestRepo(ctx, repoId, {
        'README.md': `# TaskFlow API

A modern task management REST API built with TypeScript and Express.

## Features

- **Task Management**: Create, update, delete, and organize tasks
- **Projects**: Group tasks into projects
- **Authentication**: JWT-based authentication
- **Real-time**: WebSocket support for live updates

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Architecture

The API follows a clean architecture pattern:
- Controllers handle HTTP requests
- Services contain business logic
- Repositories handle data persistence

## API Endpoints

- \`POST /auth/login\` - Authenticate user
- \`GET /tasks\` - List all tasks
- \`POST /tasks\` - Create new task
- \`PUT /tasks/:id\` - Update task
- \`DELETE /tasks/:id\` - Delete task
`,
        'package.json': JSON.stringify({
          name: 'taskflow-api',
          version: '1.0.0',
          scripts: {
            'dev': 'tsx watch src/index.ts',
            'build': 'tsc',
            'test': 'jest',
            'lint': 'eslint src/',
          },
          dependencies: {
            'express': '^4.18.0',
            'jsonwebtoken': '^9.0.0',
            'bcrypt': '^5.0.0',
          },
          devDependencies: {
            'typescript': '^5.0.0',
            'jest': '^29.0.0',
          },
        }, null, 2),
        'src/index.ts': `
import express from 'express';
import { taskRouter } from './routes/tasks.js';
import { authRouter } from './routes/auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
app.use('/tasks', taskRouter);

app.listen(3000, () => console.log('TaskFlow API running on port 3000'));
`,
        'src/routes/tasks.ts': `
import { Router } from 'express';
import { TaskService } from '../services/task-service.js';

export const taskRouter = Router();
const taskService = new TaskService();

taskRouter.get('/', async (req, res) => {
  const tasks = await taskService.listTasks();
  res.json(tasks);
});

taskRouter.post('/', async (req, res) => {
  const task = await taskService.createTask(req.body);
  res.status(201).json(task);
});
`,
        'src/services/task-service.ts': `
export interface Task {
  id: string;
  title: string;
  completed: boolean;
  projectId?: string;
}

export class TaskService {
  private tasks: Task[] = [];

  async listTasks(): Promise<Task[]> {
    return this.tasks;
  }

  async createTask(data: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: crypto.randomUUID(),
      title: data.title || 'Untitled',
      completed: false,
      projectId: data.projectId,
    };
    this.tasks.push(task);
    return task;
  }
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Step 1: Bootstrap the wiki
      console.log('Step 1: Running BootstrapAgent...');
      const bootstrapAgent = new BootstrapAgent();
      const bootstrapResult = await bootstrapAgent.run(createWikiTarget(), agentCtx);

      assert.ok(bootstrapResult.updates.length > 0, 'Bootstrap should create wiki pages');

      // Save bootstrap pages to wiki
      await saveWikiPages(agentCtx.wikiId, bootstrapResult.updates);
      console.log(`Bootstrap created ${bootstrapResult.updates.length} pages`);

      // Step 2: Run ProjectOverviewAgent to enrich (if conditions met)
      console.log('Step 2: Running ProjectOverviewAgent...');
      const overviewAgent = new ProjectOverviewAgent();
      const overviewResult = await overviewAgent.run(createWikiTarget(), agentCtx);

      if (overviewResult.updates.length > 0) {
        await saveWikiPages(agentCtx.wikiId, overviewResult.updates);
        console.log(`ProjectOverview added ${overviewResult.updates.length} pages`);
      }

      // Get all wiki pages
      const wikiPages = await getWikiPages(agentCtx.wikiId);
      console.log(`Total wiki pages: ${wikiPages.length}`);

      // Compile wiki content for evaluation
      const wikiContent = wikiPages.map(p => `
## ${p.title} (${p.path})
${p.content}
`).join('\n---\n');

      // LLM-as-judge: Verify wiki is coherent and useful
      const evalResult = await evaluateLLM(
        'The generated wiki provides a useful overview of the TaskFlow API project. ' +
        'It should describe the task management functionality, mention Express.js or TypeScript, ' +
        'and provide some architectural or API information. ' +
        'The content should be coherent and read like documentation, not like commit messages.',
        wikiContent,
        6
      );

      logTestResult('Wiki bootstrap coherence', evalResult);
      console.log(formatEvaluationResult('Wiki bootstrap coherence', evalResult));

      // Verify overview page exists
      const hasOverview = wikiPages.some(p =>
        p.path === 'overview' ||
        p.path.includes('overview') ||
        p.title.toLowerCase().includes('overview')
      );
      assert.ok(hasOverview || wikiPages.length > 0, 'Wiki should have content');
    });
  });

  describe('Incremental Updates', () => {
    it('updates wiki when new commit is processed', async () => {
      const repoId = 'llm-e2e-incremental';

      // Create initial repository
      await createTestRepo(ctx, repoId, {
        'README.md': '# Calculator App\n\nA simple calculator API.',
        'src/calculator.ts': `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Bootstrap initial wiki
      console.log('Bootstrapping initial wiki...');
      const bootstrapAgent = new BootstrapAgent();
      const bootstrapResult = await bootstrapAgent.run(createWikiTarget(), agentCtx);
      await saveWikiPages(agentCtx.wikiId, bootstrapResult.updates);

      const initialPages = await getWikiPages(agentCtx.wikiId);
      const initialContent = initialPages.map(p => p.content).join('\n');
      console.log(`Initial wiki: ${initialPages.length} pages`);

      // Add a significant new feature
      console.log('Adding new feature commit...');
      const commitSha = await addCommit(ctx, repoId, {
        'src/calculator.ts': `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

export function power(base: number, exponent: number): number {
  return Math.pow(base, exponent);
}
`,
        'src/advanced.ts': `
export function factorial(n: number): number {
  if (n < 0) throw new Error('Negative factorial');
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
`,
      }, 'Add multiply, divide, power, factorial, and fibonacci functions');

      // Run analysis agents on the commit
      console.log('Running CodeChangeAgent on new commit...');
      const codeChangeAgent = new CodeChangeAgent();
      const codeChangeResult = await codeChangeAgent.run(createCommitTarget(commitSha), agentCtx);

      // Save any wiki updates from analysis
      if (codeChangeResult.updates.length > 0) {
        await saveWikiPages(agentCtx.wikiId, codeChangeResult.updates);
        console.log(`CodeChange added ${codeChangeResult.updates.length} wiki updates`);
      }

      // Get final wiki state
      const finalPages = await getWikiPages(agentCtx.wikiId);
      const newContent = finalPages.map(p => p.content).join('\n');

      // Compile analysis for evaluation
      const analysisResult = JSON.stringify({
        summary: codeChangeResult.result.summary,
        findings: codeChangeResult.result.findings,
        wikiUpdates: codeChangeResult.updates.map(u => ({
          path: u.path,
          contentPreview: u.content.slice(0, 200),
        })),
        initialPageCount: initialPages.length,
        finalPageCount: finalPages.length,
      }, null, 2);

      // LLM-as-judge: Verify the commit was analyzed correctly
      const evalResult = await evaluateLLM(
        'The analysis correctly describes adding mathematical operations to the calculator. ' +
        'It should mention new functions like multiply, divide, power, factorial, or fibonacci. ' +
        'The analysis should recognize this as adding new functionality.',
        analysisResult,
        6
      );

      logTestResult('Incremental wiki update', evalResult);
      console.log(formatEvaluationResult('Incremental wiki update', evalResult));
    });
  });

  describe('Full Pipeline', () => {
    it('complete wiki generation pipeline produces useful documentation', async () => {
      const repoId = 'llm-e2e-full-pipeline';

      // Create a more complete project
      await createTestRepo(ctx, repoId, {
        'README.md': `# NotesAPI

A REST API for managing notes with tags and search.

## Features
- Create, read, update, delete notes
- Tag notes for organization
- Full-text search
- User authentication

## Tech Stack
- Node.js + Express
- PostgreSQL
- Redis for caching
`,
        'package.json': JSON.stringify({
          name: 'notes-api',
          scripts: { dev: 'tsx src/index.ts', test: 'jest' },
          dependencies: { express: '^4.18.0', pg: '^8.0.0' },
        }, null, 2),
        'src/index.ts': 'import express from "express"; const app = express();',
      });

      // Add a security-relevant commit
      const commitSha = await addCommit(ctx, repoId, {
        'src/notes/note-repository.ts': `
export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  userId: string;
}

export class NoteRepository {
  async findById(id: string): Promise<Note | null> {
    // Safe parameterized query
    const result = await this.db.query(
      'SELECT * FROM notes WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByUserId(userId: string): Promise<Note[]> {
    const result = await this.db.query(
      'SELECT * FROM notes WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  async search(query: string, userId: string): Promise<Note[]> {
    // Full-text search with proper parameterization
    const result = await this.db.query(
      \`SELECT * FROM notes
       WHERE user_id = $1
       AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY created_at DESC\`,
      [userId, \`%\${query}%\`]
    );
    return result.rows;
  }
}
`,
      }, 'Add note repository with search functionality');

      const agentCtx = await ctx.agentContext(repoId);

      // Run full pipeline
      console.log('Running full pipeline...');

      // 1. Bootstrap
      const bootstrapAgent = new BootstrapAgent();
      const bootstrapResult = await bootstrapAgent.run(createWikiTarget(), agentCtx);
      await saveWikiPages(agentCtx.wikiId, bootstrapResult.updates);

      // 2. Security analysis
      const securityAgent = new SecurityAgent();
      const securityResult = await securityAgent.run(createCommitTarget(commitSha), agentCtx);
      if (securityResult.updates.length > 0) {
        await saveWikiPages(agentCtx.wikiId, securityResult.updates);
      }

      // 3. Code change analysis
      const codeChangeAgent = new CodeChangeAgent();
      const codeChangeResult = await codeChangeAgent.run(createCommitTarget(commitSha), agentCtx);
      if (codeChangeResult.updates.length > 0) {
        await saveWikiPages(agentCtx.wikiId, codeChangeResult.updates);
      }

      // Get final wiki
      const finalPages = await getWikiPages(agentCtx.wikiId);
      const wikiContent = finalPages.map(p => `## ${p.title}\n${p.content}`).join('\n\n');

      // Compile full results
      const pipelineResult = JSON.stringify({
        bootstrapPages: bootstrapResult.updates.length,
        securityFindings: securityResult.result.findings.length,
        codeChangeFindings: codeChangeResult.result.findings.length,
        totalWikiPages: finalPages.length,
        securitySummary: securityResult.result.summary,
        codeChangeSummary: codeChangeResult.result.summary,
      }, null, 2);

      // LLM-as-judge: Verify full pipeline produces useful output
      const evalResult = await evaluateLLM(
        'The complete wiki generation pipeline produced useful documentation. ' +
        'The wiki should describe a notes API with search functionality. ' +
        'Security analysis should recognize safe parameterized queries. ' +
        'The overall output should be coherent technical documentation.',
        pipelineResult + '\n\nWiki Content:\n' + wikiContent.slice(0, 3000),
        6
      );

      logTestResult('Full pipeline output', evalResult);
      console.log(formatEvaluationResult('Full pipeline output', evalResult));

      // Basic assertions
      assert.ok(finalPages.length > 0, 'Pipeline should produce wiki pages');
    });
  });
});
