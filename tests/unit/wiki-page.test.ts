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

    it('initializes empty filesAccessed when not provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.filesAccessed, []);
    });

    it('includes filesAccessed when provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        filesAccessed: ['src/utils.ts', 'src/config.json'],
      });

      assert.deepStrictEqual(page.filesAccessed, ['src/utils.ts', 'src/config.json']);
    });

    it('initializes empty filesReferenced when not provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.filesReferenced, []);
    });

    it('includes filesReferenced when provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        filesReferenced: ['src/api.ts', 'README.md'],
      });

      assert.deepStrictEqual(page.filesReferenced, ['src/api.ts', 'README.md']);
    });

    it('initializes empty targetPaths when not provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
      });

      assert.deepStrictEqual(page.targetPaths, []);
    });

    it('includes targetPaths when provided', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        targetPaths: ['src/services/', 'src/utils/'],
      });

      assert.deepStrictEqual(page.targetPaths, ['src/services/', 'src/utils/']);
    });

    it('includes all file coverage fields together', () => {
      const page = createWikiPage({
        id: 'page-1',
        wikiId: 'wiki-1',
        path: 'test/page',
        title: 'Test',
        content: 'Content',
        filesAccessed: ['src/a.ts'],
        filesReferenced: ['src/b.ts'],
        targetPaths: ['src/'],
      });

      assert.deepStrictEqual(page.filesAccessed, ['src/a.ts']);
      assert.deepStrictEqual(page.filesReferenced, ['src/b.ts']);
      assert.deepStrictEqual(page.targetPaths, ['src/']);
    });
  });
});
