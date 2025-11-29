/**
 * Integration tests for ProcessingRun and Iteration tracking.
 * Tests the repository implementations and their interaction.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { createProcessingRun } from '../../src/domain/processing-run.js';
import { createIteration } from '../../src/domain/iteration.js';
import { v4 as uuid } from 'uuid';

describe('Processing Tracking', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('ProcessingRunRepository', () => {
    it('saves and retrieves a processing run', async () => {
      const repoId = 'proc-test-1';
      await createTestRepo(ctx, repoId);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-1',
        totalIterations: 5,
      });

      await ctx.repos.processingRuns.save(run);
      const retrieved = await ctx.repos.processingRuns.findById(run.id);

      assert.ok(retrieved, 'Should retrieve saved processing run');
      assert.strictEqual(retrieved.repoId, repoId);
      assert.strictEqual(retrieved.totalIterations, 5);
      assert.strictEqual(retrieved.status, 'running');
      assert.strictEqual(retrieved.completedIterations, 0);
    });

    it('finds active processing run for a repo', async () => {
      const repoId = 'proc-test-2';
      await createTestRepo(ctx, repoId);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-2',
        totalIterations: 3,
      });

      await ctx.repos.processingRuns.save(run);
      const active = await ctx.repos.processingRuns.findActive(repoId);

      assert.ok(active, 'Should find active processing run');
      assert.strictEqual(active.id, run.id);
    });

    it('returns null when no active processing run', async () => {
      const repoId = 'proc-test-3';
      await createTestRepo(ctx, repoId);

      const active = await ctx.repos.processingRuns.findActive(repoId);
      assert.strictEqual(active, null, 'Should return null when no active run');
    });

    it('updates progress correctly', async () => {
      const repoId = 'proc-test-4';
      await createTestRepo(ctx, repoId);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-4',
        totalIterations: 5,
      });

      await ctx.repos.processingRuns.save(run);

      await ctx.repos.processingRuns.updateProgress(run.id, {
        completedIterations: 2,
        successfulIterations: 2,
        failedIterations: 0,
        totalCostUsd: 0.05,
        wikiPagesCreated: 3,
        wikiPagesUpdated: 1,
      });

      const updated = await ctx.repos.processingRuns.findById(run.id);
      assert.ok(updated, 'Should retrieve updated run');
      assert.strictEqual(updated.completedIterations, 2);
      assert.strictEqual(updated.successfulIterations, 2);
      assert.strictEqual(updated.totalCostUsd, 0.05);
      assert.strictEqual(updated.wikiPagesCreated, 3);
    });

    it('marks processing run as completed', async () => {
      const repoId = 'proc-test-5';
      await createTestRepo(ctx, repoId);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-5',
        totalIterations: 2,
      });

      await ctx.repos.processingRuns.save(run);
      await ctx.repos.processingRuns.complete(run.id);

      const completed = await ctx.repos.processingRuns.findById(run.id);
      assert.ok(completed, 'Should retrieve completed run');
      assert.strictEqual(completed.status, 'completed');
      assert.ok(completed.completedAt, 'Should have completedAt timestamp');
    });

    it('marks processing run as failed with error', async () => {
      const repoId = 'proc-test-6';
      await createTestRepo(ctx, repoId);

      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-6',
        totalIterations: 5,
      });

      await ctx.repos.processingRuns.save(run);
      await ctx.repos.processingRuns.fail(run.id, 'Network timeout');

      const failed = await ctx.repos.processingRuns.findById(run.id);
      assert.ok(failed, 'Should retrieve failed run');
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.error, 'Network timeout');
      assert.ok(failed.completedAt, 'Should have completedAt timestamp');
    });

    it('finds most recent processing run', async () => {
      const repoId = 'proc-test-7';
      await createTestRepo(ctx, repoId);

      // Create two runs
      const run1 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-7',
        totalIterations: 5,
      });
      await ctx.repos.processingRuns.save(run1);
      await ctx.repos.processingRuns.complete(run1.id);

      // Wait a bit to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));

      const run2 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-7',
        totalIterations: 3,
      });
      await ctx.repos.processingRuns.save(run2);

      const mostRecent = await ctx.repos.processingRuns.findMostRecent(repoId);
      assert.ok(mostRecent, 'Should find most recent run');
      assert.strictEqual(mostRecent.id, run2.id);
    });

    it('finds all runs for a repo with filtering', async () => {
      const repoId = 'proc-test-8';
      await createTestRepo(ctx, repoId);

      const run1 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-8',
        totalIterations: 5,
      });
      await ctx.repos.processingRuns.save(run1);
      await ctx.repos.processingRuns.complete(run1.id);

      const run2 = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-8',
        totalIterations: 3,
      });
      await ctx.repos.processingRuns.save(run2);

      const allRuns = await ctx.repos.processingRuns.findByRepo(repoId);
      assert.strictEqual(allRuns.length, 2, 'Should find all runs');

      const completedRuns = await ctx.repos.processingRuns.findByRepo(repoId, { status: 'completed' });
      assert.strictEqual(completedRuns.length, 1, 'Should find only completed runs');
    });
  });

  describe('IterationRepository', () => {
    it('saves and retrieves an iteration', async () => {
      const processingRunId = uuid();

      const iteration = createIteration({
        id: uuid(),
        processingRunId,
        iterationNumber: 1,
      });

      await ctx.repos.iterations.save(iteration);
      const retrieved = await ctx.repos.iterations.findById(iteration.id);

      assert.ok(retrieved, 'Should retrieve saved iteration');
      assert.strictEqual(retrieved.processingRunId, processingRunId);
      assert.strictEqual(retrieved.iterationNumber, 1);
      assert.strictEqual(retrieved.status, 'running');
    });

    it('finds all iterations for a processing run in order', async () => {
      const processingRunId = uuid();

      // Create iterations out of order
      const iter3 = createIteration({ id: uuid(), processingRunId, iterationNumber: 3 });
      const iter1 = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      const iter2 = createIteration({ id: uuid(), processingRunId, iterationNumber: 2 });

      await ctx.repos.iterations.save(iter3);
      await ctx.repos.iterations.save(iter1);
      await ctx.repos.iterations.save(iter2);

      const iterations = await ctx.repos.iterations.findByProcessingRun(processingRunId);
      assert.strictEqual(iterations.length, 3, 'Should find all iterations');
      assert.strictEqual(iterations[0]!.iterationNumber, 1, 'Should be sorted by iteration number');
      assert.strictEqual(iterations[1]!.iterationNumber, 2);
      assert.strictEqual(iterations[2]!.iterationNumber, 3);
    });

    it('finds running iteration', async () => {
      const processingRunId = uuid();

      const iter1 = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      iter1.status = 'completed';
      await ctx.repos.iterations.save(iter1);

      const iter2 = createIteration({ id: uuid(), processingRunId, iterationNumber: 2 });
      await ctx.repos.iterations.save(iter2);

      const running = await ctx.repos.iterations.findRunning(processingRunId);
      assert.ok(running, 'Should find running iteration');
      assert.strictEqual(running.iterationNumber, 2);
    });

    it('updates work item details', async () => {
      const processingRunId = uuid();
      const iteration = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      await ctx.repos.iterations.save(iteration);

      await ctx.repos.iterations.updateWorkItem(iteration.id, {
        workItemId: 'work-123',
        agentType: 'code-change',
      });

      const updated = await ctx.repos.iterations.findById(iteration.id);
      assert.ok(updated, 'Should retrieve updated iteration');
      assert.strictEqual(updated.workItemId, 'work-123');
      assert.strictEqual(updated.agentType, 'code-change');
    });

    it('completes iteration with results', async () => {
      const processingRunId = uuid();
      const iteration = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      await ctx.repos.iterations.save(iteration);

      await ctx.repos.iterations.complete(iteration.id, {
        agentRunId: 'agent-run-123',
        durationMs: 1500,
        costUsd: 0.02,
        pagesCreated: 1,
        pagesUpdated: 2,
      });

      const completed = await ctx.repos.iterations.findById(iteration.id);
      assert.ok(completed, 'Should retrieve completed iteration');
      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.agentRunId, 'agent-run-123');
      assert.strictEqual(completed.durationMs, 1500);
      assert.strictEqual(completed.costUsd, 0.02);
      assert.strictEqual(completed.pagesCreated, 1);
      assert.strictEqual(completed.pagesUpdated, 2);
      assert.ok(completed.completedAt, 'Should have completedAt timestamp');
    });

    it('fails iteration with error', async () => {
      const processingRunId = uuid();
      const iteration = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      await ctx.repos.iterations.save(iteration);

      await ctx.repos.iterations.fail(iteration.id, 'Agent crashed', 500);

      const failed = await ctx.repos.iterations.findById(iteration.id);
      assert.ok(failed, 'Should retrieve failed iteration');
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.error, 'Agent crashed');
      assert.strictEqual(failed.durationMs, 500);
    });

    it('skips iteration with reason', async () => {
      const processingRunId = uuid();
      const iteration = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      await ctx.repos.iterations.save(iteration);

      await ctx.repos.iterations.skip(iteration.id, 'Rate limited');

      const skipped = await ctx.repos.iterations.findById(iteration.id);
      assert.ok(skipped, 'Should retrieve skipped iteration');
      assert.strictEqual(skipped.status, 'skipped');
      assert.strictEqual(skipped.error, 'Rate limited');
    });

    it('deletes iterations by processing run', async () => {
      const processingRunId = uuid();

      const iter1 = createIteration({ id: uuid(), processingRunId, iterationNumber: 1 });
      const iter2 = createIteration({ id: uuid(), processingRunId, iterationNumber: 2 });
      await ctx.repos.iterations.save(iter1);
      await ctx.repos.iterations.save(iter2);

      await ctx.repos.iterations.deleteByProcessingRun(processingRunId);

      const remaining = await ctx.repos.iterations.findByProcessingRun(processingRunId);
      assert.strictEqual(remaining.length, 0, 'Should delete all iterations');
    });
  });

  describe('ProcessingRun and Iteration Integration', () => {
    it('tracks full processing lifecycle', async () => {
      const repoId = 'proc-lifecycle-test';
      await createTestRepo(ctx, repoId);

      // Start a processing run
      const run = createProcessingRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-lifecycle',
        totalIterations: 3,
      });
      await ctx.repos.processingRuns.save(run);

      // Simulate 3 iterations
      for (let i = 1; i <= 3; i++) {
        const iteration = createIteration({
          id: uuid(),
          processingRunId: run.id,
          iterationNumber: i,
        });
        await ctx.repos.iterations.save(iteration);

        await ctx.repos.iterations.updateWorkItem(iteration.id, {
          workItemId: `work-${i}`,
          agentType: 'code-change',
        });

        await ctx.repos.iterations.complete(iteration.id, {
          agentRunId: `agent-${i}`,
          durationMs: 1000 + i * 100,
          costUsd: 0.01 * i,
          pagesCreated: i === 1 ? 1 : 0,
          pagesUpdated: i > 1 ? 1 : 0,
        });

        // Update processing run progress
        await ctx.repos.processingRuns.updateProgress(run.id, {
          completedIterations: i,
          successfulIterations: i,
          failedIterations: 0,
          totalCostUsd: 0.01 * (i * (i + 1)) / 2, // Sum 1+2+...+i
          wikiPagesCreated: 1,
          wikiPagesUpdated: i - 1,
        });
      }

      // Complete the run
      await ctx.repos.processingRuns.complete(run.id);

      // Verify final state
      const finalRun = await ctx.repos.processingRuns.findById(run.id);
      assert.ok(finalRun, 'Should retrieve final run');
      assert.strictEqual(finalRun.status, 'completed');
      assert.strictEqual(finalRun.completedIterations, 3);
      assert.strictEqual(finalRun.successfulIterations, 3);

      const iterations = await ctx.repos.iterations.findByProcessingRun(run.id);
      assert.strictEqual(iterations.length, 3, 'Should have 3 iterations');
      assert.ok(iterations.every(i => i.status === 'completed'), 'All iterations should be completed');
    });
  });
});
