import type { ProcessingRun, ProcessingRunStatus, ProcessingPhase } from '../../domain/processing-run.js';

/**
 * Repository interface for managing processing runs.
 */
export interface ProcessingRunRepository {
  /**
   * Find a processing run by its ID.
   */
  findById(id: string): Promise<ProcessingRun | null>;

  /**
   * Find all processing runs for a repo.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: ProcessingRunStatus;
  }): Promise<ProcessingRun[]>;

  /**
   * Find the currently running processing run for a repo (if any).
   */
  findActive(repoId: string): Promise<ProcessingRun | null>;

  /**
   * Find the most recent processing run for a repo.
   */
  findMostRecent(repoId: string): Promise<ProcessingRun | null>;

  /**
   * Save a processing run (create or update).
   */
  save(run: ProcessingRun): Promise<void>;

  /**
   * Delete a processing run by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all processing runs for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Update the progress of a processing run.
   */
  updateProgress(id: string, updates: {
    completedIterations: number;
    successfulIterations: number;
    failedIterations: number;
    totalCostUsd: number;
    wikiPagesCreated: number;
    wikiPagesUpdated: number;
  }): Promise<void>;

  /**
   * Mark a processing run as completed.
   */
  complete(id: string): Promise<void>;

  /**
   * Mark a processing run as failed with an error.
   */
  fail(id: string, error: string): Promise<void>;

  /**
   * Mark a processing run as stopped (manually interrupted).
   */
  stop(id: string): Promise<void>;

  /**
   * Request a graceful stop of a processing run.
   * Sets status to 'stopping' and totalIterations to completedIterations.
   */
  requestStop(id: string): Promise<void>;

  /**
   * Confirm a processing run has stopped after graceful shutdown.
   * Sets status to 'stopped' and completedAt.
   */
  confirmStop(id: string): Promise<void>;

  /**
   * Advance to the next phase in the pipeline.
   * Marks the current phase as completed and sets the new phase as running.
   */
  advancePhase(id: string, phase: ProcessingPhase): Promise<void>;

  /**
   * Update progress within the current phase.
   * @param id - Processing run ID
   * @param progress - Current progress value
   * @param target - Optional target value for completion
   */
  updatePhaseProgress(id: string, progress: number, target?: number): Promise<void>;
}
