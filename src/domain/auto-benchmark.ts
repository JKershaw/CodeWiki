/**
 * Domain types for the Auto-Benchmark system.
 *
 * Auto-benchmarks run multiple cycles of wiki generation iterations
 * followed by benchmark evaluations, persisting state server-side
 * to survive page refreshes and server restarts.
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for an auto-benchmark run.
 */
export interface AutoBenchmarkConfig {
  /** Number of wiki generation iterations per cycle */
  iterationsPerCycle: number;
  /** Maximum number of cycles to run */
  maxCycles: number;
  /** Whether to include quality benchmarks after accuracy benchmarks */
  includeQuality: boolean;
}

// ============================================================================
// Status and Phase Types
// ============================================================================

/**
 * Current phase within a cycle.
 * - iterations: Running wiki generation iterations
 * - accuracy: Running accuracy benchmark
 * - quality: Running quality benchmark (if enabled)
 * - complete: Cycle completed, moving to next or finishing
 */
export type AutoBenchmarkPhase = 'iterations' | 'accuracy' | 'quality' | 'complete';

/**
 * Overall status of the auto-benchmark run.
 * - running: Currently executing
 * - completed: All cycles finished successfully
 * - failed: An error occurred
 * - stopped: User requested stop (after current phase completes)
 */
export type AutoBenchmarkStatus = 'running' | 'completed' | 'failed' | 'stopped';

// ============================================================================
// Auto-Benchmark Run
// ============================================================================

/**
 * A complete auto-benchmark run, tracking multi-cycle execution state.
 * Persisted to database to survive page refreshes and server restarts.
 */
export interface AutoBenchmarkRun {
  /** Unique identifier */
  id: string;
  /** Reference to the repository */
  repoId: string;
  /** Reference to the wiki being benchmarked */
  wikiId: string;
  /** Configuration for this run */
  config: AutoBenchmarkConfig;
  /** Current cycle number (1-indexed) */
  currentCycle: number;
  /** Current phase within the cycle */
  currentPhase: AutoBenchmarkPhase;
  /** Overall status */
  status: AutoBenchmarkStatus;
  /** When the run started */
  startedAt: Date;
  /** When the run completed (success, failure, or stop) */
  completedAt: Date | null;
  /** Error message if failed */
  error: string | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Parameters for creating a new auto-benchmark run.
 */
export interface CreateAutoBenchmarkRunParams {
  id: string;
  repoId: string;
  wikiId: string;
  config: AutoBenchmarkConfig;
}

/**
 * Create a new auto-benchmark run in running state.
 * Validates configuration and initializes state.
 *
 * @throws Error if configuration is invalid
 */
export function createAutoBenchmarkRun(params: CreateAutoBenchmarkRunParams): AutoBenchmarkRun {
  // Validate configuration
  if (params.config.iterationsPerCycle <= 0) {
    throw new Error('iterationsPerCycle must be positive');
  }
  if (params.config.maxCycles <= 0) {
    throw new Error('maxCycles must be positive');
  }

  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    config: {
      iterationsPerCycle: params.config.iterationsPerCycle,
      maxCycles: params.config.maxCycles,
      includeQuality: params.config.includeQuality,
    },
    currentCycle: 1,
    currentPhase: 'iterations',
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    error: null,
  };
}
