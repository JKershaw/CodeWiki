import type { AgentType } from './agent-run.js';

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
  /** Target commit (for commit-focused work) */
  targetCommitId: string | null;
  /** Target path (directory or file for exploration agents, or wiki page path) */
  targetPath: string | null;
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
  targetCommitId?: string;
  targetPath?: string;
  orchestratorRunId?: string;
}): WorkItem {
  return {
    id: params.id,
    repoId: params.repoId,
    agentType: params.agentType,
    targetCommitId: params.targetCommitId ?? null,
    targetPath: params.targetPath ?? null,
    priority: params.priority,
    status: 'pending',
    createdAt: new Date(),
    claimedAt: null,
    completedAt: null,
    agentRunId: null,
    orchestratorRunId: params.orchestratorRunId ?? null,
  };
}
