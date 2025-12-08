/**
 * Unit tests for WorkItem domain model.
 * Tests creation and provenance tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createWorkItem,
  createCommitTarget,
  createPathTarget,
  createWikiTarget,
  isCommitTarget,
  isPathTarget,
  isWikiTarget,
  type WorkItem,
} from '../../src/domain/work-item.js';

describe('WorkItem', () => {
  describe('createWorkItem', () => {
    it('creates a work item with required fields', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createWikiTarget(),
      });

      assert.strictEqual(workItem.id, 'work-1');
      assert.strictEqual(workItem.repoId, 'repo-1');
      assert.strictEqual(workItem.agentType, 'code-change');
      assert.strictEqual(workItem.status, 'pending');
    });

    it('sets default status to pending', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createWikiTarget(),
      });

      assert.strictEqual(workItem.status, 'pending');
    });

    it('creates work item with wiki target', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createWikiTarget(),
      });

      assert.strictEqual(workItem.target.type, 'wiki');
      assert.strictEqual(isWikiTarget(workItem.target), true);
      assert.strictEqual(workItem.claimedAt, null);
      assert.strictEqual(workItem.completedAt, null);
      assert.strictEqual(workItem.agentRunId, null);
      assert.strictEqual(workItem.orchestratorRunId, null);
    });

    it('creates work item with commit target', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createCommitTarget('abc123def'),
      });

      assert.strictEqual(workItem.target.type, 'commit');
      assert.strictEqual(isCommitTarget(workItem.target), true);
      if (isCommitTarget(workItem.target)) {
        assert.strictEqual(workItem.target.commitId, 'abc123def');
      }
    });

    it('creates work item with path target', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        target: createPathTarget('src/services/llm'),
      });

      assert.strictEqual(workItem.target.type, 'path');
      assert.strictEqual(isPathTarget(workItem.target), true);
      if (isPathTarget(workItem.target)) {
        assert.strictEqual(workItem.target.path, 'src/services/llm');
      }
    });

    it('includes orchestratorRunId when provided for provenance tracking', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createCommitTarget('abc123def'),
        orchestratorRunId: 'orch-run-456',
      });

      assert.strictEqual(workItem.orchestratorRunId, 'orch-run-456');
    });

    it('sets orchestratorRunId to null when not provided', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createWikiTarget(),
      });

      assert.strictEqual(workItem.orchestratorRunId, null);
    });

    it('sets createdAt to current time', () => {
      const before = Date.now();
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createWikiTarget(),
      });
      const after = Date.now();

      assert.ok(workItem.createdAt instanceof Date);
      assert.ok(workItem.createdAt.getTime() >= before);
      assert.ok(workItem.createdAt.getTime() <= after);
    });
  });

  describe('type guards', () => {
    it('isCommitTarget identifies commit targets', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'code-change',
        target: createCommitTarget('sha123'),
      });
      assert.strictEqual(isCommitTarget(workItem.target), true);
      assert.strictEqual(isPathTarget(workItem.target), false);
      assert.strictEqual(isWikiTarget(workItem.target), false);

      if (isCommitTarget(workItem.target)) {
        assert.strictEqual(workItem.target.commitId, 'sha123');
      }
    });

    it('isPathTarget identifies path targets', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'codebase-explorer',
        target: createPathTarget('src/services'),
      });
      assert.strictEqual(isCommitTarget(workItem.target), false);
      assert.strictEqual(isPathTarget(workItem.target), true);
      assert.strictEqual(isWikiTarget(workItem.target), false);

      if (isPathTarget(workItem.target)) {
        assert.strictEqual(workItem.target.path, 'src/services');
      }
    });

    it('isWikiTarget identifies wiki targets', () => {
      const workItem = createWorkItem({
        id: 'work-1',
        repoId: 'repo-1',
        agentType: 'link',
        target: createWikiTarget(),
      });
      assert.strictEqual(isCommitTarget(workItem.target), false);
      assert.strictEqual(isPathTarget(workItem.target), false);
      assert.strictEqual(isWikiTarget(workItem.target), true);
    });
  });
});
