import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Query to get a wiki page by path.
 */
export interface GetWikiPageQuery extends Query {
  readonly type: 'GetWikiPage';
  readonly wikiId: string;
  readonly path: string;
}

export function createGetWikiPageQuery(wikiId: string, path: string): GetWikiPageQuery {
  return {
    type: 'GetWikiPage',
    wikiId,
    path,
  };
}

/**
 * Handler for GetWikiPage query.
 */
export async function handleGetWikiPage(
  query: GetWikiPageQuery,
  repos: Repositories
): Promise<QueryResult<WikiPage>> {
  try {
    const page = await repos.wikiPages.findByPath(query.wikiId, query.path);
    if (!page) {
      return notFound(`Wiki page not found at path: ${query.path}`);
    }
    return found(page);
  } catch (error) {
    return queryError(`Failed to get wiki page: ${error}`);
  }
}
