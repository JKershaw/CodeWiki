/**
 * Unit tests for WorkItem domain model.
 * Tests creation and provenance tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createWorkItem,
  Priority,
  getTargetCommitId,
  getTargetPath,
  createCommitTarget,
  createPathTarget,
  createWikiTarget,
  type WorkItem,
} from '../../src/domain/work-item.js';

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

    it('sets wiki target when no target specified', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.BACKGROUND,
      });

      assert.strictEqual(workItem.target.type, 'wiki');
      assert.strictEqual(getTargetCommitId(workItem), null);
      assert.strictEqual(getTargetPath(workItem), null);
      assert.strictEqual(workItem.claimedAt, null);
      assert.strictEqual(workItem.completedAt, null);
      assert.strictEqual(workItem.agentRunId, null);
      assert.strictEqual(workItem.orchestratorRunId, null);
    });

    it('creates commit target from targetCommitId (legacy)', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        targetCommitId: 'abc123def',
      });

      assert.strictEqual(workItem.target.type, 'commit');
      assert.strictEqual(getTargetCommitId(workItem), 'abc123def');
    });

    it('creates path target from targetPath (legacy)', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        priority: Priority.EXPLORATION,
        targetPath: 'src/services/llm',
      });

      assert.strictEqual(workItem.target.type, 'path');
      assert.strictEqual(getTargetPath(workItem), 'src/services/llm');
    });

    it('accepts explicit WorkTarget', () => {
      const target = createCommitTarget('explicit-sha');
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        target,
      });

      assert.strictEqual(workItem.target.type, 'commit');
      assert.strictEqual(getTargetCommitId(workItem), 'explicit-sha');
    });

    it('explicit target takes precedence over legacy fields', () => {
      const target = createPathTarget('explicit/path');
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        target,
        targetCommitId: 'should-be-ignored',
      });

      assert.strictEqual(workItem.target.type, 'path');
      assert.strictEqual(getTargetPath(workItem), 'explicit/path');
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

  describe('helper functions', () => {
    it('getTargetCommitId returns commitId for commit targets', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        target: createCommitTarget('sha123'),
      });
      assert.strictEqual(getTargetCommitId(workItem), 'sha123');
    });

    it('getTargetCommitId returns null for non-commit targets', () => {
      const pathItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        priority: Priority.EXPLORATION,
        target: createPathTarget('src/foo'),
      });
      assert.strictEqual(getTargetCommitId(pathItem), null);

      const wikiItem = createWorkItem({
        id: 'work-2',
        repoId: 'repo-1',
        agentType: 'link',
        priority: Priority.META,
        target: createWikiTarget(),
      });
      assert.strictEqual(getTargetCommitId(wikiItem), null);
    });

    it('getTargetPath returns path for path targets', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        priority: Priority.EXPLORATION,
        target: createPathTarget('src/services'),
      });
      assert.strictEqual(getTargetPath(workItem), 'src/services');
    });

    it('getTargetPath returns null for non-path targets', () => {
      const commitItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        priority: Priority.RECENT_COMMIT,
        target: createCommitTarget('sha123'),
      });
      assert.strictEqual(getTargetPath(commitItem), null);

      const wikiItem = createWorkItem({
        id: 'work-2',
        repoId: 'repo-1',
        agentType: 'link',
        priority: Priority.META,
        target: createWikiTarget(),
      });
      assert.strictEqual(getTargetPath(wikiItem), null);
    });
  });
});
