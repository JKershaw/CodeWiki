/**
 * Unit tests for GetWikiTree query.
 * Tests the tree building logic with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createGetWikiTreeQuery,
  handleGetWikiTree,
  buildWikiTree,
  type WikiTreeNode,
} from '../../src/queries/get-wiki-tree.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

// Helper to create a minimal WikiPage for testing
function createTestPage(wikiId: string, path: string, title: string): WikiPage {
  return {
    id: uuid(),
    wikiId,
    path,
    title,
    content: `# ${title}`,
    confidence: 0.8,
    sourceCommits: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Create mock repositories for testing
function createMockRepos(pages: WikiPage[]): Repositories {
  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async () => null,
    findByPath: async () => null,
    findByWiki: async (wikiId) => pages.filter(p => p.wikiId === wikiId),
    findByStatus: async () => [],
    countByWiki: async (wikiId) => pages.filter(p => p.wikiId === wikiId).length,
    search: async () => [],
    save: async () => {},
    delete: async () => {},
    deleteByWiki: async () => {},
    bulkUpdateStatus: async () => {},
  };

  return {
    wikiPages: mockWikiPages,
  } as Repositories;
}

describe('GetWikiTree Query', () => {
  describe('buildWikiTree', () => {
    it('returns empty array for empty wiki', () => {
      const tree = buildWikiTree([]);
      assert.deepStrictEqual(tree, []);
    });

    it('handles single page at root level', () => {
      const wikiId = uuid();
      const pages = [createTestPage(wikiId, 'overview', 'Overview')];

      const tree = buildWikiTree(pages);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0]!.name, 'overview');
      assert.strictEqual(tree[0]!.path, 'overview');
      assert.strictEqual(tree[0]!.page?.title, 'Overview');
      assert.strictEqual(tree[0]!.children.length, 0);
    });

    it('builds two-level hierarchy', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'architecture/cqrs', 'CQRS Pattern'),
        createTestPage(wikiId, 'architecture/events', 'Event Sourcing'),
      ];

      const tree = buildWikiTree(pages);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0]!.name, 'architecture');
      assert.strictEqual(tree[0]!.path, 'architecture');
      assert.strictEqual(tree[0]!.page, undefined); // No page at this path
      assert.strictEqual(tree[0]!.children.length, 2);

      const childNames = tree[0]!.children.map(c => c.name).sort();
      assert.deepStrictEqual(childNames, ['cqrs', 'events']);
    });

    it('builds three-level hierarchy', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'architecture/patterns/cqrs', 'CQRS'),
      ];

      const tree = buildWikiTree(pages);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0]!.name, 'architecture');
      assert.strictEqual(tree[0]!.children.length, 1);
      assert.strictEqual(tree[0]!.children[0]!.name, 'patterns');
      assert.strictEqual(tree[0]!.children[0]!.children.length, 1);
      assert.strictEqual(tree[0]!.children[0]!.children[0]!.name, 'cqrs');
      assert.ok(tree[0]!.children[0]!.children[0]!.page);
    });

    it('handles category with overview page and children', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'security', 'Security Overview'),
        createTestPage(wikiId, 'security/auth', 'Authentication'),
        createTestPage(wikiId, 'security/authz', 'Authorization'),
      ];

      const tree = buildWikiTree(pages);

      assert.strictEqual(tree.length, 1);
      assert.strictEqual(tree[0]!.name, 'security');
      assert.ok(tree[0]!.page); // Has page at this level
      assert.strictEqual(tree[0]!.page?.title, 'Security Overview');
      assert.strictEqual(tree[0]!.children.length, 2);
    });

    it('handles multiple top-level categories', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'architecture/overview', 'Architecture'),
        createTestPage(wikiId, 'security/auth', 'Auth'),
        createTestPage(wikiId, 'testing/unit', 'Unit Tests'),
      ];

      const tree = buildWikiTree(pages);

      assert.strictEqual(tree.length, 3);
      const names = tree.map(n => n.name).sort();
      assert.deepStrictEqual(names, ['architecture', 'security', 'testing']);
    });

    it('sorts nodes alphabetically', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'zebra', 'Zebra'),
        createTestPage(wikiId, 'apple', 'Apple'),
        createTestPage(wikiId, 'mango', 'Mango'),
      ];

      const tree = buildWikiTree(pages);

      const names = tree.map(n => n.name);
      assert.deepStrictEqual(names, ['apple', 'mango', 'zebra']);
    });

    it('sorts children alphabetically', () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'category/zebra', 'Zebra'),
        createTestPage(wikiId, 'category/apple', 'Apple'),
      ];

      const tree = buildWikiTree(pages);

      const childNames = tree[0]!.children.map(c => c.name);
      assert.deepStrictEqual(childNames, ['apple', 'zebra']);
    });
  });

  describe('handleGetWikiTree', () => {
    it('returns tree for wiki with pages', async () => {
      const wikiId = uuid();
      const pages = [
        createTestPage(wikiId, 'architecture/cqrs', 'CQRS'),
        createTestPage(wikiId, 'security/auth', 'Auth'),
      ];
      const repos = createMockRepos(pages);

      const query = createGetWikiTreeQuery(wikiId);
      const result = await handleGetWikiTree(query, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.length, 2);
    });

    it('returns empty tree for wiki with no pages', async () => {
      const wikiId = uuid();
      const repos = createMockRepos([]);

      const query = createGetWikiTreeQuery(wikiId);
      const result = await handleGetWikiTree(query, repos);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, []);
    });

    it('has correct query type', () => {
      const query = createGetWikiTreeQuery('wiki-1');
      assert.strictEqual(query.type, 'GetWikiTree');
      assert.strictEqual(query.wikiId, 'wiki-1');
    });
  });
});
