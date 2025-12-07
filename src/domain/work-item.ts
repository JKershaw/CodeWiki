import type { AgentType } from './agent-run.js';
import {
  type WorkTarget,
  legacyToWorkTarget,
  isCommitTarget,
  isPathTarget,
} from './work-target.js';

// Re-export WorkTarget types for convenience
export {
  type WorkTarget,
  type CommitTarget,
  type PathTarget,
  type WikiTarget,
  createCommitTarget,
  createPathTarget,
  createWikiTarget,
  getWorkTargetKey,
  isCommitTarget,
  isPathTarget,
  isWikiTarget,
  legacyToWorkTarget,
} from './work-target.js';

/**
 * Represents a pending work item in the queue.
 * Not a separate queue service—just database records with timestamps and status.
 */
export interface WorkItem {
  id: string;
  /** Reference to the repo */
  repoId: string;
  /** Agent type to execute */
  agentType: AgentType;
  /** The target of this work item (commit, path, or wiki) */
  target: WorkTarget;
  /** Priority (higher = more urgent) */
  priority: number;
  /** Current status */
  status: WorkItemStatus;
  /** When this item was created */
  createdAt: Date;
  /** When this item was claimed for processing */
  claimedAt: Date | null;
  /** When this item was completed */
  completedAt: Date | null;
  /** Reference to the resulting agent run */
  agentRunId: string | null;
  /** Reference to the orchestrator run that created this work item (for provenance tracking) */
  orchestratorRunId: string | null;
}

/**
 * Helper to get targetCommitId from WorkItem (for backward compatibility).
 */
export function getTargetCommitId(item: WorkItem): string | null {
  return isCommitTarget(item.target) ? item.target.commitId : null;
}

/**
 * Helper to get targetPath from WorkItem (for backward compatibility).
 */
export function getTargetPath(item: WorkItem): string | null {
  return isPathTarget(item.target) ? item.target.path : null;
}

export type WorkItemStatus =
  | 'pending'    // Waiting to be processed
  | 'claimed'    // Being processed
  | 'completed'  // Successfully completed
  | 'failed';    // Failed, may be retried

/**
 * Priority levels for work items.
 * Higher values = higher priority.
 */
export const Priority = {
  /** User-requested work */
  USER_REQUEST: 100,
  /** Conflicts that need resolution */
  CONFLICT_RESOLUTION: 90,
  /** Codebase exploration (documenting undocumented code) - runs before commit analysis */
  EXPLORATION: 80,
  /** Recent commits (within last week) */
  RECENT_COMMIT: 75,
  /** Meta work (structure, links, quality) */
  META: 60,
  /** Historical commits (older than a week) */
  HISTORICAL_COMMIT: 50,
  /** Low-confidence pages needing improvement */
  LOW_CONFIDENCE: 45,
  /** Synthesis work (guides, overviews) */
  SYNTHESIS: 40,
  /** Background maintenance */
  BACKGROUND: 10,
} as const;

/**
 * Phase-based priority values.
 * Adjusts priorities based on iteration progress to ensure:
 * - Early phase: Build foundation (exploration leads, synthesis follows closely)
 * - Mid phase: Balanced interleaving of all work types
 * - Late phase: Polish and complete (synthesis and meta lead, analysis backfills)
 */
export const PRIORITY_BY_PHASE = {
  early: {
    exploration: 80,  // Highest - establish baseline content
    synthesis: 65,    // Elevated - create useful structure early
    analysis: 50,     // Lower - historical context can wait
    meta: 45,         // Lowest - quality polish comes later
  },
  mid: {
    exploration: 65,  // Reduced - most areas explored
    synthesis: 60,    // Balanced with analysis
    analysis: 55,     // Raised - catch up on commits
    meta: 50,         // Raised - start improving quality
  },
  late: {
    exploration: 50,  // Low - only fill gaps
    synthesis: 75,    // Highest - complete guides/overviews
    analysis: 40,     // Lowest - backfill only
    meta: 70,         // High - polish and consistency
  },
} as const;

/**
 * Agent type categories for priority assignment.
 */
const ANALYSIS_AGENT_TYPES = new Set([
  'code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency',
]);

const META_AGENT_TYPES = new Set([
  'link', 'structure', 'quality', 'consistency', 'source-verification',
]);

const SYNTHESIS_AGENT_TYPES = new Set([
  'overview', 'project-overview', 'getting-started', 'testing-guide',
  'extension-guide', 'writer', 'wiki-index', 'toc',
]);

/**
 * Iteration phase type (matches context-gatherer.ts).
 */
export type IterationPhase = 'early' | 'mid' | 'late';

/**
 * Get priority for an agent type based on iteration phase.
 *
 * This enables dynamic prioritization:
 * - Early phase: exploration and synthesis lead, analysis deferred
 * - Mid phase: balanced interleaving
 * - Late phase: synthesis and meta lead, analysis backfills
 *
 * Special agents (bootstrap, wiki-editor, consolidation) have fixed priorities
 * regardless of phase.
 *
 * @param agentType - The agent type
 * @param phase - Current iteration phase (undefined = balanced defaults)
 * @returns Priority value (1-100)
 */
export function getPriorityForPhase(
  agentType: string,
  phase: IterationPhase | undefined
): number {
  // Special agents always get fixed priority
  if (agentType === 'bootstrap') {
    return Priority.USER_REQUEST;
  }
  if (agentType === 'wiki-editor') {
    return Priority.USER_REQUEST - 1;
  }
  if (agentType === 'consolidation') {
    return Priority.LOW_CONFIDENCE;
  }

  // Default to mid phase for backwards compatibility
  const effectivePhase = phase ?? 'mid';
  const phasePriorities = PRIORITY_BY_PHASE[effectivePhase];

  // Categorize agent and return phase-appropriate priority
  if (agentType === 'codebase-explorer') {
    return phasePriorities.exploration;
  }
  if (ANALYSIS_AGENT_TYPES.has(agentType)) {
    return phasePriorities.analysis;
  }
  if (META_AGENT_TYPES.has(agentType)) {
    return phasePriorities.meta;
  }
  if (SYNTHESIS_AGENT_TYPES.has(agentType)) {
    return phasePriorities.synthesis;
  }

  // Unknown agent type - return synthesis priority as reasonable default
  return phasePriorities.synthesis;
}

export function createWorkItem(params: {
  id: string;
  repoId: string;
  agentType: AgentType;
  priority: number;
  /** Target for the work. Takes precedence over targetCommitId/targetPath if provided. */
  target?: WorkTarget;
  /** @deprecated Use target instead. Kept for backward compatibility. */
  targetCommitId?: string;
  /** @deprecated Use target instead. Kept for backward compatibility. */
  targetPath?: string;
  orchestratorRunId?: string;
}): WorkItem {
  // Resolve target: prefer explicit target, fall back to legacy fields
  const target = params.target ?? legacyToWorkTarget(
    params.targetCommitId ?? null,
    params.targetPath ?? null
  );

  return {
    id: params.id,
    repoId: params.repoId,
    agentType: params.agentType,
    target,
    priority: params.priority,
    status: 'pending',
    createdAt: new Date(),
    claimedAt: null,
    completedAt: null,
    agentRunId: null,
    orchestratorRunId: params.orchestratorRunId ?? null,
  };
}
