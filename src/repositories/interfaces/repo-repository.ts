import type { Repo, RepoStatus } from '../../domain/repo.js';

/**
 * Repository interface for managing connected Git repositories.
 */
export interface RepoRepository {
  /**
   * Find a repo by its ID.
   */
  findById(id: string): Promise<Repo | null>;

  /**
   * Find a repo by its full name (owner/name format).
   */
  findByFullName(fullName: string): Promise<Repo | null>;

  /**
   * Find all repos with a given status.
   */
  findByStatus(status: RepoStatus): Promise<Repo[]>;

  /**
   * Get all connected repos.
   */
  findAll(): Promise<Repo[]>;

  /**
   * Save a repo (create or update).
   */
  save(repo: Repo): Promise<void>;

  /**
   * Delete a repo by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Update a repo's status.
   */
  updateStatus(id: string, status: RepoStatus): Promise<void>;

  /**
   * Update the last processed timestamp.
   */
  updateLastProcessed(id: string, timestamp: Date): Promise<void>;
}
