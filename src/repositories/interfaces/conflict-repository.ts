import type { Conflict, ConflictStatus, ConflictType, ConflictResolution } from '../../domain/conflict.js';

/**
 * Repository interface for managing detected conflicts.
 */
export interface ConflictRepository {
  /**
   * Find a conflict by its ID.
   */
  findById(id: string): Promise<Conflict | null>;

  /**
   * Find all conflicts for a wiki.
   */
  findByWiki(wikiId: string, options?: {
    status?: ConflictStatus;
    type?: ConflictType;
  }): Promise<Conflict[]>;

  /**
   * Find open conflicts for a wiki.
   */
  findOpen(wikiId: string): Promise<Conflict[]>;

  /**
   * Find conflicts for a specific wiki page.
   */
  findByPage(wikiId: string, pagePath: string): Promise<Conflict[]>;

  /**
   * Count conflicts by status.
   */
  countByStatus(wikiId: string): Promise<Record<ConflictStatus, number>>;

  /**
   * Save a conflict (create or update).
   */
  save(conflict: Conflict): Promise<void>;

  /**
   * Delete a conflict.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all conflicts for a wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;

  /**
   * Resolve a conflict.
   */
  resolve(id: string, resolution: ConflictResolution): Promise<void>;
}
