import type { AgentType } from './agent-run.js';
import type { WorkTarget } from './work-target.js';

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

export type WorkItemStatus =
  | 'pending'    // Waiting to be processed
  | 'claimed'    // Being processed
  | 'completed'  // Successfully completed
  | 'failed';    // Failed, may be retried

export function createWorkItem(params: {
  id: string;
  repoId: string;
  agentType: AgentType;
  /** Target for the work (commit, path, or wiki) */
  target: WorkTarget;
  orchestratorRunId?: string;
}): WorkItem {
  return {
    id: params.id,
    repoId: params.repoId,
    agentType: params.agentType,
    target: params.target,
    status: 'pending',
    createdAt: new Date(),
    claimedAt: null,
    completedAt: null,
    agentRunId: null,
    orchestratorRunId: params.orchestratorRunId ?? null,
  };
}
