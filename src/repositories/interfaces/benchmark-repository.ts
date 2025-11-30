import type { BenchmarkRun, BenchmarkRunStatus, BenchmarkResult, BenchmarkSummary } from '../../domain/benchmark.js';

/**
 * Repository interface for managing benchmark runs.
 */
export interface BenchmarkRepository {
  /**
   * Find a benchmark run by its ID.
   */
  findById(id: string): Promise<BenchmarkRun | null>;

  /**
   * Find all benchmark runs for a repository.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: BenchmarkRunStatus;
  }): Promise<BenchmarkRun[]>;

  /**
   * Find the most recent benchmark runs for a repository.
   */
  findLatest(repoId: string, limit?: number): Promise<BenchmarkRun[]>;

  /**
   * Find a running benchmark for a repository (if any).
   */
  findRunning(repoId: string): Promise<BenchmarkRun | null>;

  /**
   * Save a benchmark run (create or update).
   */
  save(run: BenchmarkRun): Promise<void>;

  /**
   * Delete a benchmark run by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all benchmark runs for a repository.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Mark a benchmark run as completed with results.
   */
  complete(id: string, results: BenchmarkResult[], summary: BenchmarkSummary, totalCostUsd: number): Promise<void>;

  /**
   * Mark a benchmark run as failed with an error.
   */
  fail(id: string, error: string): Promise<void>;
}
