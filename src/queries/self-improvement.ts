/**
 * CQRS Queries for Self-Improvement Analysis operations.
 *
 * These queries retrieve self-improvement analysis run data.
 */

import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { SelfImprovementRun } from '../domain/self-improvement.js';

// ============================================================================
// GetSelfImprovementRun Query
// ============================================================================

/**
 * Query to get a specific self-improvement run by ID.
 */
export interface GetSelfImprovementRunQuery extends Query {
  readonly type: 'GetSelfImprovementRun';
  readonly runId: string;
}

export function createGetSelfImprovementRunQuery(runId: string): GetSelfImprovementRunQuery {
  return {
    type: 'GetSelfImprovementRun',
    runId,
  };
}

/**
 * Handler for GetSelfImprovementRun query.
 */
export async function handleGetSelfImprovementRun(
  query: GetSelfImprovementRunQuery,
  repos: Repositories
): Promise<QueryResult<SelfImprovementRun>> {
  try {
    const run = await repos.selfImprovements.findById(query.runId);
    if (!run) {
      return notFound(`Self-improvement run not found: ${query.runId}`);
    }
    return found(run);
  } catch (error) {
    return queryError(`Failed to get self-improvement run: ${error}`);
  }
}

// ============================================================================
// GetSelfImprovementHistory Query
// ============================================================================

/**
 * Query to get self-improvement history for a repository.
 */
export interface GetSelfImprovementHistoryQuery extends Query {
  readonly type: 'GetSelfImprovementHistory';
  readonly repoId: string;
  readonly limit?: number;
}

export function createGetSelfImprovementHistoryQuery(
  repoId: string,
  limit?: number
): GetSelfImprovementHistoryQuery {
  const query: GetSelfImprovementHistoryQuery = {
    type: 'GetSelfImprovementHistory',
    repoId,
  };
  if (limit !== undefined) {
    return { ...query, limit };
  }
  return query;
}

/**
 * Summary of a self-improvement run for history display.
 */
export interface SelfImprovementHistoryEntry {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  iterationRange: [number, number];
  benchmarkRunCount: number;
  costUsd: number;
}

/**
 * Handler for GetSelfImprovementHistory query.
 */
export async function handleGetSelfImprovementHistory(
  query: GetSelfImprovementHistoryQuery,
  repos: Repositories
): Promise<QueryResult<SelfImprovementHistoryEntry[]>> {
  try {
    const runs = await repos.selfImprovements.findLatest(query.repoId, query.limit ?? 10);

    const history: SelfImprovementHistoryEntry[] = runs.map(run => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      iterationRange: run.iterationRange,
      benchmarkRunCount: run.benchmarkRunIds.length,
      costUsd: run.costUsd,
    }));

    return found(history);
  } catch (error) {
    return queryError(`Failed to get self-improvement history: ${error}`);
  }
}
