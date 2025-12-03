/**
 * CQRS Queries for Benchmark operations.
 *
 * These queries retrieve benchmark run data for analysis and comparison.
 */

import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { BenchmarkRun, BenchmarkGrade } from '../domain/benchmark.js';

// ============================================================================
// GetBenchmarkRun Query
// ============================================================================

/**
 * Query to get a specific benchmark run by ID.
 */
export interface GetBenchmarkRunQuery extends Query {
  readonly type: 'GetBenchmarkRun';
  readonly runId: string;
}

export function createGetBenchmarkRunQuery(runId: string): GetBenchmarkRunQuery {
  return {
    type: 'GetBenchmarkRun',
    runId,
  };
}

/**
 * Handler for GetBenchmarkRun query.
 */
export async function handleGetBenchmarkRun(
  query: GetBenchmarkRunQuery,
  repos: Repositories
): Promise<QueryResult<BenchmarkRun>> {
  try {
    const run = await repos.benchmarks.findById(query.runId);
    if (!run) {
      return notFound(`Benchmark run not found: ${query.runId}`);
    }
    return found(run);
  } catch (error) {
    return queryError(`Failed to get benchmark run: ${error}`);
  }
}

// ============================================================================
// GetBenchmarkHistory Query
// ============================================================================

/**
 * Query to get benchmark history for a repository or wiki.
 * When wikiId is provided, only returns benchmarks for that wiki.
 */
export interface GetBenchmarkHistoryQuery extends Query {
  readonly type: 'GetBenchmarkHistory';
  readonly repoId: string;
  readonly wikiId?: string;
  readonly limit?: number;
}

export function createGetBenchmarkHistoryQuery(
  repoId: string,
  limitOrOptions?: number | { wikiId?: string; limit?: number }
): GetBenchmarkHistoryQuery {
  if (typeof limitOrOptions === 'number') {
    return {
      type: 'GetBenchmarkHistory',
      repoId,
      limit: limitOrOptions,
    };
  }

  if (limitOrOptions) {
    return {
      type: 'GetBenchmarkHistory',
      repoId,
      ...(limitOrOptions.wikiId !== undefined && { wikiId: limitOrOptions.wikiId }),
      ...(limitOrOptions.limit !== undefined && { limit: limitOrOptions.limit }),
    };
  }

  return {
    type: 'GetBenchmarkHistory',
    repoId,
  };
}

/**
 * Summary of a benchmark run for history display.
 */
export interface BenchmarkHistoryEntry {
  id: string;
  iterationCount: number;
  pageCount: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  score: number;
  totalQuestions: number;
  accurate: number;
  partial: number;
  totalCostUsd: number;
}

/**
 * Handler for GetBenchmarkHistory query.
 * When wikiId is provided, returns only benchmarks for that wiki.
 */
export async function handleGetBenchmarkHistory(
  query: GetBenchmarkHistoryQuery,
  repos: Repositories
): Promise<QueryResult<BenchmarkHistoryEntry[]>> {
  try {
    const limit = query.limit ?? 20;

    // Use wiki-specific query if wikiId is provided
    const runs = query.wikiId
      ? await repos.benchmarks.findLatestByWiki(query.wikiId, limit)
      : await repos.benchmarks.findLatest(query.repoId, limit);

    const history: BenchmarkHistoryEntry[] = runs.map(run => ({
      id: run.id,
      iterationCount: run.iterationCount,
      pageCount: run.pageCount ?? 0,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      score: run.summary.score,
      totalQuestions: run.summary.totalQuestions,
      accurate: run.summary.accurate,
      partial: run.summary.partial,
      totalCostUsd: run.totalCostUsd,
    }));

    return found(history);
  } catch (error) {
    return queryError(`Failed to get benchmark history: ${error}`);
  }
}

// ============================================================================
// CompareBenchmarks Query
// ============================================================================

/**
 * Query to compare multiple benchmark runs.
 */
export interface CompareBenchmarksQuery extends Query {
  readonly type: 'CompareBenchmarks';
  readonly runIds: string[];
}

