import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Conflict } from '../domain/conflict.js';

/**
 * Query to list open conflicts for a wiki.
 */
export interface ListOpenConflictsQuery extends Query {
  readonly type: 'ListOpenConflicts';
  readonly wikiId: string;
}

export function createListOpenConflictsQuery(wikiId: string): ListOpenConflictsQuery {
  return {
    type: 'ListOpenConflicts',
    wikiId,
  };
}

/**
 * Handler for ListOpenConflicts query.
 */
export async function handleListOpenConflicts(
  query: ListOpenConflictsQuery,
  repos: Repositories
): Promise<QueryResult<Conflict[]>> {
  const conflicts = await repos.conflicts.findOpen(query.wikiId);
  return found(conflicts);
}
