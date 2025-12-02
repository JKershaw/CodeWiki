/**
 * Repository interface for Self-Improvement Analysis runs.
 */

import type { SelfImprovementRun, AnalysisTrace } from '../../domain/self-improvement.js';

/**
 * Repository for managing self-improvement analysis runs.
 */
export interface SelfImprovementRepository {
  /**
   * Find a self-improvement run by ID.
   */
  findById(id: string): Promise<SelfImprovementRun | null>;

  /**
   * Find all self-improvement runs for a repository.
   */
  findByRepo(repoId: string): Promise<SelfImprovementRun[]>;

  /**
   * Find the latest N self-improvement runs for a repository.
   */
  findLatest(repoId: string, limit?: number): Promise<SelfImprovementRun[]>;

  /**
   * Find any running self-improvement analysis for a repository.
   */
  findRunning(repoId: string): Promise<SelfImprovementRun | null>;

  /**
   * Save a self-improvement run.
   */
  save(run: SelfImprovementRun): Promise<void>;

  /**
   * Delete a self-improvement run.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all self-improvement runs for a repository.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Mark a run as completed with report.
   */
  complete(id: string, report: string, costUsd: number, analysisTrace?: AnalysisTrace): Promise<void>;

  /**
   * Mark a run as failed with error.
   */
  fail(id: string, error: string): Promise<void>;
}
