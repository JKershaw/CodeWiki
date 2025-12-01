/**
 * Query to get a hierarchical tree representation of wiki pages.
 */

import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * A node in the wiki tree hierarchy.
 */
export interface WikiTreeNode {
  /** Segment name (e.g., "architecture" or "cqrs") */
  name: string;
  /** Full path to this node (e.g., "architecture/cqrs") */
  path: string;
  /** The wiki page at this path, if one exists */
  page?: WikiPage;
  /** Child nodes */
  children: WikiTreeNode[];
}

/**
 * Query to get wiki tree structure.
 */
export interface GetWikiTreeQuery extends Query {
  readonly type: 'GetWikiTree';
  readonly wikiId: string;
}

export function createGetWikiTreeQuery(wikiId: string): GetWikiTreeQuery {
  return {
    type: 'GetWikiTree',
    wikiId,
  };
}

// Internal node type with Map for efficient lookups during construction
interface BuildNode {
  name: string;
  path: string;
  page?: WikiPage;
  childMap: Map<string, BuildNode>;
}

/**
 * Build a tree structure from a flat list of wiki pages.
 * Pages are organized by their path segments.
 */
export function buildWikiTree(pages: WikiPage[]): WikiTreeNode[] {
  const root = new Map<string, BuildNode>();

  for (const page of pages) {
    const segments = page.path.split('/');
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;

      if (!currentLevel.has(segment)) {
        currentLevel.set(segment, {
          name: segment,
          path: currentPath,
          childMap: new Map(),
        });
      }

      const node = currentLevel.get(segment)!;

      if (isLeaf) {
        node.page = page;
      } else {
        currentLevel = node.childMap;
      }
    }
  }

  // Convert BuildNode tree to WikiTreeNode tree
  return convertAndSort(root);
}

/**
 * Convert BuildNode map to sorted WikiTreeNode array.
 */
function convertAndSort(nodeMap: Map<string, BuildNode>): WikiTreeNode[] {
  return Array.from(nodeMap.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(node => {
      const result: WikiTreeNode = {
        name: node.name,
        path: node.path,
        children: convertAndSort(node.childMap),
      };
      if (node.page) {
        result.page = node.page;
      }
      return result;
    });
}

/**
 * Handler for GetWikiTree query.
 */
export async function handleGetWikiTree(
  query: GetWikiTreeQuery,
  repos: Repositories
): Promise<QueryResult<WikiTreeNode[]>> {
  const pages = await repos.wikiPages.findByWiki(query.wikiId);
  const tree = buildWikiTree(pages);
  return found(tree);
}
