import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Query to list low confidence wiki pages.
 */
export interface ListLowConfidencePagesQuery extends Query {
  readonly type: 'ListLowConfidencePages';
  readonly wikiId: string;
  readonly threshold: number;
}

export function createListLowConfidencePagesQuery(
  wikiId: string,
  threshold: number
): ListLowConfidencePagesQuery {
  return {
    type: 'ListLowConfidencePages',
    wikiId,
    threshold,
  };
}

/**
 * Handler for ListLowConfidencePages query.
 */
export async function handleListLowConfidencePages(
  query: ListLowConfidencePagesQuery,
  repos: Repositories
): Promise<QueryResult<WikiPage[]>> {
  const pages = await repos.wikiPages.findLowConfidence(query.wikiId, query.threshold);
  return found(pages);
}
