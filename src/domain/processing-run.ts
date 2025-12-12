/**
 * Processing phases for the phased pipeline architecture.
 * Each phase completes before the next begins, enabling focused work.
 */
export const PROCESSING_PHASES = [
  'bootstrap',    // Initial wiki setup
  'exploration',  // Document current codebase (depth-first)
  'synthesis',    // Create structural pages (overview, guides)
  'quality',      // Run meta agents (link, quality, consistency)
  'history',      // Process historical commits (LLM orchestrator)
  'continuous',   // Ongoing improvement (LLM orchestrator)
] as const;

export type ProcessingPhase = typeof PROCESSING_PHASES[number];

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'skipped';

/**
 * Status of each phase in the pipeline.
 */
export type PhaseStatusMap = Record<ProcessingPhase, PhaseStatus>;

/**
 * Represents a processing session - a single invocation of runIterations().
 * Tracks the overall progress of processing a repository.
 */
export interface ProcessingRun {
  id: string;
  /** Reference to the repo being processed */
  repoId: string;
  /** Reference to the wiki being updated */
  wikiId: string;
  /** Current status of the processing run */
  status: ProcessingRunStatus;
  /** Total number of iterations requested */
  totalIterations: number;
  /** Number of iterations completed so far */
  completedIterations: number;
  /** When the processing run started */
  startedAt: Date;
  /** When the processing run completed (success, failure, or stopped) */
  completedAt: Date | null;
  /** Accumulated metrics */
  successfulIterations: number;
  failedIterations: number;
  totalCostUsd: number;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  /** Error message if failed */
  error: string | null;

  // Phase tracking fields
  /** Current phase in the pipeline */
  currentPhase: ProcessingPhase;
  /** Progress within the current phase (e.g., directories explored) */
  phaseProgress: number;
  /** Target for current phase completion (e.g., total directories to explore) */
  phaseTarget: number | null;
  /** Status of each phase */
  phaseStatus: PhaseStatusMap;
}

export type ProcessingRunStatus =
  | 'running'    // Currently processing
  | 'stopping'   // Graceful shutdown requested, finishing current work
  | 'completed'  // All iterations finished successfully
  | 'failed'     // Stopped due to error
  | 'stopped';   // Manually stopped

/**
 * Create the initial phase status map with all phases pending except bootstrap.
 */
function createInitialPhaseStatus(): PhaseStatusMap {
  return {
    bootstrap: 'running',
    exploration: 'pending',
    synthesis: 'pending',
    quality: 'pending',
    history: 'pending',
    continuous: 'pending',
  };
}

/**
 * Create a new processing run record.
 */
export function createProcessingRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  totalIterations: number;
}): ProcessingRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    status: 'running',
    totalIterations: params.totalIterations,
    completedIterations: 0,
    startedAt: new Date(),
    completedAt: null,
    successfulIterations: 0,
    failedIterations: 0,
    totalCostUsd: 0,
    wikiPagesCreated: 0,
    wikiPagesUpdated: 0,
    error: null,
    // Phase tracking - starts at bootstrap
    currentPhase: 'bootstrap',
    phaseProgress: 0,
    phaseTarget: null,
    phaseStatus: createInitialPhaseStatus(),
  };
}

/**
 * Get the next phase in the pipeline.
 * Returns null if already at the final phase (continuous).
 */
export function getNextPhase(currentPhase: ProcessingPhase): ProcessingPhase | null {
  const currentIndex = PROCESSING_PHASES.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex >= PROCESSING_PHASES.length - 1) {
    return null;
  }
  // Index is guaranteed to be valid due to the check above
  return PROCESSING_PHASES[currentIndex + 1] ?? null;
}

/**
 * Check if the current phase is complete based on progress vs target.
 * Returns false if target is null (phase completion must be explicitly signaled).
 */
export function isPhaseComplete(run: ProcessingRun): boolean {
  if (run.phaseTarget === null) {
    return false;
  }
  return run.phaseProgress >= run.phaseTarget;
}
