import type { OrchestratorRun } from '../../domain/orchestrator-run.js';

/**
 * Repository interface for tracking orchestrator decisions.
 * Used for debugging, analysis, and prompt tuning.
 */
export interface OrchestratorRunRepository {
  /**
   * Find an orchestrator run by its ID.
   */
  findById(id: string): Promise<OrchestratorRun | null>;

  /**
   * Find all orchestrator runs for a repo.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    usedLLM?: boolean;
  }): Promise<OrchestratorRun[]>;

  /**
   * Find recent orchestrator runs.
   */
  findRecent(repoId: string, since: Date): Promise<OrchestratorRun[]>;

  /**
   * Save an orchestrator run.
   */
  save(run: OrchestratorRun): Promise<void>;

  /**
   * Delete old runs (for cleanup).
   */
  deleteOlderThan(repoId: string, olderThan: Date): Promise<number>;
}
