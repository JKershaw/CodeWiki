/**
 * Unit tests for Auto-Benchmark CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createStartAutoBenchmarkCommand,
  handleStartAutoBenchmark,
  createUpdateAutoBenchmarkProgressCommand,
  handleUpdateAutoBenchmarkProgress,
  createStopAutoBenchmarkCommand,
  handleStopAutoBenchmark,
  createCompleteAutoBenchmarkCommand,
  handleCompleteAutoBenchmark,
  createFailAutoBenchmarkCommand,
  handleFailAutoBenchmark,
  createDeleteAutoBenchmarkCommand,
  handleDeleteAutoBenchmark,
} from '../../src/commands/auto-benchmark.js';
import {
  createAutoBenchmarkRun,
  type AutoBenchmarkRun,
} from '../../src/domain/auto-benchmark.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { AutoBenchmarkRepository } from '../../src/repositories/interfaces/auto-benchmark-repository.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const autoBenchmarks = new Map<string, AutoBenchmarkRun>();

  const mockAutoBenchmarks: AutoBenchmarkRepository = {
    findById: async (id) => autoBenchmarks.get(id) ?? null,
    findByRepo: async (repoId, options) => {
      return Array.from(autoBenchmarks.values())
        .filter(r => {
          if (r.repoId !== repoId) return false;
          if (options?.status && r.status !== options.status) return false;
          return true;
        })
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    },
    findByWiki: async (wikiId, options) => {
      return Array.from(autoBenchmarks.values())
        .filter(r => {
          if (r.wikiId !== wikiId) return false;
          if (options?.status && r.status !== options.status) return false;
          return true;
        })
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    },
    findRunning: async (repoId) => {
      for (const run of autoBenchmarks.values()) {
        if (run.repoId === repoId && run.status === 'running') {
          return run;
        }
      }
      return null;
    },
    findRunningByWiki: async (wikiId) => {
      for (const run of autoBenchmarks.values()) {
        if (run.wikiId === wikiId && run.status === 'running') {
          return run;
        }
      }
      return null;
    },
    findAllRunning: async () => {
      return Array.from(autoBenchmarks.values()).filter(r => r.status === 'running');
    },
    save: async (run) => { autoBenchmarks.set(run.id, run); },
    updateProgress: async (id, cycle, phase) => {
      const run = autoBenchmarks.get(id);
      if (run) {
        run.currentCycle = cycle;
        run.currentPhase = phase;
      }
    },
    complete: async (id) => {
      const run = autoBenchmarks.get(id);
      if (run) {
        run.status = 'completed';
        run.currentPhase = 'complete';
        run.completedAt = new Date();
      }
    },
    fail: async (id, error) => {
      const run = autoBenchmarks.get(id);
      if (run) {
        run.status = 'failed';
        run.completedAt = new Date();
        run.error = error;
      }
    },
    stop: async (id) => {
      const run = autoBenchmarks.get(id);
      if (run) {
        run.status = 'stopped';
        run.completedAt = new Date();
      }
    },
    delete: async (id) => { autoBenchmarks.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, run] of autoBenchmarks) {
        if (run.repoId === repoId) autoBenchmarks.delete(id);
      }
    },
    deleteByWiki: async (wikiId) => {
      for (const [id, run] of autoBenchmarks) {
        if (run.wikiId === wikiId) autoBenchmarks.delete(id);
      }
    },
  };

  return {
    autoBenchmarks: mockAutoBenchmarks,
  } as Repositories;
}

describe('Auto-Benchmark Commands', () => {
  describe('StartAutoBenchmark', () => {
    it('creates a new auto-benchmark run in running state', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const command = createStartAutoBenchmarkCommand({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: {
          iterationsPerCycle: 5,
          maxCycles: 10,
          includeQuality: false,
        },
      });
      const result = await handleStartAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.id, runId);
      assert.strictEqual(result.data?.status, 'running');
      assert.strictEqual(result.data?.config.maxCycles, 10);

      const saved = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(saved?.status, 'running');
    });

    it('fails if an auto-benchmark is already running', async () => {
      const repos = createMockRepos();

      // Create an existing running auto-benchmark
      const existingRun = createAutoBenchmarkRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(existingRun);

      // Try to start another
      const command = createStartAutoBenchmarkCommand({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 3, maxCycles: 5, includeQuality: true },
      });
      const result = await handleStartAutoBenchmark(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('already running'));
    });
  });

  describe('UpdateAutoBenchmarkProgress', () => {
    it('updates cycle and phase', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(run);

      const command = createUpdateAutoBenchmarkProgressCommand(runId, 3, 'accuracy');
      const result = await handleUpdateAutoBenchmarkProgress(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(updated?.currentCycle, 3);
      assert.strictEqual(updated?.currentPhase, 'accuracy');
    });

    it('fails for non-existent run', async () => {
      const repos = createMockRepos();

      const command = createUpdateAutoBenchmarkProgressCommand('non-existent', 2, 'quality');
      const result = await handleUpdateAutoBenchmarkProgress(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });
  });

  describe('StopAutoBenchmark', () => {
    it('marks run as stopped', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(run);

      const command = createStopAutoBenchmarkCommand(runId);
      const result = await handleStopAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const stopped = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(stopped?.status, 'stopped');
      assert.ok(stopped?.completedAt);
    });

    it('fails for non-existent run', async () => {
      const repos = createMockRepos();

      const command = createStopAutoBenchmarkCommand('non-existent');
      const result = await handleStopAutoBenchmark(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });
  });

  describe('CompleteAutoBenchmark', () => {
    it('marks run as completed', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(run);

      const command = createCompleteAutoBenchmarkCommand(runId);
      const result = await handleCompleteAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const completed = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(completed?.status, 'completed');
      assert.strictEqual(completed?.currentPhase, 'complete');
      assert.ok(completed?.completedAt);
    });
  });

  describe('FailAutoBenchmark', () => {
    it('marks run as failed with error', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(run);

      const command = createFailAutoBenchmarkCommand(runId, 'Something went wrong');
      const result = await handleFailAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const failed = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(failed?.status, 'failed');
      assert.strictEqual(failed?.error, 'Something went wrong');
      assert.ok(failed?.completedAt);
    });
  });

  describe('DeleteAutoBenchmark', () => {
    it('deletes a completed run', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a completed auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      (run as any).status = 'completed';
      (run as any).completedAt = new Date();
      await repos.autoBenchmarks.save(run);

      const command = createDeleteAutoBenchmarkCommand(runId);
      const result = await handleDeleteAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const deleted = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(deleted, null);
    });

    it('allows deleting a running run for cleanup', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running auto-benchmark
      const run = createAutoBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 10, includeQuality: false },
      });
      await repos.autoBenchmarks.save(run);

      const command = createDeleteAutoBenchmarkCommand(runId);
      const result = await handleDeleteAutoBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const deleted = await repos.autoBenchmarks.findById(runId);
      assert.strictEqual(deleted, null);
    });

    it('fails for non-existent run', async () => {
      const repos = createMockRepos();

      const command = createDeleteAutoBenchmarkCommand('non-existent');
      const result = await handleDeleteAutoBenchmark(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });
  });
});
