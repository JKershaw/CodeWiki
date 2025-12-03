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
  /** Low-confidence pages */
  LOW_CONFIDENCE: 80,
  /** Codebase exploration (documenting undocumented code) - runs before commit analysis to establish current state */
  EXPLORATION: 75,
  /** Recent commits (within last week) */
  RECENT_COMMIT: 70,
  /** Synthesis work (guides, overviews) */
  SYNTHESIS: 50,
  /** Historical commits */
  HISTORICAL_COMMIT: 30,
  /** Meta work (structure, links) */
  META: 20,
  /** Background maintenance */
  BACKGROUND: 10,
} as const;

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
