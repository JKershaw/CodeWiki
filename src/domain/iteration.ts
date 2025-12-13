import type { AgentType } from './agent-run.js';

/**
 * Represents a single iteration within a processing run.
 * Each iteration processes one work item.
 */
export interface Iteration {
  id: string;
  /** Reference to the parent processing run */
  processingRunId: string;
  /** Which iteration this is (1-based) */
  iterationNumber: number;
  /** Current status of the iteration */
  status: IterationStatus;
  /** Work item being processed (if any) */
  workItemId: string | null;
  /** Type of agent running */
  agentType: AgentType | null;
  /** Reference to the agent run record */
  agentRunId: string | null;
  /** When this iteration started */
  startedAt: Date;
  /** When this iteration completed */
  completedAt: Date | null;
  /** Duration in milliseconds */
  durationMs: number | null;
  /** Cost of this iteration */
  costUsd: number;
  /** Wiki pages created in this iteration */
  pagesCreated: number;
  /** Wiki pages updated in this iteration */
  pagesUpdated: number;
  /** Error message if failed */
  error: string | null;
  /** Snapshot of KPIs at iteration completion (for charting/tracking) */
  kpiSnapshot?: Record<string, unknown>;
}

export type IterationStatus =
  | 'running'    // Currently executing
  | 'completed'  // Successfully finished
  | 'failed'     // Failed with error
  | 'skipped';   // Skipped (rate limit, no work, etc.)

/**
 * Create a new iteration record.
 */
export function createIteration(params: {
  id: string;
  processingRunId: string;
  iterationNumber: number;
}): Iteration {
  return {
    id: params.id,
    processingRunId: params.processingRunId,
    iterationNumber: params.iterationNumber,
    status: 'running',
    workItemId: null,
    agentType: null,
    agentRunId: null,
    startedAt: new Date(),
    completedAt: null,
    durationMs: null,
    costUsd: 0,
    pagesCreated: 0,
    pagesUpdated: 0,
    error: null,
  };
}
