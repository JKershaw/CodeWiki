/**
 * CQRS Queries for Orchestrator Run operations.
 *
 * These queries retrieve orchestrator decision history for analysis
 * and debugging of the wiki generation process.
 */

import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { OrchestratorRun } from '../domain/orchestrator-run.js';

// ============================================================================
// ListOrchestratorRuns Query
// ============================================================================

/**
 * Query to list orchestrator runs for a repository.
 */
export interface ListOrchestratorRunsQuery extends Query {
  readonly type: 'ListOrchestratorRuns';
  readonly repoId: string;
  readonly limit?: number;
  readonly usedLLM?: boolean;
}

/**
 * Create a query to list orchestrator runs.
 */
export function createListOrchestratorRunsQuery(
  repoId: string,
  options?: { limit?: number; usedLLM?: boolean }
): ListOrchestratorRunsQuery {
  return {
    type: 'ListOrchestratorRuns',
    repoId,
    ...options,
  };
}

/**
 * Summary of an orchestrator run for display.
 */
export interface OrchestratorRunSummary {
  id: string;
  timestamp: Date;
  reasoning: string;
  workItemsRequested: number;
  workItemsCreated: number;
  model: string;
  costUsd: number;
  durationMs: number;
  usedLLM: boolean;
  workItems: Array<{
    agentType: string;
    targetCommitId?: string;
    targetPath?: string;
    reason: string;
  }>;
  /** Key context metrics at decision time */
  contextSnapshot: {
    wikiPages: number;
    pendingEditRequests: number;
    pagesNeedingRewrite: number;
    avgConfidence: number;
  };
}

/**
 * Handler for ListOrchestratorRuns query.
 */
export async function handleListOrchestratorRuns(
  query: ListOrchestratorRunsQuery,
  repos: Repositories
): Promise<QueryResult<OrchestratorRunSummary[]>> {
  try {
    // Build options object, only including defined properties
    const options: { limit?: number; usedLLM?: boolean } = {};
    if (query.limit !== undefined) options.limit = query.limit;
    if (query.usedLLM !== undefined) options.usedLLM = query.usedLLM;

    const runs = await repos.orchestratorRuns.findByRepo(query.repoId, options);

    const summaries: OrchestratorRunSummary[] = runs.map(run => ({
      id: run.id,
      timestamp: run.timestamp,
      reasoning: run.decision.reasoning,
      workItemsRequested: run.decision.workItems.length,
      workItemsCreated: run.workItemsCreated.length,
      model: run.model,
      costUsd: run.costUsd,
      durationMs: run.durationMs,
      usedLLM: run.usedLLM,
      workItems: run.decision.workItems,
      contextSnapshot: {
        wikiPages: run.context.wikiPages ?? 0,
        pendingEditRequests: run.context.pendingEditRequests ?? 0,
        pagesNeedingRewrite: run.context.pagesNeedingRewrite ?? 0,
        avgConfidence: run.context.avgConfidence ?? 0,
      },
    }));

    return found(summaries);
  } catch (error) {
    return queryError(`Failed to list orchestrator runs: ${error}`);
  }
}

// ============================================================================
// GetOrchestratorRun Query
// ============================================================================

/**
 * Query to get a specific orchestrator run by ID.
 */
export interface GetOrchestratorRunQuery extends Query {
  readonly type: 'GetOrchestratorRun';
  readonly runId: string;
}

/**
 * Create a query to get a specific orchestrator run.
 */
export function createGetOrchestratorRunQuery(runId: string): GetOrchestratorRunQuery {
  return {
    type: 'GetOrchestratorRun',
    runId,
  };
}

/**
 * Handler for GetOrchestratorRun query.
 */
export async function handleGetOrchestratorRun(
  query: GetOrchestratorRunQuery,
  repos: Repositories
): Promise<QueryResult<OrchestratorRun>> {
  try {
    const run = await repos.orchestratorRuns.findById(query.runId);
    if (!run) {
      return notFound(`Orchestrator run not found: ${query.runId}`);
    }
    return found(run);
  } catch (error) {
    return queryError(`Failed to get orchestrator run: ${error}`);
  }
}
