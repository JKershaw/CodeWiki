import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WorkItem, WorkItemStatus } from '../domain/work-item.js';
import type { AgentType } from '../domain/agent-run.js';

/**
 * Query to get pending work items for a repository.
 */
export interface GetPendingWorkQuery extends Query {
  readonly type: 'GetPendingWork';
  readonly repoId: string;
  readonly limit: number;
}

export function createGetPendingWorkQuery(repoId: string, limit: number): GetPendingWorkQuery {
  return {
    type: 'GetPendingWork',
    repoId,
    limit,
  };
}

/**
 * Handler for GetPendingWork query.
 */
export async function handleGetPendingWork(
  query: GetPendingWorkQuery,
  repos: Repositories
): Promise<QueryResult<WorkItem[]>> {
  const items = await repos.workQueue.findPending(query.repoId, query.limit);
  return found(items);
}

/**
 * Query to list all work items for a repository.
 */
export interface ListWorkItemsQuery extends Query {
  readonly type: 'ListWorkItems';
  readonly repoId: string;
  readonly status?: WorkItemStatus;
  readonly agentType?: AgentType;
}

export function createListWorkItemsQuery(
  repoId: string,
  options?: { status?: WorkItemStatus; agentType?: AgentType }
): ListWorkItemsQuery {
  const query: ListWorkItemsQuery = {
    type: 'ListWorkItems',
    repoId,
  };
  if (options?.status !== undefined) {
    (query as { status: WorkItemStatus }).status = options.status;
  }
  if (options?.agentType !== undefined) {
    (query as { agentType: AgentType }).agentType = options.agentType;
  }
  return query;
}

/**
 * Handler for ListWorkItems query.
 */
export async function handleListWorkItems(
  query: ListWorkItemsQuery,
  repos: Repositories
): Promise<QueryResult<WorkItem[]>> {
  const options: { status?: WorkItemStatus; agentType?: AgentType } = {};
  if (query.status !== undefined) {
    options.status = query.status;
  }
  if (query.agentType !== undefined) {
    options.agentType = query.agentType;
  }
  const items = await repos.workQueue.findByRepo(query.repoId, options);
  return found(items);
}

/**
 * Query to get pending work item keys for deduplication.
 */
export interface GetPendingWorkKeysQuery extends Query {
  readonly type: 'GetPendingWorkKeys';
  readonly repoId: string;
}

export function createGetPendingWorkKeysQuery(repoId: string): GetPendingWorkKeysQuery {
  return {
    type: 'GetPendingWorkKeys',
    repoId,
  };
}

/**
 * Handler for GetPendingWorkKeys query.
 */
export async function handleGetPendingWorkKeys(
  query: GetPendingWorkKeysQuery,
  repos: Repositories
): Promise<QueryResult<Set<string>>> {
  const keys = await repos.workQueue.getPendingKeys(query.repoId);
  return found(keys);
}

/**
 * Query to count pending work items.
 */
export interface CountPendingWorkQuery extends Query {
  readonly type: 'CountPendingWork';
  readonly repoId: string;
}

export function createCountPendingWorkQuery(repoId: string): CountPendingWorkQuery {
  return {
    type: 'CountPendingWork',
    repoId,
  };
}

/**
 * Handler for CountPendingWork query.
 */
export async function handleCountPendingWork(
  query: CountPendingWorkQuery,
  repos: Repositories
): Promise<QueryResult<number>> {
  const count = await repos.workQueue.countPending(query.repoId);
  return found(count);
}

/**
 * Query to count work items by status.
 */
export interface CountWorkByStatusQuery extends Query {
  readonly type: 'CountWorkByStatus';
  readonly repoId: string;
}

export function createCountWorkByStatusQuery(repoId: string): CountWorkByStatusQuery {
  return {
    type: 'CountWorkByStatus',
    repoId,
  };
}

/**
 * Handler for CountWorkByStatus query.
 */
export async function handleCountWorkByStatus(
  query: CountWorkByStatusQuery,
  repos: Repositories
): Promise<QueryResult<Record<WorkItemStatus, number>>> {
  const counts = await repos.workQueue.countByStatus(query.repoId);
  return found(counts);
}
