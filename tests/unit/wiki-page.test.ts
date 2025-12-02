/**
 * Unit tests for WikiPage domain model.
 * Tests creation and provenance tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createWikiPage, type WikiPage } from '../../src/domain/wiki-page.js';

describe('WikiPage', () => {
  describe('createWikiPage', () => {
    it('creates a wiki page with required fields', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'architecture/overview',
        title: 'Architecture Overview',
        content: '# Architecture Overview\n\nThis is the overview.',
      });

      assert.strictEqual(page.id, 'page-1');
      assert.strictEqual(page.wikiId, 'wiki-1');
      assert.strictEqual(page.path, 'architecture/overview');
      assert.strictEqual(page.title, 'Architecture Overview');
      assert.strictEqual(page.content, '# Architecture Overview\n\nThis is the overview.');
    });

    it('sets default confidence to 0.5', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.strictEqual(page.confidence, 0.5);
    });

    it('initializes empty arrays for links and backlinks', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.links, []);
      assert.deepStrictEqual(page.backlinks, []);
    });

    it('initializes empty sourceCommits when not provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.sourceCommits, []);
    });

    it('includes sourceCommitId when provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        sourceCommitId: 'abc123def',
      });

      assert.deepStrictEqual(page.sourceCommits, ['abc123def']);
    });

    it('initializes empty sourceAgentRunIds when not provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.sourceAgentRunIds, []);
    });

    it('includes sourceAgentRunId when provided for provenance tracking', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        sourceAgentRunId: 'agent-run-456',
      });

      assert.deepStrictEqual(page.sourceAgentRunIds, ['agent-run-456']);
    });

    it('includes both sourceCommitId and sourceAgentRunId when provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        sourceCommitId: 'abc123def',
        sourceAgentRunId: 'agent-run-456',
      });

      assert.deepStrictEqual(page.sourceCommits, ['abc123def']);
      assert.deepStrictEqual(page.sourceAgentRunIds, ['agent-run-456']);
    });

    it('sets createdAt and updatedAt to current time', () => {
      const before = Date.now();
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });
      const after = Date.now();

      assert.ok(page.createdAt instanceof Date);
      assert.ok(page.updatedAt instanceof Date);
      assert.ok(page.createdAt.getTime() >= before);
      assert.ok(page.createdAt.getTime() <= after);
      assert.ok(page.updatedAt.getTime() >= before);
      assert.ok(page.updatedAt.getTime() <= after);
    });
  });
});
