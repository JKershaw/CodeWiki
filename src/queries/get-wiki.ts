import type { Query, QueryResult } from './types.js';
import { found, notFound } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Wiki } from '../domain/wiki.js';

/**
 * Query to get a wiki by ID.
 */
export interface GetWikiQuery extends Query {
  readonly type: 'GetWiki';
  readonly wikiId: string;
}

export function createGetWikiQuery(wikiId: string): GetWikiQuery {
  return {
    type: 'GetWiki',
    wikiId,
  };
}

/**
 * Handler for GetWiki query.
 */
export async function handleGetWiki(
  query: GetWikiQuery,
  repos: Repositories
): Promise<QueryResult<Wiki>> {
  const wiki = await repos.wikis.findById(query.wikiId);
  if (!wiki) {
    return notFound(`Wiki not found: ${query.wikiId}`);
  }
  return found(wiki);
}

/**
 * Query to get a wiki by slug.
 */
export interface GetWikiBySlugQuery extends Query {
  readonly type: 'GetWikiBySlug';
  readonly repoId: string;
  readonly slug: string;
}

export function createGetWikiBySlugQuery(repoId: string, slug: string): GetWikiBySlugQuery {
  return {
    type: 'GetWikiBySlug',
    repoId,
    slug,
  };
}

/**
 * Handler for GetWikiBySlug query.
 */
export async function handleGetWikiBySlug(
  query: GetWikiBySlugQuery,
  repos: Repositories
): Promise<QueryResult<Wiki>> {
  const wiki = await repos.wikis.findBySlug(query.repoId, query.slug);
  if (!wiki) {
    return notFound(`Wiki not found with slug '${query.slug}' in repository ${query.repoId}`);
  }
  return found(wiki);
}

/**
 * Query to list all wikis for a repository.
 */
export interface ListWikisQuery extends Query {
  readonly type: 'ListWikis';
  readonly repoId: string;
}

export function createListWikisQuery(repoId: string): ListWikisQuery {
  return {
    type: 'ListWikis',
    repoId,
  };
}

/**
 * Handler for ListWikis query.
 */
export async function handleListWikis(
  query: ListWikisQuery,
  repos: Repositories
): Promise<QueryResult<Wiki[]>> {
  const wikis = await repos.wikis.findByRepo(query.repoId);
  return found(wikis);
}
