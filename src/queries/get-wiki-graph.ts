/**
 * Query to get wiki pages as a graph of nodes and edges.
 * Used for graph visualization of wiki structure and relationships.
 */

import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * A node in the wiki graph.
 */
export interface WikiGraphNode {
  /** Unique identifier (page ID) */
  id: string;
  /** Page path */
  path: string;
  /** Page title */
  title: string;
  /** Category for coloring */
  category?: string;
  /** Confidence score (0-1) for sizing/styling */
  confidence: number;
  /** Number of outgoing links */
  linkCount: number;
  /** Number of incoming links */
  backlinkCount: number;
  /** When the page was last updated */
  updatedAt: Date;
}

/**
 * An edge in the wiki graph.
 */
export interface WikiGraphEdge {
  /** Unique identifier for the edge */
  id: string;
  /** Source node ID (page that contains the link) */
  source: string;
  /** Target node ID (page being linked to) */
  target: string;
}

/**
 * The complete wiki graph structure.
 */
export interface WikiGraph {
  /** All nodes in the graph */
  nodes: WikiGraphNode[];
  /** All edges in the graph */
  edges: WikiGraphEdge[];
  /** Statistics about the graph */
  stats: {
    /** Total number of pages */
    nodeCount: number;
    /** Total number of links */
    edgeCount: number;
    /** Average links per page */
    avgLinks: number;
    /** Categories present in the graph */
    categories: string[];
  };
}

/**
 * Query to get wiki graph data.
 */
export interface GetWikiGraphQuery extends Query {
  readonly type: 'GetWikiGraph';
  readonly wikiId: string;
  /** Optional category filter */
  readonly category?: string;
  /** Optional minimum confidence threshold */
  readonly minConfidence?: number;
}

export function createGetWikiGraphQuery(
  wikiId: string,
  options?: { category?: string; minConfidence?: number }
): GetWikiGraphQuery {
  const query: GetWikiGraphQuery = {
    type: 'GetWikiGraph',
    wikiId,
  };
  if (options?.category !== undefined) {
    (query as { category?: string }).category = options.category;
  }
  if (options?.minConfidence !== undefined) {
    (query as { minConfidence?: number }).minConfidence = options.minConfidence;
  }
  return query;
}

/**
 * Build a graph structure from a list of wiki pages.
 */
export function buildWikiGraph(pages: WikiPage[]): WikiGraph {
  // Create a map of path -> page for efficient lookups
  const pageByPath = new Map<string, WikiPage>();
  for (const page of pages) {
    pageByPath.set(page.path, page);
  }

  // Build nodes
  const nodes: WikiGraphNode[] = pages.map(page => {
    const node: WikiGraphNode = {
      id: page.id,
      path: page.path,
      title: page.title,
      confidence: page.confidence,
      linkCount: page.links.length,
      backlinkCount: page.backlinks.length,
      updatedAt: page.updatedAt,
    };
    if (page.category !== undefined) {
      node.category = page.category;
    }
    return node;
  });

  // Build edges (only for links that point to existing pages)
  const edges: WikiGraphEdge[] = [];
  for (const page of pages) {
    for (const linkedPath of page.links) {
      const targetPage = pageByPath.get(linkedPath);
      if (targetPage) {
        edges.push({
          id: `${page.id}->${targetPage.id}`,
          source: page.id,
          target: targetPage.id,
        });
      }
    }
  }

  // Collect unique categories
  const categories = [...new Set(pages.map(p => p.category).filter(Boolean))] as string[];

  // Calculate stats
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const avgLinks = nodeCount > 0 ? edgeCount / nodeCount : 0;

  return {
    nodes,
    edges,
    stats: {
      nodeCount,
      edgeCount,
      avgLinks: Math.round(avgLinks * 100) / 100,
      categories,
    },
  };
}

/**
 * Handler for GetWikiGraph query.
 */
export async function handleGetWikiGraph(
  query: GetWikiGraphQuery,
  repos: Repositories
): Promise<QueryResult<WikiGraph>> {
  let pages = await repos.wikiPages.findByWiki(query.wikiId);

  // Apply category filter if specified
  if (query.category) {
    pages = pages.filter(p => p.category === query.category);
  }

  // Apply minimum confidence filter if specified
  if (query.minConfidence !== undefined) {
    pages = pages.filter(p => p.confidence >= query.minConfidence!);
  }

  const graph = buildWikiGraph(pages);
  return found(graph);
}
