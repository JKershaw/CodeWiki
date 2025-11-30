/**
 * Represents a processing session - a single invocation of runIterations().
 * Tracks the overall progress of processing a repository.
 */
export interface ProcessingRun {
  id: string;
  /** Reference to the repo being processed */
  repoId: string;
  /** Reference to the wiki being updated */
  wikiId: string;
  /** Current status of the processing run */
  status: ProcessingRunStatus;
  /** Total number of iterations requested */
  totalIterations: number;
  /** Number of iterations completed so far */
  completedIterations: number;
  /** When the processing run started */
  startedAt: Date;
  /** When the processing run completed (success, failure, or stopped) */
  completedAt: Date | null;
  /** Accumulated metrics */
  successfulIterations: number;
  failedIterations: number;
  totalCostUsd: number;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  /** Error message if failed */
  error: string | null;
}

export type ProcessingRunStatus =
  | 'running'    // Currently processing
  | 'stopping'   // Graceful shutdown requested, finishing current work
  | 'completed'  // All iterations finished successfully
  | 'failed'     // Stopped due to error
  | 'stopped';   // Manually stopped

/**
 * Create a new processing run record.
 */
export function createProcessingRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  totalIterations: number;
}): ProcessingRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    status: 'running',
    totalIterations: params.totalIterations,
    completedIterations: 0,
    startedAt: new Date(),
    completedAt: null,
    successfulIterations: 0,
    failedIterations: 0,
    totalCostUsd: 0,
    wikiPagesCreated: 0,
    wikiPagesUpdated: 0,
    error: null,
  };
}
