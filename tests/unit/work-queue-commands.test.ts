/**
 * Unit tests for Work Queue CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createClaimWorkItemCommand,
  handleClaimWorkItem,
  createSaveWorkItemsCommand,
  handleSaveWorkItems,
  createCompleteWorkItemCommand,
  handleCompleteWorkItem,
  createFailWorkItemCommand,
  handleFailWorkItem,
} from '../../src/commands/work-queue.js';
import { createWorkItem, Priority } from '../../src/domain/work-item.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { WorkItem } from '../../src/domain/work-item.js';

// Create a minimal mock repositories object for testing
function createMockRepos(overrides: Partial<{
  workQueue: Partial<Repositories['workQueue']>;
}> = {}): Repositories {
  const workItems = new Map<string, WorkItem>();

  const mockWorkQueue: Repositories['workQueue'] = {
    findById: async (id) => workItems.get(id) ?? null,
    findPending: async () => [],
    findByRepo: async () => [],
    countPending: async () => 0,
    countByStatus: async () => ({ pending: 0, claimed: 0, completed: 0, failed: 0 }),
    save: async (item) => { workItems.set(item.id, item); },
    saveMany: async (items) => { items.forEach(item => workItems.set(item.id, item)); },
    delete: async (id) => { workItems.delete(id); },
    deleteByRepo: async () => {},
    claimNext: async (repoId) => {
      for (const item of workItems.values()) {
        if (item.repoId === repoId && item.status === 'pending') {
          item.status = 'claimed';
          item.claimedAt = new Date();
          return item;
        }
      }
      return null;
    },
    complete: async (id, agentRunId) => {
      const item = workItems.get(id);
      if (item) {
        item.status = 'completed';
        item.completedAt = new Date();
        item.agentRunId = agentRunId;
      }
    },
    fail: async (id) => {
      const item = workItems.get(id);
      if (item) {
        item.status = 'failed';
        item.failedAt = new Date();
      }
    },
    exists: async () => false,
    ...overrides.workQueue,
  };

  return {
    workQueue: mockWorkQueue,
  } as Repositories;
}

describe('Work Queue Commands', () => {
  describe('ClaimWorkItem', () => {
    it('claims the next pending work item for a repo', async () => {
      const repoId = 'test-repo';
      const workItem = createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
      });

      const repos = createMockRepos();
      await repos.workQueue.save(workItem);

      const command = createClaimWorkItemCommand(repoId);
      const result = await handleClaimWorkItem(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.id, workItem.id);
      assert.strictEqual(result.data.status, 'claimed');
    });

    it('returns null when no work is available', async () => {
      const repos = createMockRepos();

      const command = createClaimWorkItemCommand('empty-repo');
      const result = await handleClaimWorkItem(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, null);
    });

    it('has correct command type', () => {
      const command = createClaimWorkItemCommand('test-repo');
      assert.strictEqual(command.type, 'ClaimWorkItem');
      assert.strictEqual(command.repoId, 'test-repo');
    });
  });

  describe('SaveWorkItems', () => {
    it('saves multiple work items', async () => {
      const repoId = 'test-repo';
      const workItems = [
        createWorkItem({ id: uuid(), repoId, agentType: 'code-change', priority: Priority.RECENT_COMMIT }),
        createWorkItem({ id: uuid(), repoId, agentType: 'narrative', priority: Priority.RECENT_COMMIT }),
      ];

      const repos = createMockRepos();

      const command = createSaveWorkItemsCommand(workItems);
      const result = await handleSaveWorkItems(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 2);

      // Verify items were saved
      const saved1 = await repos.workQueue.findById(workItems[0]!.id);
      const saved2 = await repos.workQueue.findById(workItems[1]!.id);
      assert.ok(saved1);
      assert.ok(saved2);
    });

    it('handles empty array', async () => {
      const repos = createMockRepos();

      const command = createSaveWorkItemsCommand([]);
      const result = await handleSaveWorkItems(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 0);
    });

    it('has correct command type', () => {
      const command = createSaveWorkItemsCommand([]);
      assert.strictEqual(command.type, 'SaveWorkItems');
    });
  });

  describe('CompleteWorkItem', () => {
    it('marks a work item as completed', async () => {
      const workItem = createWorkItem({
        id: uuid(),
        repoId: 'test-repo',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
      });
      workItem.status = 'claimed';

      const repos = createMockRepos();
      await repos.workQueue.save(workItem);

      const agentRunId = uuid();
      const command = createCompleteWorkItemCommand(workItem.id, agentRunId);
      const result = await handleCompleteWorkItem(command, repos);

      assert.strictEqual(result.success, true);

      const completed = await repos.workQueue.findById(workItem.id);
      assert.strictEqual(completed?.status, 'completed');
      assert.strictEqual(completed?.agentRunId, agentRunId);
    });

    it('fails when work item does not exist', async () => {
      const repos = createMockRepos();

      const command = createCompleteWorkItemCommand('nonexistent', uuid());
      const result = await handleCompleteWorkItem(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createCompleteWorkItemCommand('item-1', 'run-1');
      assert.strictEqual(command.type, 'CompleteWorkItem');
      assert.strictEqual(command.workItemId, 'item-1');
      assert.strictEqual(command.agentRunId, 'run-1');
    });
  });

  describe('FailWorkItem', () => {
    it('marks a work item as failed', async () => {
      const workItem = createWorkItem({
        id: uuid(),
        repoId: 'test-repo',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
      });
      workItem.status = 'claimed';

      const repos = createMockRepos();
      await repos.workQueue.save(workItem);

      const command = createFailWorkItemCommand(workItem.id);
      const result = await handleFailWorkItem(command, repos);

      assert.strictEqual(result.success, true);

      const failed = await repos.workQueue.findById(workItem.id);
      assert.strictEqual(failed?.status, 'failed');
    });

    it('fails when work item does not exist', async () => {
      const repos = createMockRepos();

      const command = createFailWorkItemCommand('nonexistent');
      const result = await handleFailWorkItem(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createFailWorkItemCommand('item-1');
      assert.strictEqual(command.type, 'FailWorkItem');
      assert.strictEqual(command.workItemId, 'item-1');
    });
  });
});
