/**
 * Unit tests for PipelineManager - the phased execution orchestrator.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  PipelineManager,
  type PhaseRunner,
  type PhaseContext,
  type PhaseResult,
} from '../../src/executor/pipeline-manager.js';
import { createProcessingRun, type ProcessingRun, type ProcessingPhase } from '../../src/domain/processing-run.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories & { processingRuns: Map<string, ProcessingRun> } {
  const processingRuns = new Map<string, ProcessingRun>();

  const mockProcessingRuns: Repositories['processingRuns'] = {
    findById: async (id) => processingRuns.get(id) ?? null,
    findByRepo: async () => [],
    findActive: async () => null,
    findMostRecent: async () => null,
    save: async (run) => { processingRuns.set(run.id, run); },
    delete: async (id) => { processingRuns.delete(id); },
    deleteByRepo: async () => {},
    updateProgress: async (id, updates) => {
      const run = processingRuns.get(id);
      if (run) {
        run.completedIterations = updates.completedIterations;
        run.successfulIterations = updates.successfulIterations;
        run.failedIterations = updates.failedIterations;
        run.totalCostUsd = updates.totalCostUsd;
        run.wikiPagesCreated = updates.wikiPagesCreated;
        run.wikiPagesUpdated = updates.wikiPagesUpdated;
      }
    },
    advancePhase: async (id, phase) => {
      const run = processingRuns.get(id);
      if (run) {
        if (run.currentPhase && run.phaseStatus) {
          run.phaseStatus[run.currentPhase] = 'completed';
        }
        run.currentPhase = phase;
        run.phaseProgress = 0;
        run.phaseTarget = null;
        if (run.phaseStatus) {
          run.phaseStatus[phase] = 'running';
        }
      }
    },
    updatePhaseProgress: async (id, progress, target) => {
      const run = processingRuns.get(id);
      if (run) {
        run.phaseProgress = progress;
        if (target !== undefined) {
          run.phaseTarget = target;
        }
      }
    },
    complete: async (id) => {
      const run = processingRuns.get(id);
      if (run) {
        run.status = 'completed';
        run.completedAt = new Date();
      }
    },
    fail: async (id, error) => {
      const run = processingRuns.get(id);
      if (run) {
        run.status = 'failed';
        run.error = error;
        run.completedAt = new Date();
      }
    },
    stop: async (id) => {
      const run = processingRuns.get(id);
      if (run) {
        run.status = 'stopped';
        run.completedAt = new Date();
      }
    },
    requestStop: async (id) => {
      const run = processingRuns.get(id);
      if (run) {
        run.status = 'stopping';
        run.totalIterations = run.completedIterations;
      }
    },
    confirmStop: async (id) => {
      const run = processingRuns.get(id);
      if (run) {
        run.status = 'stopped';
        run.completedAt = new Date();
      }
    },
  };

  return {
    processingRuns: Object.assign(mockProcessingRuns, processingRuns) as Repositories['processingRuns'] & Map<string, ProcessingRun>,
  } as Repositories & { processingRuns: Map<string, ProcessingRun> };
}

// Create a mock phase runner that tracks execution
function createMockPhaseRunner(
  completesImmediately: boolean = true,
  workItems: number = 3
): PhaseRunner & { calls: PhaseContext[] } {
  const calls: PhaseContext[] = [];

  return {
    calls,
    async run(context: PhaseContext): Promise<PhaseResult> {
      calls.push(context);
      return {
        completed: completesImmediately,
        workItemsProcessed: workItems,
        costUsd: 0.01 * workItems,
        pagesCreated: workItems,
        pagesUpdated: 0,
      };
    },
  };
}

describe('PipelineManager', () => {
  let repos: ReturnType<typeof createMockRepos>;
  let runId: string;

  beforeEach(async () => {
    repos = createMockRepos();
    runId = uuid();

    // Create a processing run
    const run = createProcessingRun({
      id: runId,
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      totalIterations: 100,
    });
    await repos.processingRuns.save(run);
  });

  describe('constructor', () => {
    it('creates a pipeline manager with phase runners', () => {
      const runners: Partial<Record<ProcessingPhase, PhaseRunner>> = {
        bootstrap: createMockPhaseRunner(),
        exploration: createMockPhaseRunner(),
      };

      const manager = new PipelineManager(repos as Repositories, runners);
      assert.ok(manager);
    });
  });

  describe('runPhase', () => {
    it('runs the current phase using the registered runner', async () => {
      const bootstrapRunner = createMockPhaseRunner(true, 2);
      const runners: Partial<Record<ProcessingPhase, PhaseRunner>> = {
        bootstrap: bootstrapRunner,
      };

      const manager = new PipelineManager(repos as Repositories, runners);
      const result = await manager.runPhase(runId);

      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.workItemsProcessed, 2);
      assert.strictEqual(bootstrapRunner.calls.length, 1);
      assert.strictEqual(bootstrapRunner.calls[0]!.processingRunId, runId);
    });

    it('returns incomplete if no runner for current phase', async () => {
      const manager = new PipelineManager(repos as Repositories, {});
      const result = await manager.runPhase(runId);

      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.workItemsProcessed, 0);
    });

    it('throws if processing run not found', async () => {
      const manager = new PipelineManager(repos as Repositories, {});

      await assert.rejects(
        async () => manager.runPhase('nonexistent'),
        /not found/
      );
    });
  });

  describe('advanceToNextPhase', () => {
    it('advances from bootstrap to exploration', async () => {
      const manager = new PipelineManager(repos as Repositories, {});
      const advanced = await manager.advanceToNextPhase(runId);

      assert.strictEqual(advanced, true);

      const run = await repos.processingRuns.findById(runId);
      assert.strictEqual(run?.currentPhase, 'exploration');
      assert.strictEqual(run?.phaseStatus.bootstrap, 'completed');
      assert.strictEqual(run?.phaseStatus.exploration, 'running');
    });

    it('returns false when at final phase', async () => {
      // Set to continuous (final phase)
      const run = await repos.processingRuns.findById(runId);
      if (run) {
        run.currentPhase = 'continuous';
        await repos.processingRuns.save(run);
      }

      const manager = new PipelineManager(repos as Repositories, {});
      const advanced = await manager.advanceToNextPhase(runId);

      assert.strictEqual(advanced, false);
    });

    it('throws if processing run not found', async () => {
      const manager = new PipelineManager(repos as Repositories, {});

      await assert.rejects(
        async () => manager.advanceToNextPhase('nonexistent'),
        /not found/
      );
    });
  });

  describe('runUntilPhaseComplete', () => {
    it('runs phase until it returns completed', async () => {
      let callCount = 0;
      const explorationRunner: PhaseRunner = {
        async run(): Promise<PhaseResult> {
          callCount++;
          return {
            completed: callCount >= 3, // Complete after 3 calls
            workItemsProcessed: 2,
            costUsd: 0.02,
            pagesCreated: 2,
            pagesUpdated: 0,
          };
        },
      };

      // Set to exploration phase
      const run = await repos.processingRuns.findById(runId);
      if (run) {
        run.currentPhase = 'exploration';
        await repos.processingRuns.save(run);
      }

      const manager = new PipelineManager(repos as Repositories, {
        exploration: explorationRunner,
      });
      const result = await manager.runUntilPhaseComplete(runId);

      assert.strictEqual(callCount, 3);
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.workItemsProcessed, 6); // 2 * 3 calls
    });

    it('respects maxIterations limit', async () => {
      let callCount = 0;
      const neverCompleteRunner: PhaseRunner = {
        async run(): Promise<PhaseResult> {
          callCount++;
          return {
            completed: false,
            workItemsProcessed: 1,
            costUsd: 0.01,
            pagesCreated: 1,
            pagesUpdated: 0,
          };
        },
      };

      const run = await repos.processingRuns.findById(runId);
      if (run) {
        run.currentPhase = 'exploration';
        await repos.processingRuns.save(run);
      }

      const manager = new PipelineManager(repos as Repositories, {
        exploration: neverCompleteRunner,
      });
      const result = await manager.runUntilPhaseComplete(runId, { maxIterations: 5 });

      assert.strictEqual(callCount, 5);
      assert.strictEqual(result.completed, false);
    });
  });

  describe('getCurrentPhase', () => {
    it('returns the current phase from the processing run', async () => {
      const manager = new PipelineManager(repos as Repositories, {});
      const phase = await manager.getCurrentPhase(runId);

      assert.strictEqual(phase, 'bootstrap');
    });

    it('throws if processing run not found', async () => {
      const manager = new PipelineManager(repos as Repositories, {});

      await assert.rejects(
        async () => manager.getCurrentPhase('nonexistent'),
        /not found/
      );
    });
  });

  describe('updatePhaseProgress', () => {
    it('updates phase progress on the processing run', async () => {
      const manager = new PipelineManager(repos as Repositories, {});
      await manager.updatePhaseProgress(runId, 5, 10);

      const run = await repos.processingRuns.findById(runId);
      assert.strictEqual(run?.phaseProgress, 5);
      assert.strictEqual(run?.phaseTarget, 10);
    });
  });
});

describe('Phase Execution Flow', () => {
  it('can run through multiple phases in sequence', async () => {
    const repos = createMockRepos();
    const runId = uuid();

    const run = createProcessingRun({
      id: runId,
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      totalIterations: 100,
    });
    await repos.processingRuns.save(run);

    // Create mock runners that complete immediately
    const bootstrapRunner = createMockPhaseRunner(true, 1);
    const explorationRunner = createMockPhaseRunner(true, 5);
    const synthesisRunner = createMockPhaseRunner(true, 3);

    const manager = new PipelineManager(repos as Repositories, {
      bootstrap: bootstrapRunner,
      exploration: explorationRunner,
      synthesis: synthesisRunner,
    });

    // Run bootstrap phase
    let result = await manager.runPhase(runId);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(bootstrapRunner.calls.length, 1);

    // Advance to exploration
    await manager.advanceToNextPhase(runId);
    let currentPhase = await manager.getCurrentPhase(runId);
    assert.strictEqual(currentPhase, 'exploration');

    // Run exploration phase
    result = await manager.runPhase(runId);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(explorationRunner.calls.length, 1);

    // Advance to synthesis
    await manager.advanceToNextPhase(runId);
    currentPhase = await manager.getCurrentPhase(runId);
    assert.strictEqual(currentPhase, 'synthesis');

    // Run synthesis phase
    result = await manager.runPhase(runId);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(synthesisRunner.calls.length, 1);
  });
});
