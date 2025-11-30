import type { Query, QueryResult } from './types.js';
import { found, notFound } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { AgentRun, AgentType, AgentRunStatus } from '../domain/agent-run.js';

/**
 * Query to get an agent run by ID.
 */
export interface GetAgentRunQuery extends Query {
  readonly type: 'GetAgentRun';
  readonly runId: string;
}

export function createGetAgentRunQuery(runId: string): GetAgentRunQuery {
  return {
    type: 'GetAgentRun',
    runId,
  };
}

/**
 * Handler for GetAgentRun query.
 */
export async function handleGetAgentRun(
  query: GetAgentRunQuery,
  repos: Repositories
): Promise<QueryResult<AgentRun>> {
  const run = await repos.agentRuns.findById(query.runId);
  if (!run) {
    return notFound(`Agent run not found: ${query.runId}`);
  }
  return found(run);
}

/**
 * Query to list agent runs for a repository.
 */
export interface ListAgentRunsQuery extends Query {
  readonly type: 'ListAgentRuns';
  readonly repoId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly agentType?: AgentType;
  readonly status?: AgentRunStatus;
}

export function createListAgentRunsQuery(
  repoId: string,
  options?: {
    limit?: number;
    offset?: number;
    agentType?: AgentType;
    status?: AgentRunStatus;
  }
): ListAgentRunsQuery {
  const query: ListAgentRunsQuery = {
    type: 'ListAgentRuns',
    repoId,
  };
  if (options?.limit !== undefined) {
    (query as { limit: number }).limit = options.limit;
  }
  if (options?.offset !== undefined) {
    (query as { offset: number }).offset = options.offset;
  }
  if (options?.agentType !== undefined) {
    (query as { agentType: AgentType }).agentType = options.agentType;
  }
  if (options?.status !== undefined) {
    (query as { status: AgentRunStatus }).status = options.status;
  }
  return query;
}

/**
 * Handler for ListAgentRuns query.
 */
export async function handleListAgentRuns(
  query: ListAgentRunsQuery,
  repos: Repositories
): Promise<QueryResult<AgentRun[]>> {
  const options: {
    limit?: number;
    offset?: number;
    agentType?: AgentType;
    status?: AgentRunStatus;
  } = {};
  if (query.limit !== undefined) {
    options.limit = query.limit;
  }
  if (query.offset !== undefined) {
    options.offset = query.offset;
  }
  if (query.agentType !== undefined) {
    options.agentType = query.agentType;
  }
  if (query.status !== undefined) {
    options.status = query.status;
  }
  const runs = await repos.agentRuns.findByRepo(query.repoId, options);
  return found(runs);
}

/**
 * Query to list agent runs for a specific commit.
 */
export interface ListAgentRunsByCommitQuery extends Query {
  readonly type: 'ListAgentRunsByCommit';
  readonly commitId: string;
}

export function createListAgentRunsByCommitQuery(commitId: string): ListAgentRunsByCommitQuery {
  return {
    type: 'ListAgentRunsByCommit',
    commitId,
  };
}

/**
 * Handler for ListAgentRunsByCommit query.
 */
export async function handleListAgentRunsByCommit(
  query: ListAgentRunsByCommitQuery,
  repos: Repositories
): Promise<QueryResult<AgentRun[]>> {
  const runs = await repos.agentRuns.findByCommit(query.commitId);
  return found(runs);
}

/**
 * Query to get recent runs by agent type.
 */
export interface GetRecentAgentRunsQuery extends Query {
  readonly type: 'GetRecentAgentRuns';
  readonly repoId: string;
  readonly agentType: AgentType;
  readonly limit: number;
}

export function createGetRecentAgentRunsQuery(
  repoId: string,
  agentType: AgentType,
  limit: number
): GetRecentAgentRunsQuery {
  return {
    type: 'GetRecentAgentRuns',
    repoId,
    agentType,
    limit,
  };
}

/**
 * Handler for GetRecentAgentRuns query.
 */
export async function handleGetRecentAgentRuns(
  query: GetRecentAgentRunsQuery,
  repos: Repositories
): Promise<QueryResult<AgentRun[]>> {
  const runs = await repos.agentRuns.findRecentByType(query.repoId, query.agentType, query.limit);
  return found(runs);
}

/**
 * Query to count agent runs by status.
 */
export interface CountAgentRunsByStatusQuery extends Query {
  readonly type: 'CountAgentRunsByStatus';
  readonly repoId: string;
}

export function createCountAgentRunsByStatusQuery(repoId: string): CountAgentRunsByStatusQuery {
  return {
    type: 'CountAgentRunsByStatus',
    repoId,
  };
}

/**
 * Handler for CountAgentRunsByStatus query.
 */
export async function handleCountAgentRunsByStatus(
  query: CountAgentRunsByStatusQuery,
  repos: Repositories
): Promise<QueryResult<Record<AgentRunStatus, number>>> {
  const counts = await repos.agentRuns.countByStatus(query.repoId);
  return found(counts);
}
