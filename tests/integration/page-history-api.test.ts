/**
 * Integration tests for Page History API endpoint.
 * Tests the /api/repos/:id/page-history endpoint that returns
 * cumulative page counts at each iteration.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer, type Server } from 'http';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';

import express from 'express';
import { v4 as uuid } from 'uuid';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createProcessingRun } from '../../src/domain/processing-run.js';
import { createIteration } from '../../src/domain/iteration.js';
import { createProcessingRoutes } from '../../src/web/routes/processing.js';

describe('Page History API', () => {
  let ctx: TestContext;
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ctx = await createTestContext();

    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Mount processing routes which include page-history
    const processingRoutes = createProcessingRoutes({
      repos: ctx.repos,
      git: ctx.git,
      createLLM: () => ctx.llm,
    });
    app.use(processingRoutes);

    // Start server on random port
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  describe('GET /api/repos/:id/page-history', () => {
    it('returns empty array for repo without processing runs', async () => {
      const repoId = 'page-history-empty';
      await createTestRepo(ctx, repoId);
      await getOrCreateActiveWiki(repoId, ctx.repos);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(Array.isArray(data.pageHistory));
      assert.strictEqual(data.pageHistory.length, 0);
    });

    it('returns empty array for repo without active wiki', async () => {
      const repoId = 'page-history-no-wiki';
      await createTestRepo(ctx, repoId);
      // Don't create a wiki

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(Array.isArray(data.pageHistory));
      assert.strictEqual(data.pageHistory.length, 0);
    });

    it('returns 404 for non-existent repository', async () => {
      const response = await fetch(`${baseUrl}/api/repos/nonexistent/page-history`);
      assert.strictEqual(response.status, 404);
    });

    it('returns cumulative page counts from iterations', async () => {
      const repoId = 'page-history-basic';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a processing run
      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        totalIterations: 3,
      });
      await ctx.repos.processingRuns.save(run);

      // Create iterations with page counts
      const iter1 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 1 });
      iter1.status = 'completed';
      iter1.pagesCreated = 2;
      await ctx.repos.iterations.save(iter1);

      const iter2 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 2 });
      iter2.status = 'completed';
      iter2.pagesCreated = 1;
      await ctx.repos.iterations.save(iter2);

      const iter3 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 3 });
      iter3.status = 'completed';
      iter3.pagesCreated = 3;
      await ctx.repos.iterations.save(iter3);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.pageHistory.length, 3);

      // Check cumulative page counts
      assert.strictEqual(data.pageHistory[0].iteration, 1);
      assert.strictEqual(data.pageHistory[0].pageCount, 2); // 2

      assert.strictEqual(data.pageHistory[1].iteration, 2);
      assert.strictEqual(data.pageHistory[1].pageCount, 3); // 2 + 1

      assert.strictEqual(data.pageHistory[2].iteration, 3);
      assert.strictEqual(data.pageHistory[2].pageCount, 6); // 2 + 1 + 3
    });

    it('skips non-completed iterations', async () => {
      const repoId = 'page-history-skip-incomplete';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        totalIterations: 4,
      });
      await ctx.repos.processingRuns.save(run);

      // Completed iteration
      const iter1 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 1 });
      iter1.status = 'completed';
      iter1.pagesCreated = 2;
      await ctx.repos.iterations.save(iter1);

      // Failed iteration - should be skipped
      const iter2 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 2 });
      iter2.status = 'failed';
      iter2.pagesCreated = 5; // This should NOT be counted
      await ctx.repos.iterations.save(iter2);

      // Running iteration - should be skipped
      const iter3 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 3 });
      iter3.status = 'running';
      iter3.pagesCreated = 3; // This should NOT be counted
      await ctx.repos.iterations.save(iter3);

      // Completed iteration
      const iter4 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 4 });
      iter4.status = 'completed';
      iter4.pagesCreated = 1;
      await ctx.repos.iterations.save(iter4);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.pageHistory.length, 2); // Only 2 completed iterations

      assert.strictEqual(data.pageHistory[0].iteration, 1);
      assert.strictEqual(data.pageHistory[0].pageCount, 2);

      assert.strictEqual(data.pageHistory[1].iteration, 2);
      assert.strictEqual(data.pageHistory[1].pageCount, 3); // 2 + 1, skipping failed/running
    });

    it('combines iterations across multiple processing runs', async () => {
      const repoId = 'page-history-multi-run';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // First processing run
      const run1 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        totalIterations: 2,
      });
      run1.startedAt = new Date('2024-01-01T10:00:00Z');
      await ctx.repos.processingRuns.save(run1);

      const iter1 = createIteration({ id: uuid(), processingRunId: run1.id, iterationNumber: 1 });
      iter1.status = 'completed';
      iter1.pagesCreated = 2;
      await ctx.repos.iterations.save(iter1);

      const iter2 = createIteration({ id: uuid(), processingRunId: run1.id, iterationNumber: 2 });
      iter2.status = 'completed';
      iter2.pagesCreated = 1;
      await ctx.repos.iterations.save(iter2);

      // Second processing run (later)
      const run2 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        totalIterations: 2,
      });
      run2.startedAt = new Date('2024-01-01T12:00:00Z');
      await ctx.repos.processingRuns.save(run2);

      const iter3 = createIteration({ id: uuid(), processingRunId: run2.id, iterationNumber: 1 });
      iter3.status = 'completed';
      iter3.pagesCreated = 3;
      await ctx.repos.iterations.save(iter3);

      const iter4 = createIteration({ id: uuid(), processingRunId: run2.id, iterationNumber: 2 });
      iter4.status = 'completed';
      iter4.pagesCreated = 2;
      await ctx.repos.iterations.save(iter4);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.pageHistory.length, 4);

      // Verify global iteration numbering and cumulative counts
      assert.strictEqual(data.pageHistory[0].iteration, 1);
      assert.strictEqual(data.pageHistory[0].pageCount, 2); // run1-iter1: 2

      assert.strictEqual(data.pageHistory[1].iteration, 2);
      assert.strictEqual(data.pageHistory[1].pageCount, 3); // run1-iter2: 2+1=3

      assert.strictEqual(data.pageHistory[2].iteration, 3);
      assert.strictEqual(data.pageHistory[2].pageCount, 6); // run2-iter1: 3+3=6

      assert.strictEqual(data.pageHistory[3].iteration, 4);
      assert.strictEqual(data.pageHistory[3].pageCount, 8); // run2-iter2: 6+2=8
    });

    it('only includes iterations from the active wiki', async () => {
      const repoId = 'page-history-wiki-filter';
      await createTestRepo(ctx, repoId);
      const activeWiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create another wiki (not active)
      const otherWikiId = uuid();
      await ctx.repos.wikis.save({
        id: otherWikiId,
        repoId,
        name: 'other-wiki',
        slug: 'other-wiki',
        description: 'Other wiki',
        isActive: false,
        config: { confidenceThreshold: 0.5, autoPublish: true },
        status: 'active',
        lastProcessedCommitSha: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        totalIterations: 0,
      });

      // Processing run for active wiki
      const activeRun = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: activeWiki.id,
        totalIterations: 2,
      });
      await ctx.repos.processingRuns.save(activeRun);

      const iter1 = createIteration({ id: uuid(), processingRunId: activeRun.id, iterationNumber: 1 });
      iter1.status = 'completed';
      iter1.pagesCreated = 5;
      await ctx.repos.iterations.save(iter1);

      // Processing run for other wiki (should not be included)
      const otherRun = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: otherWikiId,
        totalIterations: 2,
      });
      await ctx.repos.processingRuns.save(otherRun);

      const iter2 = createIteration({ id: uuid(), processingRunId: otherRun.id, iterationNumber: 1 });
      iter2.status = 'completed';
      iter2.pagesCreated = 10; // Should NOT be counted
      await ctx.repos.iterations.save(iter2);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.pageHistory.length, 1);
      assert.strictEqual(data.pageHistory[0].pageCount, 5); // Only from active wiki
    });

    it('handles iterations with zero pages created', async () => {
      const repoId = 'page-history-zero-pages';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        totalIterations: 3,
      });
      await ctx.repos.processingRuns.save(run);

      const iter1 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 1 });
      iter1.status = 'completed';
      iter1.pagesCreated = 2;
      await ctx.repos.iterations.save(iter1);

      // Iteration that updated pages but didn't create any
      const iter2 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 2 });
      iter2.status = 'completed';
      iter2.pagesCreated = 0;
      iter2.pagesUpdated = 3;
      await ctx.repos.iterations.save(iter2);

      const iter3 = createIteration({ id: uuid(), processingRunId: run.id, iterationNumber: 3 });
      iter3.status = 'completed';
      iter3.pagesCreated = 1;
      await ctx.repos.iterations.save(iter3);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/page-history`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.pageHistory.length, 3);

      assert.strictEqual(data.pageHistory[0].pageCount, 2);
      assert.strictEqual(data.pageHistory[1].pageCount, 2); // No change (0 pages created)
      assert.strictEqual(data.pageHistory[2].pageCount, 3); // 2 + 1
    });
  });
});
