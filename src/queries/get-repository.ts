import type { Query, QueryResult } from './types.js';
import { found, notFound } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Repo } from '../domain/repo.js';

/**
 * Query to get a repository by ID.
 */
export interface GetRepositoryQuery extends Query {
  readonly type: 'GetRepository';
  readonly repoId: string;
}

export function createGetRepositoryQuery(repoId: string): GetRepositoryQuery {
  return {
    type: 'GetRepository',
    repoId,
  };
}

/**
 * Handler for GetRepository query.
 */
export async function handleGetRepository(
  query: GetRepositoryQuery,
  repos: Repositories
): Promise<QueryResult<Repo>> {
  const repo = await repos.repos.findById(query.repoId);
  if (!repo) {
    return notFound(`Repository not found: ${query.repoId}`);
  }
  return found(repo);
}

/**
 * Query to get a repository by full name (owner/repo format).
 */
export interface GetRepositoryByFullNameQuery extends Query {
  readonly type: 'GetRepositoryByFullName';
  readonly fullName: string;
}

export function createGetRepositoryByFullNameQuery(fullName: string): GetRepositoryByFullNameQuery {
  return {
    type: 'GetRepositoryByFullName',
    fullName,
  };
}

/**
 * Handler for GetRepositoryByFullName query.
 */
export async function handleGetRepositoryByFullName(
  query: GetRepositoryByFullNameQuery,
  repos: Repositories
): Promise<QueryResult<Repo>> {
  const repo = await repos.repos.findByFullName(query.fullName);
  if (!repo) {
    return notFound(`Repository not found: ${query.fullName}`);
  }
  return found(repo);
}
