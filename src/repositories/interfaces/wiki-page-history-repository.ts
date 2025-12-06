import type { WikiPageHistory } from '../../domain/wiki-page-history.js';

/**
 * Repository interface for managing wiki page history.
 * Stores historical records of all wiki page mutations with full content.
 */
export interface WikiPageHistoryRepository {
  /**
   * Find a history record by its ID.
   */
  findById(id: string): Promise<WikiPageHistory | null>;

  /**
   * Find all history for a specific page, ordered by timestamp descending.
   */
  findByPage(pageId: string): Promise<WikiPageHistory[]>;

  /**
   * Find all history for a wiki, ordered by timestamp descending.
   */
  findByWiki(wikiId: string): Promise<WikiPageHistory[]>;

  /**
   * Find all history for a specific agent run.
   */
  findByAgentRun(agentRunId: string): Promise<WikiPageHistory[]>;

  /**
   * Find history within a time range for a wiki.
   */
  findByTimeRange(wikiId: string, start: Date, end: Date): Promise<WikiPageHistory[]>;

  /**
   * Find history by page path (path at time of change).
   */
  findByPagePath(wikiId: string, pagePath: string): Promise<WikiPageHistory[]>;

  /**
   * Get the most recent history record for a page.
   */
  getLatestByPage(pageId: string): Promise<WikiPageHistory | null>;

  /**
   * Count history records for a wiki.
   */
  countByWiki(wikiId: string): Promise<number>;

  /**
   * Get the next sequence number for a wiki.
   * Used to ensure deterministic ordering when timestamps collide.
   */
  getNextSequenceNumber(wikiId: string): Promise<number>;

  /**
   * Save a history record.
   */
  save(history: WikiPageHistory): Promise<void>;

  /**
   * Delete a history record by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all history for a wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;

  /**
   * Delete all history for a page.
   */
  deleteByPage(pageId: string): Promise<void>;
}
