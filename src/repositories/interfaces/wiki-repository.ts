import type { Wiki, WikiStatus } from '../../domain/wiki.js';

/**
 * Repository interface for managing wikis.
 */
export interface WikiRepository {
  /**
   * Find a wiki by its ID.
   */
  findById(id: string): Promise<Wiki | null>;

  /**
   * Find a wiki by repo and slug.
   */
  findBySlug(repoId: string, slug: string): Promise<Wiki | null>;

  /**
   * Find all wikis for a repo.
   */
  findByRepo(repoId: string): Promise<Wiki[]>;

  /**
   * Find the active wiki for a repo.
   * Returns null if no wiki is active.
   */
  findActive(repoId: string): Promise<Wiki | null>;

  /**
   * Find wikis by status.
   */
  findByStatus(repoId: string, status: WikiStatus): Promise<Wiki[]>;

  /**
   * Save a wiki (create or update).
   */
  save(wiki: Wiki): Promise<void>;

  /**
   * Delete a wiki by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all wikis for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Set a wiki as the active wiki for its repo.
   * Deactivates any other active wiki for the same repo.
   */
  setActive(id: string): Promise<void>;

  /**
   * Update a wiki's status.
   */
  updateStatus(id: string, status: WikiStatus): Promise<void>;

  /**
   * Update the last processed commit SHA.
   */
  updateLastProcessedCommit(id: string, sha: string): Promise<void>;

  /**
   * Increment the total iterations count for a wiki.
   */
  incrementIterations(id: string, count: number): Promise<void>;
}
