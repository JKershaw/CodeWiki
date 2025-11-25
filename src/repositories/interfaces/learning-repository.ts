import type { Learning, LearningType } from '../../domain/learning.js';

/**
 * Repository interface for managing learnings from AI coding sessions.
 */
export interface LearningRepository {
  /**
   * Find a learning by its ID.
   */
  findById(id: string): Promise<Learning | null>;

  /**
   * Find all learnings for a repo.
   */
  findByRepo(repoId: string, options?: {
    type?: LearningType;
    incorporated?: boolean;
  }): Promise<Learning[]>;

  /**
   * Find unincorporated learnings (not yet added to wiki).
   */
  findUnincorporated(repoId: string): Promise<Learning[]>;

  /**
   * Find high-importance learnings.
   */
  findHighImportance(repoId: string): Promise<Learning[]>;

  /**
   * Save a learning (create or update).
   */
  save(learning: Learning): Promise<void>;

  /**
   * Delete a learning.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all learnings for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Mark a learning as incorporated into the wiki.
   */
  markIncorporated(id: string, incorporatedInto: string[]): Promise<void>;
}
