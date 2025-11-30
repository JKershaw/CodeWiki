import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Query to count all commits for a repository.
 */
export interface CountCommitsByRepoQuery extends Query {
  readonly type: 'CountCommitsByRepo';
  readonly repoId: string;
}

export function createCountCommitsByRepoQuery(repoId: string): CountCommitsByRepoQuery {
  return {
    type: 'CountCommitsByRepo',
    repoId,
  };
}

/**
 * Handler for CountCommitsByRepo query.
 */
export async function handleCountCommitsByRepo(
  query: CountCommitsByRepoQuery,
  repos: Repositories
): Promise<QueryResult<number>> {
  const count = await repos.commits.countByRepo(query.repoId);
  return found(count);
}

/**
 * Query to count commits processed by a specific agent type.
 */
export interface CountProcessedByAgentQuery extends Query {
  readonly type: 'CountProcessedByAgent';
  readonly repoId: string;
  readonly agentType: string;
}

export function createCountProcessedByAgentQuery(
  repoId: string,
  agentType: string
): CountProcessedByAgentQuery {
  return {
    type: 'CountProcessedByAgent',
    repoId,
    agentType,
  };
}

/**
 * Handler for CountProcessedByAgent query.
 */
export async function handleCountProcessedByAgent(
  query: CountProcessedByAgentQuery,
  repos: Repositories
): Promise<QueryResult<number>> {
  const count = await repos.commits.countProcessedByAgent(query.repoId, query.agentType);
  return found(count);
}