export function createCompareBenchmarksQuery(runIds: string[]): CompareBenchmarksQuery {
  return {
    type: 'CompareBenchmarks',
    runIds,
  };
}

/**
 * Comparison of a single question across multiple runs.
 */
export interface QuestionComparison {
  questionId: string;
  results: Array<{
    runId: string;
    grade: BenchmarkGrade;
    confidence: number;
  }>;
  trend: 'improving' | 'stable' | 'declining' | 'new';
}

/**
 * Full comparison result between benchmark runs.
 */
export interface BenchmarkComparison {
  runs: Array<{
    id: string;
    iterationCount: number;
    score: number;
    startedAt: Date;
  }>;
  scoreChange: number | null;
  questionComparisons: QuestionComparison[];
  improvements: string[];  // Question IDs that improved
  regressions: string[];   // Question IDs that regressed
}

/**
 * Handler for CompareBenchmarks query.
 */
export async function handleCompareBenchmarks(
  query: CompareBenchmarksQuery,
  repos: Repositories
): Promise<QueryResult<BenchmarkComparison>> {
  try {
    if (query.runIds.length < 2) {
      return queryError('At least 2 benchmark runs are required for comparison');
    }

    // Fetch all runs
    const runs: BenchmarkRun[] = [];
    for (const id of query.runIds) {
      const run = await repos.benchmarks.findById(id);
      if (!run) {
        return notFound(`Benchmark run not found: ${id}`);
      }
      if (run.status !== 'completed') {
        return queryError(`Benchmark run is not completed: ${id}`);
      }
      runs.push(run);
    }

    // Validate all runs belong to the same wiki
    const wikiIds = new Set(runs.map(r => r.wikiId));
    if (wikiIds.size > 1) {
      return queryError('Cannot compare benchmarks from different wikis');
    }

    // Sort by iteration count (oldest first)
    runs.sort((a, b) => a.iterationCount - b.iterationCount);

    // Build comparison
    const comparison: BenchmarkComparison = {
      runs: runs.map(r => ({
        id: r.id,
        iterationCount: r.iterationCount,
        score: r.summary.score,
        startedAt: r.startedAt,
      })),
      scoreChange: runs.length >= 2
        ? runs[runs.length - 1]!.summary.score - runs[0]!.summary.score
        : null,
      questionComparisons: [],
      improvements: [],
      regressions: [],
    };

    // Collect all question IDs
    const allQuestionIds = new Set<string>();
    for (const run of runs) {
      for (const result of run.results) {
        allQuestionIds.add(result.questionId);
      }
    }

    // Build per-question comparisons
    for (const questionId of allQuestionIds) {
      const questionResults: QuestionComparison['results'] = [];

      for (const run of runs) {
        const result = run.results.find(r => r.questionId === questionId);
        if (result) {
          questionResults.push({
            runId: run.id,
            grade: result.grade,
            confidence: result.confidence,
          });
        }
      }

      // Determine trend
      let trend: QuestionComparison['trend'] = 'stable';
      if (questionResults.length === 1) {
        trend = 'new';
      } else if (questionResults.length >= 2) {
        const first = questionResults[0]!;
        const last = questionResults[questionResults.length - 1]!;
        const firstScore = gradeToNumeric(first.grade);
        const lastScore = gradeToNumeric(last.grade);

        if (lastScore > firstScore) {
          trend = 'improving';
          comparison.improvements.push(questionId);
        } else if (lastScore < firstScore) {
          trend = 'declining';
          comparison.regressions.push(questionId);
        }
      }

      comparison.questionComparisons.push({
        questionId,
        results: questionResults,
        trend,
      });
    }

    return found(comparison);
  } catch (error) {
    return queryError(`Failed to compare benchmarks: ${error}`);
  }
}

/**
 * Convert grade to numeric value for comparison.
 */
function gradeToNumeric(grade: BenchmarkGrade): number {
  switch (grade) {
    case 'accurate':
      return 3;
    case 'partial':
      return 2;
    case 'inaccurate':
      return 1;
    case 'no_answer':
      return 0;
  }
}
