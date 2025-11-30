import type { EditRequest, EditRequestStatus } from '../../domain/edit-request.js';

/**
 * Repository interface for managing edit requests.
 * Edit requests are proposed wiki updates from analysis agents
 * that queue up for the WikiEditorAgent to process.
 */
export interface EditRequestRepository {
  /**
   * Find an edit request by its ID.
   */
  findById(id: string): Promise<EditRequest | null>;

  /**
   * Find all pending edit requests for a wiki, ordered by commit timestamp.
   * This is the primary method used by WikiEditorAgent to get work.
   */
  findPending(wikiId: string): Promise<EditRequest[]>;

  /**
   * Find edit requests for a specific wiki page path.
   */
  findByPagePath(wikiId: string, pagePath: string): Promise<EditRequest[]>;

  /**
   * Find edit requests from a specific commit.
   */
  findByCommit(repoId: string, commitSha: string): Promise<EditRequest[]>;

  /**
   * Find edit requests created by a specific agent run.
   */
  findByAgentRun(agentRunId: string): Promise<EditRequest[]>;

  /**
   * Find edit requests by status.
   */
  findByStatus(wikiId: string, status: EditRequestStatus): Promise<EditRequest[]>;

  /**
   * Count pending edit requests for a wiki.
   */
  countPending(wikiId: string): Promise<number>;

  /**
   * Check if there are any pending edit requests for a specific page.
   */
  hasPendingForPage(wikiId: string, pagePath: string): Promise<boolean>;

  /**
   * Save an edit request (create or update).
   */
  save(editRequest: EditRequest): Promise<void>;

  /**
   * Save multiple edit requests at once.
   */
  saveMany(editRequests: EditRequest[]): Promise<void>;

  /**
   * Mark an edit request as processed with a decision.
   */
  markProcessed(
    id: string,
    status: EditRequestStatus,
    processingNotes: string,
    processedByAgentRunId: string
  ): Promise<void>;

  /**
   * Delete an edit request by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all edit requests for a wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;

  /**
   * Delete edit requests from a specific agent run.
   * Used when an agent run is invalidated.
   */
  deleteByAgentRun(agentRunId: string): Promise<void>;

  /**
   * Get the oldest pending edit request timestamp for a wiki.
   * Useful for determining if there's a backlog.
   */
  getOldestPendingTimestamp(wikiId: string): Promise<Date | null>;
}
