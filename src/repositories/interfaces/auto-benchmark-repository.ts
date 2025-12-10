import type { AutoBenchmarkRun, AutoBenchmarkStatus, AutoBenchmarkPhase } from '../../domain/auto-benchmark.js';

/**
 * Repository interface for managing auto-benchmark runs.
 */
export interface AutoBenchmarkRepository {
  /**
   * Find an auto-benchmark run by its ID.
   */
  findById(id: string): Promise<AutoBenchmarkRun | null>;

  /**
   * Find all auto-benchmark runs for a repository.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: AutoBenchmarkStatus;
  }): Promise<AutoBenchmarkRun[]>;

  /**
   * Find all auto-benchmark runs for a specific wiki.
   */
  findByWiki(wikiId: string, options?: {
    limit?: number;
    offset?: number;
    status?: AutoBenchmarkStatus;
  }): Promise<AutoBenchmarkRun[]>;

  /**
   * Find a running auto-benchmark for a repository (if any).
   */
  findRunning(repoId: string): Promise<AutoBenchmarkRun | null>;

  /**
   * Find a running auto-benchmark for a specific wiki (if any).
   */
  findRunningByWiki(wikiId: string): Promise<AutoBenchmarkRun | null>;

  /**
   * Find all running auto-benchmarks (for recovery on server restart).
   */
  findAllRunning(): Promise<AutoBenchmarkRun[]>;

  /**
   * Save an auto-benchmark run (create or update).
   */
  save(run: AutoBenchmarkRun): Promise<void>;

  /**
   * Update progress (current cycle and phase).
   */
  updateProgress(id: string, cycle: number, phase: AutoBenchmarkPhase): Promise<void>;

  /**
   * Mark an auto-benchmark run as completed.
   */
  complete(id: string): Promise<void>;

  /**
   * Mark an auto-benchmark run as failed with an error.
   */
  fail(id: string, error: string): Promise<void>;

  /**
   * Mark an auto-benchmark run as stopped (user requested stop).
   */
  stop(id: string): Promise<void>;

  /**
   * Delete an auto-benchmark run by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all auto-benchmark runs for a repository.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Delete all auto-benchmark runs for a specific wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;
}
