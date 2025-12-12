/**
 * Phase detection for wiki generation.
 *
 * Phase is DETECTED from wiki state, not stored. The detected phase determines
 * which strategy provides work - only ONE strategy runs per call.
 *
 * Phases (in order):
 * 1. Bootstrap - Wiki is empty
 * 2. Exploration - Document the current codebase
 * 3. Synthesis - Create structural/navigation pages
 * 4. Quality - Improve wiki coherence
 * 5. History - Add historical context from commits
 * 6. Continuous - Ongoing maintenance
 */

import type { DirectoryCoverage } from './context-gatherer.js';

/**
 * Wiki generation phase.
 */
export type WikiPhase = 'bootstrap' | 'exploration' | 'synthesis' | 'quality' | 'history' | 'continuous';

/**
 * Context needed for phase detection.
 * This is a subset of OrchestratorContext focused on phase detection criteria.
 */
export interface PhaseDetectionContext {
  /** Number of wiki pages */
  wikiPages: number;
  /** Directory coverage information (optional - for lightweight API detection) */
  directoryCoverage: DirectoryCoverage[];
  /** Whether project overview page exists */
  hasProjectOverview: boolean;
  /** Whether getting-started page exists */
  hasGettingStarted: boolean;
  /** Number of pages without links */
  pagesWithoutLinks: number;
  /** Whether quality agent has run this session */
  qualityAgentHasRun: boolean;
  /** Whether unprocessed commits exist */
  unprocessedCommitsExist: boolean;
  /**
   * Whether exploration work is pending in the queue.
   * Used as alternative to directory coverage for lightweight detection.
   */
  hasExplorationWorkPending?: boolean;
}

/** Default coverage threshold for exploration phase (50%) */
const COVERAGE_THRESHOLD = 50;

/**
 * Minimum pages before we assume exploration might be done.
 * Used when directory coverage is unavailable.
 */
const MIN_PAGES_FOR_EXPLORATION_COMPLETE = 5;

/**
 * Detect the current wiki generation phase based on wiki state.
 *
 * Phases are checked in strict order - the first matching phase wins.
 * This ensures work types are never mixed.
 *
 * @param ctx - Phase detection context
 * @returns The detected phase
 */
export function detectCurrentPhase(ctx: PhaseDetectionContext): WikiPhase {
  // 1. Bootstrap: Wiki is empty
  if (ctx.wikiPages === 0) {
    return 'bootstrap';
  }

  // 2. Exploration: Any directory with coverage below threshold
  // If directory coverage is available, use it for precise detection.
  // Otherwise, use heuristics: pending exploration work OR few pages.
  if (ctx.directoryCoverage.length > 0) {
    const hasLowCoverageDirectory = ctx.directoryCoverage.some(
      d => d.coveragePercent < COVERAGE_THRESHOLD
    );
    if (hasLowCoverageDirectory) {
      return 'exploration';
    }
  } else {
    // Lightweight detection: use pending work or page count heuristic
    if (ctx.hasExplorationWorkPending) {
      return 'exploration';
    }
    // If very few pages, likely still in exploration
    if (ctx.wikiPages < MIN_PAGES_FOR_EXPLORATION_COMPLETE) {
      return 'exploration';
    }
  }

  // 3. Synthesis: Missing project-overview OR missing getting-started
  if (!ctx.hasProjectOverview || !ctx.hasGettingStarted) {
    return 'synthesis';
  }

  // 4. Quality: Pages without links OR quality agent hasn't run
  if (ctx.pagesWithoutLinks > 0 || !ctx.qualityAgentHasRun) {
    return 'quality';
  }

  // 5. History: Unprocessed commits exist
  if (ctx.unprocessedCommitsExist) {
    return 'history';
  }

  // 6. Continuous: Default/fallback - steady state maintenance
  return 'continuous';
}
