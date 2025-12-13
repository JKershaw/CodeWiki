import type { AgentRun, AgentType, AgentRunStatus, AgentResult, ToolMetrics } from '../../domain/agent-run.js';

/**
 * Repository interface for managing agent run history.
 */
export interface AgentRunRepository {
  /**
   * Find an agent run by its ID.
   */
  findById(id: string): Promise<AgentRun | null>;

  /**
   * Find all runs for a repo.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    agentType?: AgentType;
    status?: AgentRunStatus;
  }): Promise<AgentRun[]>;

  /**
   * Find runs for a specific commit.
   */
  findByCommit(commitId: string): Promise<AgentRun[]>;

  /**
   * Find recent runs by agent type.
   */
  findRecentByType(repoId: string, agentType: AgentType, limit: number): Promise<AgentRun[]>;

  /**
   * Count runs by status for a repo.
   */
  countByStatus(repoId: string): Promise<Record<AgentRunStatus, number>>;

  /**
   * Calculate total cost for a repo (optionally within a time range).
   */
  calculateTotalCost(repoId: string, options?: {
    since?: Date;
    until?: Date;
  }): Promise<number>;

  /**
   * Save an agent run (create or update).
   */
  save(run: AgentRun): Promise<void>;

  /**
   * Delete all runs for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Update run status.
   */
  updateStatus(id: string, status: AgentRunStatus): Promise<void>;

  /**
   * Complete a run with results.
   */
  complete(id: string, result: AgentResult, durationMs: number, costUsd: number, toolMetrics?: ToolMetrics): Promise<void>;

  /**
   * Fail a run with an error.
   */
  fail(id: string, error: string, durationMs: number): Promise<void>;
}
