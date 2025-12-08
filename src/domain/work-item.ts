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
 * Work items are processed in FIFO order based on createdAt.
 */
export interface WorkItem {
  id: string;
  /** Reference to the repo */
  repoId: string;
  /** Agent type to execute */
  agentType: AgentType;
  /** The target of this work item (commit, path, or wiki) */
  target: WorkTarget;
  /** @deprecated Priority is no longer used. Queue is FIFO. Kept for backwards compatibility. */
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

export function createWorkItem(params: {
  id: string;
  repoId: string;
  agentType: AgentType;
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
    priority: 0, // Priority is deprecated, queue is FIFO
    status: 'pending',
    createdAt: new Date(),
    claimedAt: null,
    completedAt: null,
    agentRunId: null,
    orchestratorRunId: params.orchestratorRunId ?? null,
  };
}
