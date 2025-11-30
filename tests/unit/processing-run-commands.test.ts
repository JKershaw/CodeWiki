/**
 * Unit tests for Processing Run CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createStartProcessingRunCommand,
  handleStartProcessingRun,
  createUpdateProcessingProgressCommand,
  handleUpdateProcessingProgress,
  createCompleteProcessingRunCommand,
  handleCompleteProcessingRun,
  createFailProcessingRunCommand,
  handleFailProcessingRun,
  createStopProcessingRunCommand,
  handleStopProcessingRun,
  createRequestStopProcessingRunCommand,
  handleRequestStopProcessingRun,
  createConfirmStopProcessingRunCommand,
  handleConfirmStopProcessingRun,
} from '../../src/commands/processing-run.js';
import { createProcessingRun } from '../../src/domain/processing-run.js';
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

describe('Processing Run Commands', () => {
  describe('StartProcessingRun', () => {
    it('creates a new processing run', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const command = createStartProcessingRunCommand({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      const result = await handleStartProcessingRun(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.id, runId);
      assert.strictEqual(result.data.repoId, 'repo-1');
      assert.strictEqual(result.data.wikiId, 'wiki-1');
      assert.strictEqual(result.data.totalIterations, 10);
      assert.strictEqual(result.data.status, 'running');
      assert.strictEqual(result.data.completedIterations, 0);
    });

    it('has correct command type', () => {
      const command = createStartProcessingRunCommand({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 5,
      });
      assert.strictEqual(command.type, 'StartProcessingRun');
    });
  });

  describe('UpdateProcessingProgress', () => {
    it('updates processing run progress', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // First create a run
      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      await repos.processingRuns.save(run);

      const command = createUpdateProcessingProgressCommand(runId, {
        completedIterations: 5,
        successfulIterations: 4,
        failedIterations: 1,
        totalCostUsd: 0.25,
        wikiPagesCreated: 3,
        wikiPagesUpdated: 2,
      });
      const result = await handleUpdateProcessingProgress(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.processingRuns.findById(runId);
      assert.strictEqual(updated?.completedIterations, 5);
      assert.strictEqual(updated?.successfulIterations, 4);
      assert.strictEqual(updated?.failedIterations, 1);
      assert.strictEqual(updated?.totalCostUsd, 0.25);
      assert.strictEqual(updated?.wikiPagesCreated, 3);
      assert.strictEqual(updated?.wikiPagesUpdated, 2);
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createUpdateProcessingProgressCommand('nonexistent', {
        completedIterations: 1,
        successfulIterations: 1,
        failedIterations: 0,
        totalCostUsd: 0.01,
        wikiPagesCreated: 0,
        wikiPagesUpdated: 0,
      });
      const result = await handleUpdateProcessingProgress(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createUpdateProcessingProgressCommand('run-1', {
        completedIterations: 1,
        successfulIterations: 1,
        failedIterations: 0,
        totalCostUsd: 0.01,
        wikiPagesCreated: 0,
        wikiPagesUpdated: 0,
      });
      assert.strictEqual(command.type, 'UpdateProcessingProgress');
    });
  });

  describe('CompleteProcessingRun', () => {
    it('marks a processing run as completed', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      await repos.processingRuns.save(run);

      const command = createCompleteProcessingRunCommand(runId);
      const result = await handleCompleteProcessingRun(command, repos);

      assert.strictEqual(result.success, true);

      const completed = await repos.processingRuns.findById(runId);
      assert.strictEqual(completed?.status, 'completed');
      assert.ok(completed?.completedAt);
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createCompleteProcessingRunCommand('nonexistent');
      const result = await handleCompleteProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createCompleteProcessingRunCommand('run-1');
      assert.strictEqual(command.type, 'CompleteProcessingRun');
    });
  });

  describe('FailProcessingRun', () => {
    it('marks a processing run as failed', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      await repos.processingRuns.save(run);

      const command = createFailProcessingRunCommand(runId, 'Out of memory');
      const result = await handleFailProcessingRun(command, repos);

      assert.strictEqual(result.success, true);

      const failed = await repos.processingRuns.findById(runId);
      assert.strictEqual(failed?.status, 'failed');
      assert.strictEqual(failed?.error, 'Out of memory');
      assert.ok(failed?.completedAt);
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createFailProcessingRunCommand('nonexistent', 'Error');
      const result = await handleFailProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createFailProcessingRunCommand('run-1', 'Error');
      assert.strictEqual(command.type, 'FailProcessingRun');
    });
  });

  describe('StopProcessingRun', () => {
    it('marks a processing run as stopped', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      await repos.processingRuns.save(run);

      const command = createStopProcessingRunCommand(runId);
      const result = await handleStopProcessingRun(command, repos);

      assert.strictEqual(result.success, true);

      const stopped = await repos.processingRuns.findById(runId);
      assert.strictEqual(stopped?.status, 'stopped');
      assert.ok(stopped?.completedAt);
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createStopProcessingRunCommand('nonexistent');
      const result = await handleStopProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createStopProcessingRunCommand('run-1');
      assert.strictEqual(command.type, 'StopProcessingRun');
    });
  });

  describe('RequestStopProcessingRun', () => {
    it('sets status to stopping and resets totalIterations', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      run.completedIterations = 5;
      await repos.processingRuns.save(run);

      const command = createRequestStopProcessingRunCommand(runId);
      const result = await handleRequestStopProcessingRun(command, repos);

      assert.strictEqual(result.success, true);

      const stopping = await repos.processingRuns.findById(runId);
      assert.strictEqual(stopping?.status, 'stopping');
      assert.strictEqual(stopping?.totalIterations, 5); // Reset to completedIterations
    });

    it('fails when processing run is not running', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      run.status = 'completed';
      await repos.processingRuns.save(run);

      const command = createRequestStopProcessingRunCommand(runId);
      const result = await handleRequestStopProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not running'));
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createRequestStopProcessingRunCommand('nonexistent');
      const result = await handleRequestStopProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createRequestStopProcessingRunCommand('run-1');
      assert.strictEqual(command.type, 'RequestStopProcessingRun');
    });
  });

  describe('ConfirmStopProcessingRun', () => {
    it('sets status to stopped when status is stopping', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      run.status = 'stopping';
      await repos.processingRuns.save(run);

      const command = createConfirmStopProcessingRunCommand(runId);
      const result = await handleConfirmStopProcessingRun(command, repos);

      assert.strictEqual(result.success, true);

      const stopped = await repos.processingRuns.findById(runId);
      assert.strictEqual(stopped?.status, 'stopped');
      assert.ok(stopped?.completedAt);
    });

    it('fails when processing run is not stopping', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createProcessingRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        totalIterations: 10,
      });
      // Status is 'running', not 'stopping'
      await repos.processingRuns.save(run);

      const command = createConfirmStopProcessingRunCommand(runId);
      const result = await handleConfirmStopProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not stopping'));
    });

    it('fails when processing run does not exist', async () => {
      const repos = createMockRepos();

      const command = createConfirmStopProcessingRunCommand('nonexistent');
      const result = await handleConfirmStopProcessingRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createConfirmStopProcessingRunCommand('run-1');
      assert.strictEqual(command.type, 'ConfirmStopProcessingRun');
    });
  });
});
