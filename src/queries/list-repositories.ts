import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Repo, RepoStatus } from '../domain/repo.js';

/**
 * Query to list all repositories.
 */
export interface ListRepositoriesQuery extends Query {
  readonly type: 'ListRepositories';
  readonly status?: RepoStatus;
}

export function createListRepositoriesQuery(status?: RepoStatus): ListRepositoriesQuery {
  const query: ListRepositoriesQuery = {
    type: 'ListRepositories',
  };
  if (status !== undefined) {
    return { ...query, status };
  }
  return query;
}

/**
 * Handler for ListRepositories query.
 */
export async function handleListRepositories(
  query: ListRepositoriesQuery,
  repos: Repositories
): Promise<QueryResult<Repo[]>> {
  if (query.status) {
    const filteredRepos = await repos.repos.findByStatus(query.status);
    return found(filteredRepos);
  }
  const allRepos = await repos.repos.findAll();
  return found(allRepos);
}
