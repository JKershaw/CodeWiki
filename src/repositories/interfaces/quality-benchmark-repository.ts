import type {
  QualityBenchmarkRun,
  QualityBenchmarkRunStatus,
  PageQualityResult,
  QualityBenchmarkSummary,
} from '../../domain/quality-benchmark.js';

/**
 * Repository interface for managing quality benchmark runs.
 */
export interface QualityBenchmarkRepository {
  /**
   * Find a quality benchmark run by its ID.
   */
  findById(id: string): Promise<QualityBenchmarkRun | null>;

  /**
   * Find all quality benchmark runs for a repository.
   */
  findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: QualityBenchmarkRunStatus;
  }): Promise<QualityBenchmarkRun[]>;

  /**
   * Find the most recent quality benchmark runs for a repository.
   */
  findLatest(repoId: string, limit?: number): Promise<QualityBenchmarkRun[]>;

  /**
   * Find a running quality benchmark for a repository (if any).
   */
  findRunning(repoId: string): Promise<QualityBenchmarkRun | null>;

  /**
   * Save a quality benchmark run (create or update).
   */
  save(run: QualityBenchmarkRun): Promise<void>;

  /**
   * Delete a quality benchmark run by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all quality benchmark runs for a repository.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Mark a quality benchmark run as completed with results.
   */
  complete(
    id: string,
    results: PageQualityResult[],
    summary: QualityBenchmarkSummary,
    totalCostUsd: number
  ): Promise<void>;

  /**
   * Mark a quality benchmark run as failed with an error.
   */
  fail(id: string, error: string): Promise<void>;
}
