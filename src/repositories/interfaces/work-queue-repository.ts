import type { WorkItem, WorkItemStatus } from '../../domain/work-item.js';
import type { AgentType } from '../../domain/agent-run.js';

/**
 * Repository interface for managing the work queue.
 * The queue is just database records—not a separate queue service.
 */
export interface WorkQueueRepository {
  /**
   * Find a work item by its ID.
   */
  findById(id: string): Promise<WorkItem | null>;

  /**
   * Find pending work items for a repo, ordered by priority (highest first).
   */
  findPending(repoId: string, limit: number): Promise<WorkItem[]>;

  /**
   * Find all work items for a repo.
   */
  findByRepo(repoId: string, options?: {
    status?: WorkItemStatus;
    agentType?: AgentType;
  }): Promise<WorkItem[]>;

  /**
   * Count pending work items for a repo.
   */
  countPending(repoId: string): Promise<number>;

  /**
   * Count work items by status.
   */
  countByStatus(repoId: string): Promise<Record<WorkItemStatus, number>>;

  /**
   * Save a work item (create or update).
   */
  save(item: WorkItem): Promise<void>;

  /**
   * Save multiple work items.
   */
  saveMany(items: WorkItem[]): Promise<void>;

  /**
   * Delete a work item.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all work items for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Claim the next pending work item (atomically set status to 'claimed').
   * Returns null if no work is available.
   */
  claimNext(repoId: string): Promise<WorkItem | null>;

  /**
   * Claim a batch of work items for parallel execution.
   * Respects ordering constraints:
   * - Bootstrap must run alone
   * - code-change must complete on a commit before other analysis agents
   * - Meta agents only run when no analysis work is pending
   * - Same commit won't be claimed by multiple agents in one batch
   *
   * @param repoId - Repository to claim work for
   * @param maxItems - Maximum number of items to claim
   * @param processedCommits - Set of commit SHAs already processed by code-change agent
   * @returns Array of claimed work items (may be empty if no work available)
   */
  claimBatch(
    repoId: string,
    maxItems: number,
    processedCommits: Set<string>
  ): Promise<WorkItem[]>;

  /**
   * Complete a work item.
   */
  complete(id: string, agentRunId: string): Promise<void>;

  /**
   * Fail a work item.
   */
  fail(id: string): Promise<void>;

  /**
   * Check if work for a specific commit and agent type already exists.
   */
  exists(repoId: string, agentType: AgentType, targetCommitId: string): Promise<boolean>;
}
