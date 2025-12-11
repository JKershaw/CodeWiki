/**
 * Unit tests for wiki graph query functionality.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildWikiGraph, type WikiGraph } from '../../src/queries/get-wiki-graph.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

function createTestPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    wikiId: 'wiki-1',
    path: 'test/page',
    title: 'Test Page',
    content: '# Test',
    confidence: 0.8,
    sourceCommits: [],
    sourceAgentRunIds: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('buildWikiGraph', () => {
  it('returns empty graph for empty pages', () => {
    const graph = buildWikiGraph([]);

    assert.strictEqual(graph.nodes.length, 0);
    assert.strictEqual(graph.edges.length, 0);
    assert.strictEqual(graph.stats.nodeCount, 0);
    assert.strictEqual(graph.stats.edgeCount, 0);
    assert.strictEqual(graph.stats.avgLinks, 0);
    assert.deepStrictEqual(graph.stats.categories, []);
  });

  it('creates nodes from pages', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'arch/overview', title: 'Architecture Overview', category: 'architecture', confidence: 0.9 }),
      createTestPage({ id: 'p2', path: 'api/endpoints', title: 'API Endpoints', category: 'api', confidence: 0.7 }),
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.nodes.length, 2);

    const node1 = graph.nodes.find(n => n.id === 'p1');
    assert.ok(node1);
    assert.strictEqual(node1.path, 'arch/overview');
    assert.strictEqual(node1.title, 'Architecture Overview');
    assert.strictEqual(node1.category, 'architecture');
    assert.strictEqual(node1.confidence, 0.9);

    const node2 = graph.nodes.find(n => n.id === 'p2');
    assert.ok(node2);
    assert.strictEqual(node2.path, 'api/endpoints');
    assert.strictEqual(node2.category, 'api');
  });

  it('creates edges from links between pages', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'arch/overview', links: ['api/endpoints'] }),
      createTestPage({ id: 'p2', path: 'api/endpoints', links: ['arch/overview'], backlinks: ['arch/overview'] }),
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.edges.length, 2);

    const edge1 = graph.edges.find(e => e.source === 'p1' && e.target === 'p2');
    assert.ok(edge1, 'Should have edge from p1 to p2');
    assert.strictEqual(edge1.id, 'p1->p2');

    const edge2 = graph.edges.find(e => e.source === 'p2' && e.target === 'p1');
    assert.ok(edge2, 'Should have edge from p2 to p1');
  });

  it('ignores links to non-existent pages', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'existing', links: ['non-existent', 'also-missing'] }),
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.edges.length, 0, 'Should not create edges to non-existent pages');
  });

  it('tracks link and backlink counts', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'hub', links: ['spoke1', 'spoke2', 'spoke3'] }),
      createTestPage({ id: 'p2', path: 'spoke1', backlinks: ['hub'] }),
      createTestPage({ id: 'p3', path: 'spoke2', backlinks: ['hub'] }),
      createTestPage({ id: 'p4', path: 'spoke3', backlinks: ['hub'] }),
    ];

    const graph = buildWikiGraph(pages);

    const hubNode = graph.nodes.find(n => n.id === 'p1');
    assert.ok(hubNode);
    assert.strictEqual(hubNode.linkCount, 3);
    assert.strictEqual(hubNode.backlinkCount, 0);

    const spokeNode = graph.nodes.find(n => n.id === 'p2');
    assert.ok(spokeNode);
    assert.strictEqual(spokeNode.linkCount, 0);
    assert.strictEqual(spokeNode.backlinkCount, 1);
  });

  it('calculates statistics correctly', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'a', category: 'cat1', links: ['b'] }),
      createTestPage({ id: 'p2', path: 'b', category: 'cat2', links: ['a', 'c'] }),
      createTestPage({ id: 'p3', path: 'c', category: 'cat1', links: [] }),
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.stats.nodeCount, 3);
    assert.strictEqual(graph.stats.edgeCount, 3); // a->b, b->a, b->c
    assert.strictEqual(graph.stats.avgLinks, 1); // 3 edges / 3 nodes
    assert.deepStrictEqual(graph.stats.categories.sort(), ['cat1', 'cat2']);
  });

  it('handles pages without categories', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'a', category: 'has-cat' }),
      createTestPage({ id: 'p2', path: 'b', category: undefined }),
      createTestPage({ id: 'p3', path: 'c' }), // no category field
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.stats.categories.length, 1);
    assert.deepStrictEqual(graph.stats.categories, ['has-cat']);
  });

  it('handles self-links', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'self-referential', links: ['self-referential'] }),
    ];

    const graph = buildWikiGraph(pages);

    assert.strictEqual(graph.edges.length, 1);
    const selfEdge = graph.edges[0];
    assert.strictEqual(selfEdge?.source, 'p1');
    assert.strictEqual(selfEdge?.target, 'p1');
  });

  it('preserves updatedAt for real-time tracking', () => {
    const now = new Date();
    const pages: WikiPage[] = [
      createTestPage({ id: 'p1', path: 'a', updatedAt: now }),
    ];

    const graph = buildWikiGraph(pages);

    const node = graph.nodes[0];
    assert.ok(node);
    assert.strictEqual(node.updatedAt.getTime(), now.getTime());
  });
});

describe('WikiGraph structure', () => {
  it('nodes contain all required fields for visualization', () => {
    const page = createTestPage({
      id: 'test-id',
      path: 'test/path',
      title: 'Test Title',
      category: 'test-category',
      confidence: 0.85,
      links: ['other'],
      backlinks: ['another'],
    });

    const graph = buildWikiGraph([page]);
    const node = graph.nodes[0];

    assert.ok(node);
    // All fields needed for graph visualization
    assert.ok('id' in node, 'Node must have id');
    assert.ok('path' in node, 'Node must have path');
    assert.ok('title' in node, 'Node must have title');
    assert.ok('category' in node, 'Node must have category');
    assert.ok('confidence' in node, 'Node must have confidence');
    assert.ok('linkCount' in node, 'Node must have linkCount');
    assert.ok('backlinkCount' in node, 'Node must have backlinkCount');
    assert.ok('updatedAt' in node, 'Node must have updatedAt');
  });

  it('edges contain source and target for rendering', () => {
    const pages: WikiPage[] = [
      createTestPage({ id: 'src', path: 'source', links: ['target'] }),
      createTestPage({ id: 'tgt', path: 'target' }),
    ];

    const graph = buildWikiGraph(pages);
    const edge = graph.edges[0];

    assert.ok(edge);
    assert.ok('id' in edge, 'Edge must have id');
    assert.ok('source' in edge, 'Edge must have source');
    assert.ok('target' in edge, 'Edge must have target');
    assert.strictEqual(edge.source, 'src');
    assert.strictEqual(edge.target, 'tgt');
  });
});
