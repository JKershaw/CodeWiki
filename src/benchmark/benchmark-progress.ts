/**
 * In-memory benchmark progress tracking.
 *
 * Tracks progress of running benchmarks to enable:
 * - Page reload without losing visibility of progress
 * - Live progress updates in the UI
 *
 * Note: This state is lost on server restart, which is acceptable
 * for a developer tool. The benchmark will be stuck as "running"
 * and can be deleted manually.
 */

import type { BenchmarkResult } from '../domain/benchmark.js';
import type { PageQualityResult } from '../domain/quality-benchmark.js';

/**
 * Progress state for an accuracy benchmark.
 */
export interface AccuracyBenchmarkProgress {
  runId: string;
  repoId: string;
  wikiId: string;
  totalQuestions: number;
  completedCount: number;
  results: BenchmarkResult[];
  startedAt: Date;
}

/**
 * Progress state for a quality benchmark.
 */
export interface QualityBenchmarkProgress {
  runId: string;
  repoId: string;
  wikiId: string;
  totalPages: number;
  completedCount: number;
  results: PageQualityResult[];
  startedAt: Date;
}

// In-memory stores - lost on server restart
const accuracyProgress = new Map<string, AccuracyBenchmarkProgress>();
const qualityProgress = new Map<string, QualityBenchmarkProgress>();

// ============================================================================
// Accuracy Benchmark Progress
// ============================================================================

/**
 * Start tracking an accuracy benchmark.
 */
export function startAccuracyTracking(
  runId: string,
  repoId: string,
  wikiId: string,
  totalQuestions: number
): void {
  accuracyProgress.set(runId, {
    runId,
    repoId,
    wikiId,
    totalQuestions,
    completedCount: 0,
    results: [],
    startedAt: new Date(),
  });
}

/**
 * Record a completed question result.
 */
export function recordAccuracyResult(runId: string, result: BenchmarkResult): void {
  const progress = accuracyProgress.get(runId);
  if (progress) {
    progress.results.push(result);
    progress.completedCount = progress.results.length;
  }
}

/**
 * Get the current progress for an accuracy benchmark.
 */
export function getAccuracyProgress(runId: string): AccuracyBenchmarkProgress | undefined {
  return accuracyProgress.get(runId);
}

/**
 * Get progress for a running benchmark by repo ID.
 */
export function getAccuracyProgressByRepo(repoId: string): AccuracyBenchmarkProgress | undefined {
  for (const progress of accuracyProgress.values()) {
    if (progress.repoId === repoId) {
      return progress;
    }
  }
  return undefined;
}

/**
 * Clear tracking for an accuracy benchmark (on completion or failure).
 */
export function clearAccuracyTracking(runId: string): void {
  accuracyProgress.delete(runId);
}

// ============================================================================
// Quality Benchmark Progress
// ============================================================================

/**
 * Start tracking a quality benchmark.
 */
export function startQualityTracking(
  runId: string,
  repoId: string,
  wikiId: string,
  totalPages: number
): void {
  qualityProgress.set(runId, {
    runId,
    repoId,
    wikiId,
    totalPages,
    completedCount: 0,
    results: [],
    startedAt: new Date(),
  });
}

/**
 * Record a completed page evaluation result.
 */
export function recordQualityResult(runId: string, result: PageQualityResult): void {
  const progress = qualityProgress.get(runId);
  if (progress) {
    progress.results.push(result);
    progress.completedCount = progress.results.length;
  }
}

/**
 * Get the current progress for a quality benchmark.
 */
export function getQualityProgress(runId: string): QualityBenchmarkProgress | undefined {
  return qualityProgress.get(runId);
}

/**
 * Get progress for a running quality benchmark by repo ID.
 */
export function getQualityProgressByRepo(repoId: string): QualityBenchmarkProgress | undefined {
  for (const progress of qualityProgress.values()) {
    if (progress.repoId === repoId) {
      return progress;
    }
  }
  return undefined;
}

/**
 * Clear tracking for a quality benchmark (on completion or failure).
 */
export function clearQualityTracking(runId: string): void {
  qualityProgress.delete(runId);
}
