import type { Query, QueryResult } from './types.js';
import { found, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Query to search wiki pages.
 */
export interface SearchWikiQuery extends Query {
  readonly type: 'SearchWiki';
  readonly wikiId: string;
  readonly query: string;
}

export function createSearchWikiQuery(wikiId: string, query: string): SearchWikiQuery {
  return {
    type: 'SearchWiki',
    wikiId,
    query,
  };
}

/**
 * Search result with relevance score.
 */
export interface SearchResult {
  page: WikiPage;
  relevance: number;
  snippet: string;
}

/**
 * Handler for SearchWiki query.
 */
export async function handleSearchWiki(
  query: SearchWikiQuery,
  repos: Repositories
): Promise<QueryResult<SearchResult[]>> {
  try {
    const pages = await repos.wikiPages.search(query.wikiId, query.query);

    const results: SearchResult[] = pages.map(page => ({
      page,
      relevance: calculateRelevance(page, query.query),
      snippet: extractSnippet(page.content, query.query),
    }));

    // Sort by relevance (highest first)
    results.sort((a, b) => b.relevance - a.relevance);

    return found(results);
  } catch (error) {
    return queryError(`Failed to search wiki: ${error}`);
  }
}

/**
 * Calculate relevance score for a search result.
 */
function calculateRelevance(page: WikiPage, query: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerTitle = page.title.toLowerCase();
  const lowerContent = page.content.toLowerCase();

  let score = 0;

  // Title match is highly relevant
  if (lowerTitle.includes(lowerQuery)) {
    score += 10;
    // Exact title match is even better
    if (lowerTitle === lowerQuery) {
      score += 5;
    }
  }

  // Count content occurrences
  const contentMatches = (lowerContent.match(new RegExp(escapeRegex(lowerQuery), 'g')) || []).length;
  score += Math.min(contentMatches, 10); // Cap at 10 matches

  // Factor in confidence
  score *= page.confidence;

  return score;
}

/**
 * Extract a snippet around the first match.
 */
function extractSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    // No match, return start of content
    return content.slice(0, 150) + (content.length > 150 ? '...' : '');
  }

  // Get context around the match
  const start = Math.max(0, index - 50);
  const end = Math.min(content.length, index + query.length + 100);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
