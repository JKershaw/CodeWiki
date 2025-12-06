/**
 * Unit tests for WikiPageHistory domain entity.
 * Tests the creation and validation of wiki page history records.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createWikiPageHistory,
  type WikiPageHistory,
  type WikiPageHistoryOperation,
} from '../../src/domain/wiki-page-history.js';

describe('WikiPageHistory Domain', () => {
  describe('createWikiPageHistory', () => {
    it('creates a history record for page creation', () => {
      const history = createWikiPageHistory({
        id: 'history-1',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/api',
        operation: 'create',
        contentBefore: null,
        contentAfter: '# API Documentation\n\nNew content here.',
        agentRunId: 'run-1',
        agentType: 'bootstrap',
        sequenceNumber: 1,
      });

      assert.strictEqual(history.id, 'history-1');
      assert.strictEqual(history.wikiId, 'wiki-1');
      assert.strictEqual(history.pageId, 'page-1');
      assert.strictEqual(history.pagePath, 'docs/api');
      assert.strictEqual(history.operation, 'create');
      assert.strictEqual(history.contentBefore, null);
      assert.strictEqual(history.contentAfter, '# API Documentation\n\nNew content here.');
      assert.strictEqual(history.agentRunId, 'run-1');
      assert.strictEqual(history.agentType, 'bootstrap');
      assert.ok(history.timestamp instanceof Date);
    });

    it('creates a history record for page update', () => {
      const history = createWikiPageHistory({
        id: 'history-2',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/api',
        operation: 'update',
        contentBefore: '# API Documentation\n\nOld content.',
        contentAfter: '# API Documentation\n\nUpdated content with more details.',
        agentRunId: 'run-2',
        workItemId: 'work-1',
        editRequestId: 'edit-1',
        agentType: 'wiki-editor',
        sequenceNumber: 2,
      });

      assert.strictEqual(history.operation, 'update');
      assert.strictEqual(history.contentBefore, '# API Documentation\n\nOld content.');
      assert.strictEqual(history.contentAfter, '# API Documentation\n\nUpdated content with more details.');
      assert.strictEqual(history.workItemId, 'work-1');
      assert.strictEqual(history.editRequestId, 'edit-1');
      assert.strictEqual(history.agentType, 'wiki-editor');
    });

    it('creates a history record for page deletion', () => {
      const history = createWikiPageHistory({
        id: 'history-3',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/old-page',
        operation: 'delete',
        contentBefore: '# Old Page\n\nThis page is being removed.',
        contentAfter: null,
        agentRunId: 'run-3',
        agentType: 'wiki-editor',
        sequenceNumber: 3,
      });

      assert.strictEqual(history.operation, 'delete');
      assert.strictEqual(history.contentBefore, '# Old Page\n\nThis page is being removed.');
      assert.strictEqual(history.contentAfter, null);
    });

    it('sets timestamp to current time when not provided', () => {
      const before = new Date();
      const history = createWikiPageHistory({
        id: 'history-4',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/test',
        operation: 'create',
        contentBefore: null,
        contentAfter: 'content',
        agentType: 'bootstrap',
        sequenceNumber: 4,
      });
      const after = new Date();

      assert.ok(history.timestamp >= before);
      assert.ok(history.timestamp <= after);
    });

    it('accepts optional provenance fields', () => {
      // No agentRunId - manual edit
      const history = createWikiPageHistory({
        id: 'history-5',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/test',
        operation: 'update',
        contentBefore: 'old',
        contentAfter: 'new',
        agentType: 'manual',
        sequenceNumber: 5,
      });

      assert.strictEqual(history.agentRunId, undefined);
      assert.strictEqual(history.workItemId, undefined);
      assert.strictEqual(history.editRequestId, undefined);
      assert.strictEqual(history.agentType, 'manual');
    });

    it('preserves page path for renamed pages', () => {
      // When a page is renamed, we capture the path at time of change
      const history = createWikiPageHistory({
        id: 'history-6',
        wikiId: 'wiki-1',
        pageId: 'page-1',
        pagePath: 'docs/old-name', // Original path at time of edit
        operation: 'update',
        contentBefore: 'content',
        contentAfter: 'content v2',
        agentType: 'wiki-editor',
        sequenceNumber: 6,
      });

      assert.strictEqual(history.pagePath, 'docs/old-name');
    });
  });

  describe('agent types', () => {
    it('supports all expected agent types', () => {
      const agentTypes: Array<WikiPageHistory['agentType']> = [
        'bootstrap',
        'wiki-editor',
        'manual',
        'unknown',
      ];

      for (const agentType of agentTypes) {
        const history = createWikiPageHistory({
          id: `history-${agentType}`,
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/test',
          operation: 'update',
          contentBefore: 'old',
          contentAfter: 'new',
          agentType,
          sequenceNumber: 1,
        });
        assert.strictEqual(history.agentType, agentType);
      }
    });
  });

  describe('operations', () => {
    it('supports all expected operations', () => {
      const operations: WikiPageHistoryOperation[] = ['create', 'update', 'delete'];

      for (const operation of operations) {
        const history = createWikiPageHistory({
          id: `history-${operation}`,
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/test',
          operation,
          contentBefore: operation === 'create' ? null : 'old',
          contentAfter: operation === 'delete' ? null : 'new',
          agentType: 'wiki-editor',
          sequenceNumber: 1,
        });
        assert.strictEqual(history.operation, operation);
      }
    });
  });
});
