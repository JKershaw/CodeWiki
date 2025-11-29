/**
 * Unit tests for Iteration CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createStartIterationCommand,
  handleStartIteration,
  createUpdateIterationWorkItemCommand,
  handleUpdateIterationWorkItem,
  createCompleteIterationCommand,
  handleCompleteIteration,
  createFailIterationCommand,
  handleFailIteration,
  createSkipIterationCommand,
  handleSkipIteration,
} from '../../src/commands/iteration.js';
import { createIteration } from '../../src/domain/iteration.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { Iteration } from '../../src/domain/iteration.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const iterations = new Map<string, Iteration>();

  const mockIterations: Repositories['iterations'] = {
    findById: async (id) => iterations.get(id) ?? null,
    findByProcessingRun: async () => [],
    findRunning: async () => null,
    findMostRecent: async () => null,
    save: async (iteration) => { iterations.set(iteration.id, iteration); },
    delete: async (id) => { iterations.delete(id); },
    deleteByProcessingRun: async () => {},
    updateWorkItem: async (id, updates) => {
      const iteration = iterations.get(id);
      if (iteration) {
        iteration.workItemId = updates.workItemId;
        iteration.agentType = updates.agentType;
      }
    },
    complete: async (id, result) => {
      const iteration = iterations.get(id);
      if (iteration) {
        iteration.status = 'completed';
        iteration.agentRunId = result.agentRunId;
        iteration.durationMs = result.durationMs;
        iteration.costUsd = result.costUsd;
        iteration.pagesCreated = result.pagesCreated;
        iteration.pagesUpdated = result.pagesUpdated;
        iteration.completedAt = new Date();
      }
    },
    fail: async (id, error, durationMs) => {
      const iteration = iterations.get(id);
      if (iteration) {
        iteration.status = 'failed';
        iteration.error = error;
        iteration.durationMs = durationMs;
        iteration.completedAt = new Date();
      }
    },
    skip: async (id, reason) => {
      const iteration = iterations.get(id);
      if (iteration) {
        iteration.status = 'skipped';
        iteration.error = reason;
        iteration.completedAt = new Date();
      }
    },
  };

  return {
    iterations: mockIterations,
  } as Repositories;
}

describe('Iteration Commands', () => {
  describe('StartIteration', () => {
    it('creates a new iteration', async () => {
      const repos = createMockRepos();
      const iterationId = uuid();
      const processingRunId = uuid();

      const command = createStartIterationCommand({
        id: iterationId,
        processingRunId,
        iterationNumber: 1,
      });
      const result = await handleStartIteration(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.id, iterationId);
      assert.strictEqual(result.data.processingRunId, processingRunId);
      assert.strictEqual(result.data.iterationNumber, 1);
      assert.strictEqual(result.data.status, 'running');
    });

    it('has correct command type', () => {
      const command = createStartIterationCommand({
        id: 'iter-1',
        processingRunId: 'run-1',
        iterationNumber: 1,
      });
      assert.strictEqual(command.type, 'StartIteration');
    });
  });

  describe('UpdateIterationWorkItem', () => {
    it('updates iteration with work item details', async () => {
      const repos = createMockRepos();
      const iterationId = uuid();

      // First create an iteration
      const iteration = createIteration({
        id: iterationId,
        processingRunId: uuid(),
        iterationNumber: 1,
      });
      await repos.iterations.save(iteration);

      const command = createUpdateIterationWorkItemCommand(iterationId, {
        workItemId: 'work-123',
        agentType: 'code-change',
      });
      const result = await handleUpdateIterationWorkItem(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.iterations.findById(iterationId);
      assert.strictEqual(updated?.workItemId, 'work-123');
      assert.strictEqual(updated?.agentType, 'code-change');
    });

    it('fails when iteration does not exist', async () => {
      const repos = createMockRepos();

      const command = createUpdateIterationWorkItemCommand('nonexistent', {
        workItemId: 'work-123',
        agentType: 'code-change',
      });
      const result = await handleUpdateIterationWorkItem(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createUpdateIterationWorkItemCommand('iter-1', {
        workItemId: 'work-123',
        agentType: 'code-change',
      });
      assert.strictEqual(command.type, 'UpdateIterationWorkItem');
    });
  });

  describe('CompleteIteration', () => {
    it('marks an iteration as completed with results', async () => {
      const repos = createMockRepos();
      const iterationId = uuid();

      const iteration = createIteration({
        id: iterationId,
        processingRunId: uuid(),
        iterationNumber: 1,
      });
      await repos.iterations.save(iteration);

      const command = createCompleteIterationCommand(iterationId, {
        agentRunId: 'run-123',
        durationMs: 1500,
        costUsd: 0.05,
        pagesCreated: 2,
        pagesUpdated: 1,
      });
      const result = await handleCompleteIteration(command, repos);

      assert.strictEqual(result.success, true);

      const completed = await repos.iterations.findById(iterationId);
      assert.strictEqual(completed?.status, 'completed');
      assert.strictEqual(completed?.agentRunId, 'run-123');
      assert.strictEqual(completed?.durationMs, 1500);
      assert.strictEqual(completed?.costUsd, 0.05);
      assert.strictEqual(completed?.pagesCreated, 2);
      assert.strictEqual(completed?.pagesUpdated, 1);
    });

    it('fails when iteration does not exist', async () => {
      const repos = createMockRepos();

      const command = createCompleteIterationCommand('nonexistent', {
        agentRunId: 'run-123',
        durationMs: 100,
        costUsd: 0.01,
        pagesCreated: 0,
        pagesUpdated: 0,
      });
      const result = await handleCompleteIteration(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createCompleteIterationCommand('iter-1', {
        agentRunId: 'run-123',
        durationMs: 100,
        costUsd: 0.01,
        pagesCreated: 0,
        pagesUpdated: 0,
      });
      assert.strictEqual(command.type, 'CompleteIteration');
    });
  });

  describe('FailIteration', () => {
    it('marks an iteration as failed', async () => {
      const repos = createMockRepos();
      const iterationId = uuid();

      const iteration = createIteration({
        id: iterationId,
        processingRunId: uuid(),
        iterationNumber: 1,
      });
      await repos.iterations.save(iteration);

      const command = createFailIterationCommand(iterationId, 'Agent crashed', 500);
      const result = await handleFailIteration(command, repos);

      assert.strictEqual(result.success, true);

      const failed = await repos.iterations.findById(iterationId);
      assert.strictEqual(failed?.status, 'failed');
      assert.strictEqual(failed?.error, 'Agent crashed');
      assert.strictEqual(failed?.durationMs, 500);
    });

    it('fails when iteration does not exist', async () => {
      const repos = createMockRepos();

      const command = createFailIterationCommand('nonexistent', 'Error', 100);
      const result = await handleFailIteration(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createFailIterationCommand('iter-1', 'Error', 100);
      assert.strictEqual(command.type, 'FailIteration');
    });
  });

  describe('SkipIteration', () => {
    it('marks an iteration as skipped', async () => {
      const repos = createMockRepos();
      const iterationId = uuid();

      const iteration = createIteration({
        id: iterationId,
        processingRunId: uuid(),
        iterationNumber: 1,
      });
      await repos.iterations.save(iteration);

      const command = createSkipIterationCommand(iterationId, 'Rate limited');
      const result = await handleSkipIteration(command, repos);

      assert.strictEqual(result.success, true);

      const skipped = await repos.iterations.findById(iterationId);
      assert.strictEqual(skipped?.status, 'skipped');
      assert.strictEqual(skipped?.error, 'Rate limited');
    });

    it('fails when iteration does not exist', async () => {
      const repos = createMockRepos();

      const command = createSkipIterationCommand('nonexistent', 'Reason');
      const result = await handleSkipIteration(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createSkipIterationCommand('iter-1', 'No work');
      assert.strictEqual(command.type, 'SkipIteration');
    });
  });
});
