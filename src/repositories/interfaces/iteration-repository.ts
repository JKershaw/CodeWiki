import type { Iteration } from '../../domain/iteration.js';
import type { AgentType } from '../../domain/agent-run.js';

/**
 * Repository interface for managing iterations within processing runs.
 */
export interface IterationRepository {
  /**
   * Find an iteration by its ID.
   */
  findById(id: string): Promise<Iteration | null>;

  /**
   * Find all iterations for a processing run.
   */
  findByProcessingRun(processingRunId: string): Promise<Iteration[]>;

  /**
   * Find the currently running iteration for a processing run (if any).
   */
  findRunning(processingRunId: string): Promise<Iteration | null>;

  /**
   * Find the most recent iteration for a processing run.
   */
  findMostRecent(processingRunId: string): Promise<Iteration | null>;

  /**
   * Save an iteration (create or update).
   */
  save(iteration: Iteration): Promise<void>;

  /**
   * Delete an iteration by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all iterations for a processing run.
   */
  deleteByProcessingRun(processingRunId: string): Promise<void>;

  /**
   * Update iteration with work item details.
   */
  updateWorkItem(id: string, updates: {
    workItemId: string;
    agentType: AgentType;
  }): Promise<void>;

  /**
   * Complete an iteration with results.
   */
  complete(id: string, result: {
    agentRunId: string;
    durationMs: number;
    costUsd: number;
    pagesCreated: number;
    pagesUpdated: number;
  }): Promise<void>;

  /**
   * Fail an iteration with an error.
   */
  fail(id: string, error: string, durationMs: number): Promise<void>;

  /**
   * Mark an iteration as skipped.
   */
  skip(id: string, reason: string): Promise<void>;
}
