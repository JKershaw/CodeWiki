import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Query to list all wiki pages for a wiki.
 */
export interface ListWikiPagesQuery extends Query {
  readonly type: 'ListWikiPages';
  readonly wikiId: string;
}

export function createListWikiPagesQuery(wikiId: string): ListWikiPagesQuery {
  return {
    type: 'ListWikiPages',
    wikiId,
  };
}

/**
 * Handler for ListWikiPages query.
 */
export async function handleListWikiPages(
  query: ListWikiPagesQuery,
  repos: Repositories
): Promise<QueryResult<WikiPage[]>> {
  const pages = await repos.wikiPages.findByWiki(query.wikiId);
  return found(pages);
}
