/**
 * Unit tests for AutoBenchmarkRunner.
 * Tests the orchestration logic with mocked dependencies.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  AutoBenchmarkRunner,
  type AutoBenchmarkDependencies,
} from '../../src/auto-benchmark/auto-benchmark-runner.js';
import { createAutoBenchmarkRun, type AutoBenchmarkRun } from '../../src/domain/auto-benchmark.js';
import type { AutoBenchmarkRepository } from '../../src/repositories/interfaces/auto-benchmark-repository.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create mock dependencies for testing
function createMockDependencies(): {
  deps: AutoBenchmarkDependencies;
  calls: {
    runIterations: Array<{ repoId: string; iterations: number }>;
    runAccuracyBenchmark: Array<{ repoId: string; wikiId: string }>;
    runQualityBenchmark: Array<{ repoId: string; wikiId: string }>;
  };
  autoBenchmarks: Map<string, AutoBenchmarkRun>;
} {
  const autoBenchmarks = new Map<string, AutoBenchmarkRun>();
  const calls = {
    runIterations: [] as Array<{ repoId: string; iterations: number }>,
    runAccuracyBenchmark: [] as Array<{ repoId: string; wikiId: string }>,
    runQualityBenchmark: [] as Array<{ repoId: string; wikiId: string }>,
  };

  const mockAutoBenchmarks: AutoBenchmarkRepository = {
    findById: async (id) => autoBenchmarks.get(id) ?? null,
    findByRepo: async () => Array.from(autoBenchmarks.values()),
    findByWiki: async () => Array.from(autoBenchmarks.values()),
    findRunning: async (repoId) => {
      for (const run of autoBenchmarks.values()) {
        if (run.repoId === repoId && run.status === 'running') return run;
      }
      return null;
    },
    findRunningByWiki: async () => null,
    findAllRunning: async () => Array.from(autoBenchmarks.values()).filter(r => r.status === 'running'),
    save: async (run) => { autoBenchmarks.set(run.id, { ...run }); },
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
        run.error = error;
        run.completedAt = new Date();
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
    deleteByRepo: async () => {},
    deleteByWiki: async () => {},
  };

  const repos = {
    autoBenchmarks: mockAutoBenchmarks,
  } as Repositories;

  const deps: AutoBenchmarkDependencies = {
    repos,
    runIterations: async (repoId, iterations) => {
      calls.runIterations.push({ repoId, iterations });
    },
    runAccuracyBenchmark: async (repoId, wikiId) => {
      calls.runAccuracyBenchmark.push({ repoId, wikiId });
    },
    runQualityBenchmark: async (repoId, wikiId) => {
      calls.runQualityBenchmark.push({ repoId, wikiId });
    },
  };

  return { deps, calls, autoBenchmarks };
}

describe('AutoBenchmarkRunner', () => {
  describe('run', () => {
    it('runs all cycles with iterations and accuracy benchmarks', async () => {
      const { deps, calls, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      const runId = uuid();
      await runner.run(runId, 'repo-1', 'wiki-1', {
        iterationsPerCycle: 5,
        maxCycles: 3,
        includeQuality: false,
      });

      // Should have called runIterations 3 times (one per cycle)
      assert.strictEqual(calls.runIterations.length, 3);
      assert.ok(calls.runIterations.every(c => c.repoId === 'repo-1' && c.iterations === 5));

      // Should have called runAccuracyBenchmark 3 times
      assert.strictEqual(calls.runAccuracyBenchmark.length, 3);
      assert.ok(calls.runAccuracyBenchmark.every(c => c.repoId === 'repo-1' && c.wikiId === 'wiki-1'));

      // Should NOT have called runQualityBenchmark
      assert.strictEqual(calls.runQualityBenchmark.length, 0);

      // Run should be completed
      const run = autoBenchmarks.get(runId);
      assert.strictEqual(run?.status, 'completed');
      assert.strictEqual(run?.currentPhase, 'complete');
    });

    it('includes quality benchmarks when configured', async () => {
      const { deps, calls, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      const runId = uuid();
      await runner.run(runId, 'repo-1', 'wiki-1', {
        iterationsPerCycle: 3,
        maxCycles: 2,
        includeQuality: true,
      });

      // Should have called runIterations 2 times
      assert.strictEqual(calls.runIterations.length, 2);

      // Should have called runAccuracyBenchmark 2 times
      assert.strictEqual(calls.runAccuracyBenchmark.length, 2);

      // Should have called runQualityBenchmark 2 times
      assert.strictEqual(calls.runQualityBenchmark.length, 2);

      const run = autoBenchmarks.get(runId);
      assert.strictEqual(run?.status, 'completed');
    });

    it('updates progress after each phase', async () => {
      const { deps, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      // Track progress updates
      const progressHistory: Array<{ cycle: number; phase: string }> = [];
      const originalUpdateProgress = deps.repos.autoBenchmarks.updateProgress;
      deps.repos.autoBenchmarks.updateProgress = async (id, cycle, phase) => {
        progressHistory.push({ cycle, phase });
        return originalUpdateProgress(id, cycle, phase);
      };

      const runId = uuid();
      await runner.run(runId, 'repo-1', 'wiki-1', {
        iterationsPerCycle: 5,
        maxCycles: 2,
        includeQuality: true,
      });

      // Should have progress updates for each phase of each cycle
      // Cycle 1: iterations, accuracy, quality
      // Cycle 2: iterations, accuracy, quality
      assert.ok(progressHistory.some(p => p.cycle === 1 && p.phase === 'iterations'));
      assert.ok(progressHistory.some(p => p.cycle === 1 && p.phase === 'accuracy'));
      assert.ok(progressHistory.some(p => p.cycle === 1 && p.phase === 'quality'));
      assert.ok(progressHistory.some(p => p.cycle === 2 && p.phase === 'iterations'));
      assert.ok(progressHistory.some(p => p.cycle === 2 && p.phase === 'accuracy'));
      assert.ok(progressHistory.some(p => p.cycle === 2 && p.phase === 'quality'));
    });

    it('stops when run is marked as stopped', async () => {
      const { deps, calls, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      // Intercept to stop after first cycle
      let cycleCount = 0;
      const originalRunIterations = deps.runIterations;
      deps.runIterations = async (repoId, iterations) => {
        cycleCount++;
        if (cycleCount === 2) {
          // Simulate user stopping after first cycle completes
          const run = autoBenchmarks.values().next().value;
          if (run) {
            run.status = 'stopped';
            run.completedAt = new Date();
          }
        }
        return originalRunIterations(repoId, iterations);
      };

      const runId = uuid();
      await runner.run(runId, 'repo-1', 'wiki-1', {
        iterationsPerCycle: 5,
        maxCycles: 5,
        includeQuality: false,
      });

      // Should have stopped after 2 cycles (stopped at start of cycle 2)
      assert.ok(calls.runIterations.length <= 2);

      const run = autoBenchmarks.get(runId);
      assert.strictEqual(run?.status, 'stopped');
    });

    it('marks run as failed on error', async () => {
      const { deps, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      // Make runIterations fail
      deps.runIterations = async () => {
        throw new Error('Simulated failure');
      };

      const runId = uuid();

      // Should not throw, but should mark as failed
      await runner.run(runId, 'repo-1', 'wiki-1', {
        iterationsPerCycle: 5,
        maxCycles: 3,
        includeQuality: false,
      });

      const run = autoBenchmarks.get(runId);
      assert.strictEqual(run?.status, 'failed');
      assert.ok(run?.error?.includes('Simulated failure'));
    });
  });

  describe('resumeIncomplete', () => {
    it('resumes all running auto-benchmarks', async () => {
      const { deps, calls, autoBenchmarks } = createMockDependencies();
      const runner = new AutoBenchmarkRunner(deps);

      // Create two running auto-benchmarks at different states
      const run1 = createAutoBenchmarkRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: { iterationsPerCycle: 5, maxCycles: 3, includeQuality: false },
      });
      run1.currentCycle = 2;
      run1.currentPhase = 'accuracy';

      const run2 = createAutoBenchmarkRun({
        id: uuid(),
        repoId: 'repo-2',
        wikiId: 'wiki-2',
        config: { iterationsPerCycle: 3, maxCycles: 2, includeQuality: true },
      });
      run2.currentCycle = 1;
      run2.currentPhase = 'iterations';

      await deps.repos.autoBenchmarks.save(run1);
      await deps.repos.autoBenchmarks.save(run2);

      await runner.resumeIncomplete();

      // Wait for background tasks to complete (they run asynchronously)
      // Poll until both are completed or timeout
      const maxWait = 1000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const completed1 = autoBenchmarks.get(run1.id);
        const completed2 = autoBenchmarks.get(run2.id);
        if (completed1?.status === 'completed' && completed2?.status === 'completed') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Both should be resumed and completed
      const completed1 = autoBenchmarks.get(run1.id);
      const completed2 = autoBenchmarks.get(run2.id);

      assert.strictEqual(completed1?.status, 'completed');
      assert.strictEqual(completed2?.status, 'completed');
    });
  });
});
