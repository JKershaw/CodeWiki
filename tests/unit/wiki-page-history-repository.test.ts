/**
 * Unit tests for WikiPageHistoryRepository.
 * Tests wiki page history storage and querying.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection, type WikiPageHistoryRepository } from '../../src/repositories/index.js';
import {
  createWikiPageHistory,
  type WikiPageHistory,
} from '../../src/domain/wiki-page-history.js';

describe('WikiPageHistoryRepository', () => {
  let connection: RepositoryConnection;
  let repo: WikiPageHistoryRepository;

  let sequenceCounter = 0;

  beforeEach(async () => {
    connection = await createRepositories({ mongoDbName: `test-history-${uuid()}` });
    repo = connection.repositories.wikiPageHistory;
    sequenceCounter = 0;
  });

  afterEach(async () => {
    await connection.close();
  });

  /**
   * Helper to create a history record with sensible defaults.
   */
  function createTestHistory(overrides: Partial<{
    id: string;
    wikiId: string;
    pageId: string;
    pagePath: string;
    operation: WikiPageHistory['operation'];
    contentBefore: string | null;
    contentAfter: string | null;
    agentRunId: string;
    workItemId: string;
    editRequestId: string;
    agentType: WikiPageHistory['agentType'];
    timestamp: Date;
    sequenceNumber: number;
  }> = {}): WikiPageHistory {
    sequenceCounter++;
    return createWikiPageHistory({
      id: overrides.id ?? uuid(),
      wikiId: overrides.wikiId ?? 'wiki-1',
      pageId: overrides.pageId ?? 'page-1',
      pagePath: overrides.pagePath ?? 'docs/api',
      operation: overrides.operation ?? 'update',
      contentBefore: overrides.contentBefore ?? 'old content',
      contentAfter: overrides.contentAfter ?? 'new content',
      agentRunId: overrides.agentRunId,
      workItemId: overrides.workItemId,
      editRequestId: overrides.editRequestId,
      agentType: overrides.agentType ?? 'wiki-editor',
      timestamp: overrides.timestamp,
      sequenceNumber: overrides.sequenceNumber ?? sequenceCounter,
    });
  }

  describe('save and findById', () => {
    it('saves and retrieves a history record by id', async () => {
      const history = createTestHistory({ id: 'history-1' });

      await repo.save(history);
      const retrieved = await repo.findById('history-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'history-1');
      assert.strictEqual(retrieved.wikiId, 'wiki-1');
      assert.strictEqual(retrieved.pageId, 'page-1');
      assert.strictEqual(retrieved.pagePath, 'docs/api');
      assert.strictEqual(retrieved.operation, 'update');
    });

    it('returns null for non-existent history record', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const history = createTestHistory({ timestamp });

      await repo.save(history);
      const retrieved = await repo.findById(history.id);

      assert.ok(retrieved);
      assert.ok(retrieved.timestamp instanceof Date);
      assert.strictEqual(retrieved.timestamp.getTime(), timestamp.getTime());
    });
  });

  describe('findByPage', () => {
    it('returns history for a specific page ordered by timestamp desc', async () => {
      const older = createTestHistory({
        pageId: 'page-1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      });
      const newer = createTestHistory({
        pageId: 'page-1',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });
      const otherPage = createTestHistory({
        pageId: 'page-2',
      });

      await repo.save(older);
      await repo.save(newer);
      await repo.save(otherPage);

      const results = await repo.findByPage('page-1');
      assert.strictEqual(results.length, 2);
      // Should be ordered newest first
      assert.strictEqual(results[0]!.timestamp.getTime(), newer.timestamp.getTime());
      assert.strictEqual(results[1]!.timestamp.getTime(), older.timestamp.getTime());
    });

    it('returns empty array for page with no history', async () => {
      const results = await repo.findByPage('nonexistent');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('findByWiki', () => {
    it('returns all history for a wiki ordered by timestamp desc', async () => {
      const wiki1History1 = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-01'),
      });
      const wiki1History2 = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-15'),
      });
      const wiki2History = createTestHistory({
        wikiId: 'wiki-2',
      });

      await repo.save(wiki1History1);
      await repo.save(wiki1History2);
      await repo.save(wiki2History);

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.wikiId === 'wiki-1'));
    });
  });

  describe('findByAgentRun', () => {
    it('returns all history for a specific agent run', async () => {
      const run1History1 = createTestHistory({ agentRunId: 'run-1' });
      const run1History2 = createTestHistory({ agentRunId: 'run-1' });
      const run2History = createTestHistory({ agentRunId: 'run-2' });

      await repo.save(run1History1);
      await repo.save(run1History2);
      await repo.save(run2History);

      const results = await repo.findByAgentRun('run-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.agentRunId === 'run-1'));
    });
  });

  describe('findByTimeRange', () => {
    it('returns history within a time range', async () => {
      const before = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-01'),
      });
      const during = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-15'),
      });
      const after = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-02-01'),
      });

      await repo.save(before);
      await repo.save(during);
      await repo.save(after);

      const start = new Date('2024-01-10');
      const end = new Date('2024-01-20');
      const results = await repo.findByTimeRange('wiki-1', start, end);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.id, during.id);
    });

    it('includes boundaries in the range', async () => {
      const exactStart = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-10T00:00:00Z'),
      });
      const exactEnd = createTestHistory({
        wikiId: 'wiki-1',
        timestamp: new Date('2024-01-20T00:00:00Z'),
      });

      await repo.save(exactStart);
      await repo.save(exactEnd);

      const start = new Date('2024-01-10T00:00:00Z');
      const end = new Date('2024-01-20T00:00:00Z');
      const results = await repo.findByTimeRange('wiki-1', start, end);

      assert.strictEqual(results.length, 2);
    });
  });

  describe('findByPagePath', () => {
    it('returns history for a specific page path across versions', async () => {
      const oldPath = createTestHistory({
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/old-name',
      });
      const newPath = createTestHistory({
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/new-name',
      });

      await repo.save(oldPath);
      await repo.save(newPath);

      const oldResults = await repo.findByPagePath('wiki-1', 'docs/old-name');
      assert.strictEqual(oldResults.length, 1);
      assert.strictEqual(oldResults[0]!.pagePath, 'docs/old-name');
    });
  });

  describe('delete operations', () => {
    it('deletes a history record by id', async () => {
      const history = createTestHistory({ id: 'history-1' });
      await repo.save(history);

      await repo.delete('history-1');

      const result = await repo.findById('history-1');
      assert.strictEqual(result, null);
    });

    it('deletes all history for a wiki', async () => {
      const wiki1History = createTestHistory({ wikiId: 'wiki-1' });
      const wiki2History = createTestHistory({ wikiId: 'wiki-2' });

      await repo.save(wiki1History);
      await repo.save(wiki2History);

      await repo.deleteByWiki('wiki-1');

      const wiki1Results = await repo.findByWiki('wiki-1');
      const wiki2Results = await repo.findByWiki('wiki-2');

      assert.strictEqual(wiki1Results.length, 0);
      assert.strictEqual(wiki2Results.length, 1);
    });

    it('deletes all history for a page', async () => {
      const page1History1 = createTestHistory({ pageId: 'page-1' });
      const page1History2 = createTestHistory({ pageId: 'page-1' });
      const page2History = createTestHistory({ pageId: 'page-2' });

      await repo.save(page1History1);
      await repo.save(page1History2);
      await repo.save(page2History);

      await repo.deleteByPage('page-1');

      const page1Results = await repo.findByPage('page-1');
      const page2Results = await repo.findByPage('page-2');

      assert.strictEqual(page1Results.length, 0);
      assert.strictEqual(page2Results.length, 1);
    });
  });

  describe('countByWiki', () => {
    it('counts history records for a wiki', async () => {
      const wiki1History1 = createTestHistory({ wikiId: 'wiki-1' });
      const wiki1History2 = createTestHistory({ wikiId: 'wiki-1' });
      const wiki2History = createTestHistory({ wikiId: 'wiki-2' });

      await repo.save(wiki1History1);
      await repo.save(wiki1History2);
      await repo.save(wiki2History);

      const count = await repo.countByWiki('wiki-1');
      assert.strictEqual(count, 2);
    });

    it('returns 0 for wiki with no history', async () => {
      const count = await repo.countByWiki('nonexistent');
      assert.strictEqual(count, 0);
    });
  });

  describe('getLatestByPage', () => {
    it('returns the most recent history for a page', async () => {
      const older = createTestHistory({
        pageId: 'page-1',
        timestamp: new Date('2024-01-01'),
        contentAfter: 'older content',
      });
      const newer = createTestHistory({
        pageId: 'page-1',
        timestamp: new Date('2024-01-15'),
        contentAfter: 'newer content',
      });

      await repo.save(older);
      await repo.save(newer);

      const latest = await repo.getLatestByPage('page-1');
      assert.ok(latest);
      assert.strictEqual(latest.contentAfter, 'newer content');
    });

    it('returns null for page with no history', async () => {
      const latest = await repo.getLatestByPage('nonexistent');
      assert.strictEqual(latest, null);
    });
  });
});
