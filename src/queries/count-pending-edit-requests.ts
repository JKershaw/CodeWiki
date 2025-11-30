import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Query to count pending edit requests for a wiki.
 */
export interface CountPendingEditRequestsQuery extends Query {
  readonly type: 'CountPendingEditRequests';
  readonly wikiId: string;
}

export function createCountPendingEditRequestsQuery(
  wikiId: string
): CountPendingEditRequestsQuery {
  return {
    type: 'CountPendingEditRequests',
    wikiId,
  };
}

/**
 * Handler for CountPendingEditRequests query.
 */
export async function handleCountPendingEditRequests(
  query: CountPendingEditRequestsQuery,
  repos: Repositories
): Promise<QueryResult<number>> {
  const count = await repos.editRequests.countPending(query.wikiId);
  return found(count);
}
