/**
 * Domain types for the Self-Improvement Analysis system.
 *
 * The self-improvement analysis examines benchmark results over time,
 * correlates them with wiki generation activity, and produces
 * actionable recommendations for improving the wiki generation process.
 */

// ============================================================================
// Self-Improvement Run
// ============================================================================

/**
 * A self-improvement analysis run.
 * Analyzes benchmark trends and produces improvement recommendations.
 */
export interface SelfImprovementRun {
  id: string;
  /** Reference to the repository */
  repoId: string;
  /** Reference to the wiki being analyzed */
  wikiId: string;
  /** Current status of the analysis */
  status: SelfImprovementRunStatus;
  /** When the analysis started */
  startedAt: Date;
  /** When the analysis completed */
  completedAt: Date | null;
  /** Benchmark run IDs that were analyzed */
  benchmarkRunIds: string[];
  /** Iteration range covered by the analysis [start, end] */
  iterationRange: [number, number];
  /** The generated markdown report */
  report: string;
  /** Total LLM cost for the analysis */
  costUsd: number;
  /** Error message if failed */
  error: string | null;
}

export type SelfImprovementRunStatus = 'running' | 'completed' | 'failed';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new self-improvement run in running state.
 */
export function createSelfImprovementRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  benchmarkRunIds: string[];
  iterationRange: [number, number];
}): SelfImprovementRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    benchmarkRunIds: params.benchmarkRunIds,
    iterationRange: params.iterationRange,
    report: '',
    costUsd: 0,
    error: null,
  };
}

/**
 * Mark a self-improvement run as completed with a report.
 */
export function completeSelfImprovementRun(
  run: SelfImprovementRun,
  report: string,
  costUsd: number
): SelfImprovementRun {
  return {
    ...run,
    status: 'completed',
    completedAt: new Date(),
    report,
    costUsd,
  };
}

/**
 * Mark a self-improvement run as failed.
 */
export function failSelfImprovementRun(
  run: SelfImprovementRun,
  error: string
): SelfImprovementRun {
  return {
    ...run,
    status: 'failed',
    completedAt: new Date(),
    error,
  };
}

// ============================================================================
// Analysis Context Types
// ============================================================================

/**
 * Summary of benchmark trends for the analysis context.
 */
export interface BenchmarkTrendSummary {
  /** Total number of benchmark runs analyzed */
  totalRuns: number;
  /** Iteration range covered */
  iterationRange: [number, number];
  /** Score progression [first, last] */
  scoreProgression: {
    accuracy: { first: number; last: number; change: number } | null;
    quality: { first: number; last: number; change: number } | null;
  };
  /** Page count progression */
  pageCountProgression: { first: number; last: number };
}

/**
 * Per-question trend across benchmark runs.
 */
export interface QuestionTrend {
  questionId: string;
  question: string;
  category: string;
  difficulty: string;
  /** Grade at each benchmark point */
  grades: Array<{
    benchmarkRunId: string;
    iterationCount: number;
    grade: string;
    confidence: number;
  }>;
  /** Overall trend */
  trend: 'improving' | 'stable' | 'declining' | 'stuck' | 'new';
  /** First and last grade */
  firstGrade: string;
  lastGrade: string;
}

/**
 * Summary of agent activity between iterations.
 */
export interface AgentActivitySummary {
  /** Iteration range */
  fromIteration: number;
  toIteration: number;
  /** Agent run counts */
  agentCounts: Record<string, number>;
  /** Total pages created/updated */
  pagesCreated: number;
  pagesUpdated: number;
  /** Total cost */
  totalCostUsd: number;
}
