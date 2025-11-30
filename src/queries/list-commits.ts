import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Commit } from '../domain/commit.js';

/**
 * Query to list commits for a repository.
 */
export interface ListCommitsQuery extends Query {
  readonly type: 'ListCommits';
  readonly repoId: string;
  readonly limit?: number;
  readonly offset?: number;
}

export function createListCommitsQuery(
  repoId: string,
  options?: { limit?: number; offset?: number }
): ListCommitsQuery {
  const query: ListCommitsQuery = {
    type: 'ListCommits',
    repoId,
  };
  if (options?.limit !== undefined) {
    (query as { limit: number }).limit = options.limit;
  }
  if (options?.offset !== undefined) {
    (query as { offset: number }).offset = options.offset;
  }
  return query;
}

/**
 * Handler for ListCommits query.
 */
export async function handleListCommits(
  query: ListCommitsQuery,
  repos: Repositories
): Promise<QueryResult<Commit[]>> {
  const options: { limit?: number; offset?: number } = {};
  if (query.limit !== undefined) {
    options.limit = query.limit;
  }
  if (query.offset !== undefined) {
    options.offset = query.offset;
  }
  const commits = await repos.commits.findByRepo(query.repoId, options);
  return found(commits);
}

/**
 * Query to find commits unprocessed by a specific agent type.
 */
export interface ListUnprocessedCommitsQuery extends Query {
  readonly type: 'ListUnprocessedCommits';
  readonly repoId: string;
  readonly agentType: string;
}

export function createListUnprocessedCommitsQuery(
  repoId: string,
  agentType: string
): ListUnprocessedCommitsQuery {
  return {
    type: 'ListUnprocessedCommits',
    repoId,
    agentType,
  };
}

/**
 * Handler for ListUnprocessedCommits query.
 */
export async function handleListUnprocessedCommits(
  query: ListUnprocessedCommitsQuery,
  repos: Repositories
): Promise<QueryResult<Commit[]>> {
  const commits = await repos.commits.findUnprocessedByAgent(query.repoId, query.agentType);
  return found(commits);
}
