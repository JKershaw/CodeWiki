import type { Commit, AgentProcessingRecord } from '../../domain/commit.js';

/**
 * Repository interface for managing commits.
 */
export interface CommitRepository {
  /**
   * Find a commit by its ID.
   */
  findById(id: string): Promise<Commit | null>;

  /**
   * Find a commit by repo and SHA.
   */
  findBySha(repoId: string, sha: string): Promise<Commit | null>;

  /**
   * Find all commits for a repo, ordered by commit date (newest first).
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
  }): Promise<Commit[]>;

  /**
   * Find commits that haven't been processed by a specific agent type.
   */
  findUnprocessedByAgent(repoId: string, agentType: string): Promise<Commit[]>;

  /**
   * Find commits within a date range.
   */
  findByDateRange(repoId: string, start: Date, end: Date): Promise<Commit[]>;

  /**
   * Count total commits for a repo.
   */
  countByRepo(repoId: string): Promise<number>;

  /**
   * Count commits processed by a specific agent type.
   */
  countProcessedByAgent(repoId: string, agentType: string): Promise<number>;

  /**
   * Save a commit (create or update).
   */
  save(commit: Commit): Promise<void>;

  /**
   * Save multiple commits.
   */
  saveMany(commits: Commit[]): Promise<void>;

  /**
   * Delete all commits for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Add a processing record to a commit.
   */
  addProcessingRecord(commitId: string, record: AgentProcessingRecord): Promise<void>;
}
