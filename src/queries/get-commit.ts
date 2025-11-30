import type { Query, QueryResult } from './types.js';
import { found, notFound } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Commit } from '../domain/commit.js';

/**
 * Query to get a commit by ID.
 */
export interface GetCommitQuery extends Query {
  readonly type: 'GetCommit';
  readonly commitId: string;
}

export function createGetCommitQuery(commitId: string): GetCommitQuery {
  return {
    type: 'GetCommit',
    commitId,
  };
}

/**
 * Handler for GetCommit query.
 */
export async function handleGetCommit(
  query: GetCommitQuery,
  repos: Repositories
): Promise<QueryResult<Commit>> {
  const commit = await repos.commits.findById(query.commitId);
  if (!commit) {
    return notFound(`Commit not found: ${query.commitId}`);
  }
  return found(commit);
}

/**
 * Query to get a commit by SHA.
 */
export interface GetCommitByShaQuery extends Query {
  readonly type: 'GetCommitBySha';
  readonly repoId: string;
  readonly sha: string;
}

export function createGetCommitByShaQuery(repoId: string, sha: string): GetCommitByShaQuery {
  return {
    type: 'GetCommitBySha',
    repoId,
    sha,
  };
}

/**
 * Handler for GetCommitBySha query.
 */
export async function handleGetCommitBySha(
  query: GetCommitByShaQuery,
  repos: Repositories
): Promise<QueryResult<Commit>> {
  const commit = await repos.commits.findBySha(query.repoId, query.sha);
  if (!commit) {
    return notFound(`Commit not found with SHA: ${query.sha}`);
  }
  return found(commit);
}
