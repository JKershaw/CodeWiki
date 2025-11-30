/**
 * Unit tests for EditRequestRepository.
 * Tests edit request storage, querying, and status management.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { FileEditRequestRepository } from '../../src/repositories/file-based/file-edit-request-repository.js';
import { createEditRequest, type EditRequest } from '../../src/domain/edit-request.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EditRequestRepository', () => {
  let repo: FileEditRequestRepository;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'edit-request-test-'));
    repo = new FileEditRequestRepository(tempDir);
  });

  /**
   * Helper to create an edit request with sensible defaults.
   */
  function createTestEditRequest(overrides: Partial<{
    id: string;
    wikiId: string;
    repoId: string;
    sourceCommitSha: string;
    sourceCommitTimestamp: Date;
    targetPagePath: string;
    proposedContent: string;
    status: 'pending' | 'applied' | 'merged-to-history' | 'skipped' | 'conflict';
  }> = {}): EditRequest {
    const editRequest = createEditRequest({
      id: overrides.id ?? uuid(),
      repoId: overrides.repoId ?? 'repo-1',
      wikiId: overrides.wikiId ?? 'wiki-1',
      sourceCommitSha: overrides.sourceCommitSha ?? 'abc123',
      sourceCommitTimestamp: overrides.sourceCommitTimestamp ?? new Date(),
      sourceAgentType: 'code-change',
      sourceAgentRunId: 'run-1',
      targetPagePath: overrides.targetPagePath ?? 'docs/api',
      proposedUpdateType: 'update',
      proposedContent: overrides.proposedContent ?? '# Content',
      confidenceDelta: 0.1,
    });

    if (overrides.status && overrides.status !== 'pending') {
      (editRequest as any).status = overrides.status;
    }

    return editRequest;
  }

  describe('save and findById', () => {
    it('saves and retrieves an edit request by id', async () => {
      const editRequest = createTestEditRequest({ id: 'edit-1' });

      await repo.save(editRequest);
      const retrieved = await repo.findById('edit-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'edit-1');
      assert.strictEqual(retrieved.status, 'pending');
      assert.strictEqual(retrieved.targetPagePath, 'docs/api');
    });

    it('returns null for non-existent edit request', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const editRequest = createTestEditRequest({
        sourceCommitTimestamp: timestamp,
      });

      await repo.save(editRequest);
      const retrieved = await repo.findById(editRequest.id);

      assert.ok(retrieved);
      assert.ok(retrieved.sourceCommitTimestamp instanceof Date);
      assert.strictEqual(retrieved.sourceCommitTimestamp.getTime(), timestamp.getTime());
    });
  });

  describe('findPending', () => {
    it('returns only pending edit requests for a wiki', async () => {
      const pending1 = createTestEditRequest({ wikiId: 'wiki-1' });
      const pending2 = createTestEditRequest({ wikiId: 'wiki-1' });
      const applied = createTestEditRequest({ wikiId: 'wiki-1', status: 'applied' });
      const otherWiki = createTestEditRequest({ wikiId: 'wiki-2' });

      await repo.saveMany([pending1, pending2, applied, otherWiki]);

      const results = await repo.findPending('wiki-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.status === 'pending'));
      assert.ok(results.every(r => r.wikiId === 'wiki-1'));
    });

    it('orders results by commit timestamp (oldest first)', async () => {
      const older = createTestEditRequest({
        sourceCommitTimestamp: new Date('2024-01-01T10:00:00Z'),
      });
      const newer = createTestEditRequest({
        sourceCommitTimestamp: new Date('2024-01-15T10:00:00Z'),
      });
      const middle = createTestEditRequest({
        sourceCommitTimestamp: new Date('2024-01-10T10:00:00Z'),
      });

      await repo.saveMany([newer, older, middle]);

      const results = await repo.findPending('wiki-1');
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0]!.sourceCommitTimestamp.getTime(), older.sourceCommitTimestamp.getTime());
      assert.strictEqual(results[1]!.sourceCommitTimestamp.getTime(), middle.sourceCommitTimestamp.getTime());
      assert.strictEqual(results[2]!.sourceCommitTimestamp.getTime(), newer.sourceCommitTimestamp.getTime());
    });

    it('returns empty array when no pending requests', async () => {
      const applied = createTestEditRequest({ status: 'applied' });
      await repo.save(applied);

      const results = await repo.findPending('wiki-1');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('findByPagePath', () => {
    it('returns edit requests for a specific page', async () => {
      const page1Edit1 = createTestEditRequest({ targetPagePath: 'docs/api' });
      const page1Edit2 = createTestEditRequest({ targetPagePath: 'docs/api' });
      const page2Edit = createTestEditRequest({ targetPagePath: 'docs/guide' });

      await repo.saveMany([page1Edit1, page1Edit2, page2Edit]);

      const results = await repo.findByPagePath('wiki-1', 'docs/api');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.targetPagePath === 'docs/api'));
    });
  });

  describe('findByCommit', () => {
    it('returns edit requests for a specific commit', async () => {
      const commit1Edit = createTestEditRequest({ sourceCommitSha: 'abc123' });
      const commit2Edit = createTestEditRequest({ sourceCommitSha: 'def456' });

      await repo.saveMany([commit1Edit, commit2Edit]);

      const results = await repo.findByCommit('repo-1', 'abc123');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.sourceCommitSha, 'abc123');
    });
  });

  describe('findByAgentRun', () => {
    it('returns edit requests created by a specific agent run', async () => {
      const run1Edit1 = createTestEditRequest();
      const run1Edit2 = createTestEditRequest();

      await repo.saveMany([run1Edit1, run1Edit2]);

      const results = await repo.findByAgentRun('run-1');
      assert.strictEqual(results.length, 2);
    });
  });

  describe('findByStatus', () => {
    it('returns edit requests with a specific status', async () => {
      const pending = createTestEditRequest();
      const applied = createTestEditRequest({ status: 'applied' });
      const skipped = createTestEditRequest({ status: 'skipped' });

      await repo.saveMany([pending, applied, skipped]);

      const appliedResults = await repo.findByStatus('wiki-1', 'applied');
      assert.strictEqual(appliedResults.length, 1);
      assert.strictEqual(appliedResults[0]!.status, 'applied');

      const skippedResults = await repo.findByStatus('wiki-1', 'skipped');
      assert.strictEqual(skippedResults.length, 1);
      assert.strictEqual(skippedResults[0]!.status, 'skipped');
    });
  });

  describe('countPending', () => {
    it('counts pending edit requests for a wiki', async () => {
      const pending1 = createTestEditRequest({ wikiId: 'wiki-1' });
      const pending2 = createTestEditRequest({ wikiId: 'wiki-1' });
      const applied = createTestEditRequest({ wikiId: 'wiki-1', status: 'applied' });
      const otherWiki = createTestEditRequest({ wikiId: 'wiki-2' });

      await repo.saveMany([pending1, pending2, applied, otherWiki]);

      const count = await repo.countPending('wiki-1');
      assert.strictEqual(count, 2);
    });

    it('returns 0 when no pending requests', async () => {
      const count = await repo.countPending('wiki-1');
      assert.strictEqual(count, 0);
    });
  });

  describe('hasPendingForPage', () => {
    it('returns true when page has pending requests', async () => {
      const editRequest = createTestEditRequest({ targetPagePath: 'docs/api' });
      await repo.save(editRequest);

      const hasPending = await repo.hasPendingForPage('wiki-1', 'docs/api');
      assert.strictEqual(hasPending, true);
    });

    it('returns false when page has no pending requests', async () => {
      const applied = createTestEditRequest({ targetPagePath: 'docs/api', status: 'applied' });
      await repo.save(applied);

      const hasPending = await repo.hasPendingForPage('wiki-1', 'docs/api');
      assert.strictEqual(hasPending, false);
    });

    it('returns false for non-existent page', async () => {
      const hasPending = await repo.hasPendingForPage('wiki-1', 'docs/nonexistent');
      assert.strictEqual(hasPending, false);
    });
  });

  describe('markProcessed', () => {
    it('marks an edit request as processed with status and notes', async () => {
      const editRequest = createTestEditRequest();
      await repo.save(editRequest);

      await repo.markProcessed(editRequest.id, 'applied', 'Applied normally', 'run-2');

      const updated = await repo.findById(editRequest.id);
      assert.ok(updated);
      assert.strictEqual(updated.status, 'applied');
      assert.strictEqual(updated.processingNotes, 'Applied normally');
      assert.strictEqual(updated.processedByAgentRunId, 'run-2');
      assert.ok(updated.processedAt instanceof Date);
    });

    it('sets processedAt timestamp', async () => {
      const editRequest = createTestEditRequest();
      await repo.save(editRequest);

      const before = Date.now();
      await repo.markProcessed(editRequest.id, 'skipped', 'Content superseded', 'run-2');
      const after = Date.now();

      const updated = await repo.findById(editRequest.id);
      assert.ok(updated);
      assert.ok(updated.processedAt!.getTime() >= before);
      assert.ok(updated.processedAt!.getTime() <= after);
    });

    it('supports all status transitions', async () => {
      const statuses: Array<'applied' | 'merged-to-history' | 'skipped' | 'conflict'> = [
        'applied',
        'merged-to-history',
        'skipped',
        'conflict',
      ];

      for (const status of statuses) {
        const editRequest = createTestEditRequest();
        await repo.save(editRequest);

        await repo.markProcessed(editRequest.id, status, `Marked as ${status}`, 'run-2');

        const updated = await repo.findById(editRequest.id);
        assert.ok(updated);
        assert.strictEqual(updated.status, status);
      }
    });
  });

  describe('delete operations', () => {
    it('deletes an edit request by id', async () => {
      const editRequest = createTestEditRequest();
      await repo.save(editRequest);

      await repo.delete(editRequest.id);

      const result = await repo.findById(editRequest.id);
      assert.strictEqual(result, null);
    });

    it('deletes all edit requests for a wiki', async () => {
      const wiki1Edit1 = createTestEditRequest({ wikiId: 'wiki-1' });
      const wiki1Edit2 = createTestEditRequest({ wikiId: 'wiki-1' });
      const wiki2Edit = createTestEditRequest({ wikiId: 'wiki-2' });

      await repo.saveMany([wiki1Edit1, wiki1Edit2, wiki2Edit]);
      await repo.deleteByWiki('wiki-1');

      const wiki1Results = await repo.findPending('wiki-1');
      const wiki2Results = await repo.findPending('wiki-2');

      assert.strictEqual(wiki1Results.length, 0);
      assert.strictEqual(wiki2Results.length, 1);
    });

    it('deletes edit requests by agent run', async () => {
      const run1Edit = createTestEditRequest();
      // Create another edit request with different agent run
      const run2Edit = createEditRequest({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        sourceCommitSha: 'abc123',
        sourceCommitTimestamp: new Date(),
        sourceAgentType: 'narrative',
        sourceAgentRunId: 'run-2',
        targetPagePath: 'docs/guide',
        proposedUpdateType: 'update',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      await repo.saveMany([run1Edit, run2Edit]);
      await repo.deleteByAgentRun('run-1');

      const run1Results = await repo.findByAgentRun('run-1');
      const run2Results = await repo.findByAgentRun('run-2');

      assert.strictEqual(run1Results.length, 0);
      assert.strictEqual(run2Results.length, 1);
    });
  });

  describe('getOldestPendingTimestamp', () => {
    it('returns timestamp of oldest pending request', async () => {
      const oldest = createTestEditRequest({
        sourceCommitTimestamp: new Date('2024-01-01T10:00:00Z'),
      });
      const newer = createTestEditRequest({
        sourceCommitTimestamp: new Date('2024-01-15T10:00:00Z'),
      });

      await repo.saveMany([newer, oldest]);

      const timestamp = await repo.getOldestPendingTimestamp('wiki-1');
      assert.ok(timestamp);
      assert.strictEqual(timestamp.getTime(), oldest.sourceCommitTimestamp.getTime());
    });

    it('returns null when no pending requests', async () => {
      const applied = createTestEditRequest({ status: 'applied' });
      await repo.save(applied);

      const timestamp = await repo.getOldestPendingTimestamp('wiki-1');
      assert.strictEqual(timestamp, null);
    });
  });

  describe('saveMany', () => {
    it('saves multiple edit requests atomically', async () => {
      const editRequests = [
        createTestEditRequest({ id: 'edit-1' }),
        createTestEditRequest({ id: 'edit-2' }),
        createTestEditRequest({ id: 'edit-3' }),
      ];

      await repo.saveMany(editRequests);

      const count = await repo.countPending('wiki-1');
      assert.strictEqual(count, 3);

      for (const er of editRequests) {
        const retrieved = await repo.findById(er.id);
        assert.ok(retrieved);
      }
    });

    it('handles empty array', async () => {
      await repo.saveMany([]);
      const count = await repo.countPending('wiki-1');
      assert.strictEqual(count, 0);
    });
  });
});
