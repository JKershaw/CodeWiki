/**
 * Unit tests for Processing Run phase functionality.
 * Tests the phased pipeline architecture for wiki generation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createProcessingRun,
  PROCESSING_PHASES,
  getNextPhase,
  isPhaseComplete,
  type ProcessingPhase,
} from '../../src/domain/processing-run.js';
import {
  createAdvancePhaseCommand,
  handleAdvancePhase,
  createUpdatePhaseProgressCommand,
  handleUpdatePhaseProgress,
} from '../../src/commands/processing-run.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { ProcessingRun } from '../../src/domain/processing-run.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
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
        // Mark current phase as complete in phaseStatus
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
    processingRuns: mockProcessingRuns,
  } as Repositories;
}

describe('Processing Phases - Domain', () => {
  describe('PROCESSING_PHASES', () => {
    it('defines phases in correct order', () => {
      assert.deepStrictEqual(PROCESSING_PHASES, [
        'bootstrap',
        'exploration',
        'synthesis',
        'quality',
        'history',
        'continuous',
      ]);
    });
  });

  describe('getNextPhase', () => {
    it('returns exploration after bootstrap', () => {
      assert.strictEqual(getNextPhase('bootstrap'), 'exploration');
    });

    it('returns synthesis after exploration', () => {
      assert.strictEqual(getNextPhase('exploration'), 'synthesis');
    });

    it('returns quality after synthesis', () => {
      assert.strictEqual(getNextPhase('synthesis'), 'quality');
    });

    it('returns history after quality', () => {
      assert.strictEqual(getNextPhase('quality'), 'history');
    });

    it('returns continuous after history', () => {
      assert.strictEqual(getNextPhase('history'), 'continuous');
    });

    it('returns null for continuous (final phase)', () => {
      assert.strictEqual(getNextPhase('continuous'), null);
    });
  });

  describe('createProcessingRun', () => {
    it('initializes with bootstrap phase', () => {
      const run = createProcessingRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });

      assert.strictEqual(run.currentPhase, 'bootstrap');
      assert.strictEqual(run.phaseProgress, 0);
      assert.strictEqual(run.phaseTarget, null);
    });

    it('initializes phaseStatus with all phases pending except bootstrap', () => {
      const run = createProcessingRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });

      assert.strictEqual(run.phaseStatus.bootstrap, 'running');
      assert.strictEqual(run.phaseStatus.exploration, 'pending');
      assert.strictEqual(run.phaseStatus.synthesis, 'pending');
      assert.strictEqual(run.phaseStatus.quality, 'pending');
      assert.strictEqual(run.phaseStatus.history, 'pending');
      assert.strictEqual(run.phaseStatus.continuous, 'pending');
    });
  });

  describe('isPhaseComplete', () => {
    it('returns true when phaseProgress >= phaseTarget', () => {
      const run = createProcessingRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      run.phaseProgress = 5;
      run.phaseTarget = 5;

      assert.strictEqual(isPhaseComplete(run), true);
    });

    it('returns false when phaseProgress < phaseTarget', () => {
      const run = createProcessingRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      run.phaseProgress = 3;
      run.phaseTarget = 5;

      assert.strictEqual(isPhaseComplete(run), false);
    });

    it('returns false when phaseTarget is null', () => {
      const run = createProcessingRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      run.phaseProgress = 10;
      run.phaseTarget = null;

      assert.strictEqual(isPhaseComplete(run), false);
    });
  });
});

describe('Processing Phases - Commands', () => {
  describe('AdvancePhase', () => {
    it('advances from bootstrap to exploration', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      await repos.processingRuns.save(run);

      const command = createAdvancePhaseCommand(runId, 'exploration');
      const result = await handleAdvancePhase(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.processingRuns.findById(runId);
      assert.strictEqual(updated?.currentPhase, 'exploration');
      assert.strictEqual(updated?.phaseProgress, 0);
      assert.strictEqual(updated?.phaseStatus.bootstrap, 'completed');
      assert.strictEqual(updated?.phaseStatus.exploration, 'running');
    });

    it('fails when trying to skip phases', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      await repos.processingRuns.save(run);

      // Try to skip from bootstrap to quality
      const command = createAdvancePhaseCommand(runId, 'quality');
      const result = await handleAdvancePhase(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid phase transition'));
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createAdvancePhaseCommand('nonexistent', 'exploration');
      const result = await handleAdvancePhase(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createAdvancePhaseCommand('run-1', 'exploration');
      assert.strictEqual(command.type, 'AdvancePhase');
    });
  });

  describe('UpdatePhaseProgress', () => {
    it('updates phase progress and target', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      await repos.processingRuns.save(run);

      const command = createUpdatePhaseProgressCommand(runId, 3, 10);
      const result = await handleUpdatePhaseProgress(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.processingRuns.findById(runId);
      assert.strictEqual(updated?.phaseProgress, 3);
      assert.strictEqual(updated?.phaseTarget, 10);
    });

    it('updates only progress when target not provided', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 100,
      });
      run.phaseTarget = 5;
      await repos.processingRuns.save(run);

      const command = createUpdatePhaseProgressCommand(runId, 2);
      const result = await handleUpdatePhaseProgress(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.processingRuns.findById(runId);
      assert.strictEqual(updated?.phaseProgress, 2);
      assert.strictEqual(updated?.phaseTarget, 5); // Unchanged
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createUpdatePhaseProgressCommand('nonexistent', 1, 5);
      const result = await handleUpdatePhaseProgress(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createUpdatePhaseProgressCommand('run-1', 1, 5);
      assert.strictEqual(command.type, 'UpdatePhaseProgress');
    });
  });
});

describe('Phase Progression Flow', () => {
  it('progresses through all phases correctly', async () => {
    const repos = createMockRepos();
    const runId = uuid();

    const run = createProcessingRun({
      id: runId,
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      totalIterations: 100,
    });
    await repos.processingRuns.save(run);

    // Should start at bootstrap
    let current = await repos.processingRuns.findById(runId);
    assert.strictEqual(current?.currentPhase, 'bootstrap');

    // Progress through each phase
    const phases: ProcessingPhase[] = ['exploration', 'synthesis', 'quality', 'history', 'continuous'];

    for (const nextPhase of phases) {
      const command = createAdvancePhaseCommand(runId, nextPhase);
      const result = await handleAdvancePhase(command, repos);
      assert.strictEqual(result.success, true, `Failed to advance to ${nextPhase}`);

      current = await repos.processingRuns.findById(runId);
      assert.strictEqual(current?.currentPhase, nextPhase);
      assert.strictEqual(current?.phaseStatus[nextPhase], 'running');
    }

    // All previous phases should be completed
    current = await repos.processingRuns.findById(runId);
    assert.strictEqual(current?.phaseStatus.bootstrap, 'completed');
    assert.strictEqual(current?.phaseStatus.exploration, 'completed');
    assert.strictEqual(current?.phaseStatus.synthesis, 'completed');
    assert.strictEqual(current?.phaseStatus.quality, 'completed');
    assert.strictEqual(current?.phaseStatus.history, 'completed');
    assert.strictEqual(current?.phaseStatus.continuous, 'running');
  });
});
