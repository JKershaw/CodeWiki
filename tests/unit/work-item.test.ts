/**
 * Unit tests for WorkItem domain model.
 * Tests creation and provenance tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createWorkItem, Priority, type WorkItem } from '../../src/domain/work-item.js';

describe('WorkItem', () => {
  describe('createWorkItem', () => {
    it('creates a work item with required fields', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
      });

      assert.strictEqual(workItem.id, 'work-1');
      assert.strictEqual(workItem.repoId, 'repo-1');
      assert.strictEqual(workItem.agentType, 'code-change');
      assert.strictEqual(workItem.priority, Priority.RECENT_COMMIT);
      assert.strictEqual(workItem.status, 'pending');
    });

    it('sets default status to pending', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.BACKGROUND,
      });

      assert.strictEqual(workItem.status, 'pending');
    });

    it('sets optional fields to null when not provided', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.BACKGROUND,
      });

      assert.strictEqual(workItem.targetCommitId, null);
      assert.strictEqual(workItem.targetPath, null);
      assert.strictEqual(workItem.claimedAt, null);
      assert.strictEqual(workItem.completedAt, null);
      assert.strictEqual(workItem.agentRunId, null);
      assert.strictEqual(workItem.orchestratorRunId, null);
    });

    it('includes targetCommitId when provided', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        targetCommitId: 'abc123def',
      });

      assert.strictEqual(workItem.targetCommitId, 'abc123def');
    });

    it('includes targetPath when provided', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        priority: Priority.EXPLORATION,
        targetPath: 'src/services/llm',
      });

      assert.strictEqual(workItem.targetPath, 'src/services/llm');
    });

    it('includes orchestratorRunId when provided for provenance tracking', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        targetCommitId: 'abc123def',
        orchestratorRunId: 'orch-run-456',
      });

      assert.strictEqual(workItem.orchestratorRunId, 'orch-run-456');
    });

    it('sets orchestratorRunId to null when not provided', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
      });

      assert.strictEqual(workItem.orchestratorRunId, null);
    });

    it('sets createdAt to current time', () => {
      const before = Date.now();
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.BACKGROUND,
      });
      const after = Date.now();

      assert.ok(workItem.createdAt instanceof Date);
      assert.ok(workItem.createdAt.getTime() >= before);
      assert.ok(workItem.createdAt.getTime() <= after);
    });

    it('supports all priority levels', () => {
      const priorities = [
        Priority.USER_REQUEST,
        Priority.CONFLICT_RESOLUTION,
        Priority.LOW_CONFIDENCE,
        Priority.EXPLORATION,
        Priority.RECENT_COMMIT,
        Priority.SYNTHESIS,
        Priority.HISTORICAL_COMMIT,
        Priority.META,
        Priority.BACKGROUND,
      ];

      for (const priority of priorities) {
        const workItem = createWorkItem({
          id: `work-${priority}`,
          repoId: 'repo-1',
          agentType: 'code-change',
          priority,
        });

        assert.strictEqual(workItem.priority, priority);
      }
    });
  });
});
