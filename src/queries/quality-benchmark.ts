/**
 * CQRS Queries for Quality Benchmark operations.
 *
 * These queries retrieve quality benchmark run data for analysis and comparison.
 */

import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type {
  QualityBenchmarkRun,
  QualityDimension,
} from '../domain/quality-benchmark.js';
import { QUALITY_DIMENSIONS } from '../domain/quality-benchmark.js';

// ============================================================================
// GetQualityBenchmarkRun Query
// ============================================================================

/**
 * Query to get a specific quality benchmark run by ID.
 */
export interface GetQualityBenchmarkRunQuery extends Query {
  readonly type: 'GetQualityBenchmarkRun';
  readonly runId: string;
}

export function createGetQualityBenchmarkRunQuery(runId: string): GetQualityBenchmarkRunQuery {
  return {
    type: 'GetQualityBenchmarkRun',
    runId,
  };
}

/**
 * Handler for GetQualityBenchmarkRun query.
 */
export async function handleGetQualityBenchmarkRun(
  query: GetQualityBenchmarkRunQuery,
  repos: Repositories
): Promise<QueryResult<QualityBenchmarkRun>> {
  try {
    const run = await repos.qualityBenchmarks.findById(query.runId);
    if (!run) {
      return notFound(`Quality benchmark run not found: ${query.runId}`);
    }
    return found(run);
  } catch (error) {
    return queryError(`Failed to get quality benchmark run: ${error}`);
  }
}

// ============================================================================
// GetQualityBenchmarkHistory Query
// ============================================================================

/**
 * Query to get quality benchmark history for a repository or wiki.
 * When wikiId is provided, only returns benchmarks for that wiki.
 */
export interface GetQualityBenchmarkHistoryQuery extends Query {
  readonly type: 'GetQualityBenchmarkHistory';
  readonly repoId: string;
  readonly wikiId?: string;
  readonly limit?: number;
}

export function createGetQualityBenchmarkHistoryQuery(
  repoId: string,
  limitOrOptions?: number | { wikiId?: string; limit?: number }
): GetQualityBenchmarkHistoryQuery {
  if (typeof limitOrOptions === 'number') {
    return {
      type: 'GetQualityBenchmarkHistory',
      repoId,
      limit: limitOrOptions,
    };
  }

  if (limitOrOptions) {
    return {
      type: 'GetQualityBenchmarkHistory',
      repoId,
      ...(limitOrOptions.wikiId !== undefined && { wikiId: limitOrOptions.wikiId }),
      ...(limitOrOptions.limit !== undefined && { limit: limitOrOptions.limit }),
    };
  }

  return {
    type: 'GetQualityBenchmarkHistory',
    repoId,
  };
}

/**
 * Summary of a quality benchmark run for history display.
 */
export interface QualityBenchmarkHistoryEntry {
  id: string;
  iterationCount: number;
  pageCount: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  overallScore: number;
  pagesEvaluated: number;
  totalCostUsd: number;
}

/**
 * Handler for GetQualityBenchmarkHistory query.
 * When wikiId is provided, returns only benchmarks for that wiki.
 */
export async function handleGetQualityBenchmarkHistory(
  query: GetQualityBenchmarkHistoryQuery,
  repos: Repositories
): Promise<QueryResult<QualityBenchmarkHistoryEntry[]>> {
  try {
    const limit = query.limit ?? 20;

    // Use wiki-specific query if wikiId is provided
    const runs = query.wikiId
      ? await repos.qualityBenchmarks.findLatestByWiki(query.wikiId, limit)
      : await repos.qualityBenchmarks.findLatest(query.repoId, limit);

    const history: QualityBenchmarkHistoryEntry[] = runs.map(run => ({
      id: run.id,
      iterationCount: run.iterationCount,
      pageCount: run.pageCount ?? 0,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      overallScore: run.summary.overallScore,
      pagesEvaluated: run.summary.pagesEvaluated,
      totalCostUsd: run.totalCostUsd,
    }));

    return found(history);
  } catch (error) {
    return queryError(`Failed to get quality benchmark history: ${error}`);
  }
}

