import type { Query, QueryResult } from './types.js';
import { found, notFound } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Wiki } from '../domain/wiki.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';

/**
 * Query to get the active wiki for a repository.
 * If no wiki exists, creates a default one.
 */
export interface GetActiveWikiQuery extends Query {
  readonly type: 'GetActiveWiki';
  readonly repoId: string;
  /** If true, creates a default wiki if none exists. Default: true */
  readonly createIfMissing?: boolean;
}

export function createGetActiveWikiQuery(
  repoId: string,
  options?: { createIfMissing?: boolean }
): GetActiveWikiQuery {
  return {
    type: 'GetActiveWiki',
    repoId,
    createIfMissing: options?.createIfMissing ?? true,
  };
}

/**
 * Handler for GetActiveWiki query.
 */
export async function handleGetActiveWiki(
  query: GetActiveWikiQuery,
  repos: Repositories
): Promise<QueryResult<Wiki>> {
  // Verify repo exists
  const repo = await repos.repos.findById(query.repoId);
  if (!repo) {
    return notFound(`Repository not found: ${query.repoId}`);
  }

  if (query.createIfMissing !== false) {
    // Use getOrCreateActiveWiki which handles creation
    const wiki = await getOrCreateActiveWiki(query.repoId, repos);
    return found(wiki);
  }

  // Just find existing active wiki
  const wiki = await repos.wikis.findActive(query.repoId);
  if (!wiki) {
    return notFound(`No active wiki found for repository: ${query.repoId}`);
  }

  return found(wiki);
}