// ============================================================================
// CompareQualityBenchmarks Query
// ============================================================================

/**
 * Query to compare multiple quality benchmark runs.
 */
export interface CompareQualityBenchmarksQuery extends Query {
  readonly type: 'CompareQualityBenchmarks';
  readonly runIds: string[];
}

export function createCompareQualityBenchmarksQuery(runIds: string[]): CompareQualityBenchmarksQuery {
  return {
    type: 'CompareQualityBenchmarks',
    runIds,
  };
}

/**
 * Comparison of a single dimension across multiple runs.
 */
export interface DimensionComparison {
  dimension: QualityDimension;
  scores: Array<{
    runId: string;
    score: number;
  }>;
  trend: 'improving' | 'stable' | 'declining';
  change: number; // Difference between first and last
}

/**
 * Full comparison result between quality benchmark runs.
 */
export interface QualityBenchmarkComparison {
  runs: Array<{
    id: string;
    iterationCount: number;
    overallScore: number;
    startedAt: Date;
  }>;
  overallScoreChange: number | null;
  dimensionComparisons: DimensionComparison[];
  improving: QualityDimension[]; // Dimensions that improved
  declining: QualityDimension[]; // Dimensions that declined
}

/**
 * Handler for CompareQualityBenchmarks query.
 */
export async function handleCompareQualityBenchmarks(
  query: CompareQualityBenchmarksQuery,
  repos: Repositories
): Promise<QueryResult<QualityBenchmarkComparison>> {
  try {
    if (query.runIds.length < 2) {
      return queryError('At least 2 quality benchmark runs are required for comparison');
    }

    // Fetch all runs
    const runs: QualityBenchmarkRun[] = [];
    for (const id of query.runIds) {
      const run = await repos.qualityBenchmarks.findById(id);
      if (!run) {
        return notFound(`Quality benchmark run not found: ${id}`);
      }
      if (run.status !== 'completed') {
        return queryError(`Quality benchmark run is not completed: ${id}`);
      }
      runs.push(run);
    }

    // Validate all runs belong to the same wiki
    const wikiIds = new Set(runs.map(r => r.wikiId));
    if (wikiIds.size > 1) {
      return queryError('Cannot compare quality benchmarks from different wikis');
    }

    // Sort by iteration count (oldest first)
    runs.sort((a, b) => a.iterationCount - b.iterationCount);

    // Build comparison
    const comparison: QualityBenchmarkComparison = {
      runs: runs.map(r => ({
        id: r.id,
        iterationCount: r.iterationCount,
        overallScore: r.summary.overallScore,
        startedAt: r.startedAt,
      })),
      overallScoreChange:
        runs.length >= 2
          ? runs[runs.length - 1]!.summary.overallScore - runs[0]!.summary.overallScore
          : null,
      dimensionComparisons: [],
      improving: [],
      declining: [],
    };

    // Build per-dimension comparisons
    for (const dimension of QUALITY_DIMENSIONS) {
      const scores = runs.map(run => ({
        runId: run.id,
        score: run.summary.byDimension[dimension],
      }));

      const firstScore = scores[0]!.score;
      const lastScore = scores[scores.length - 1]!.score;
      const change = lastScore - firstScore;

      let trend: DimensionComparison['trend'] = 'stable';
      if (change > 5) {
        trend = 'improving';
        comparison.improving.push(dimension);
      } else if (change < -5) {
        trend = 'declining';
        comparison.declining.push(dimension);
      }

      comparison.dimensionComparisons.push({
        dimension,
        scores,
        trend,
        change,
      });
    }

    return found(comparison);
  } catch (error) {
    return queryError(`Failed to compare quality benchmarks: ${error}`);
  }
}
