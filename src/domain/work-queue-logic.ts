/**
 * Pure business logic for work queue selection.
 *
 * This module contains storage-independent logic for determining which work items
 * should be claimed for processing. Both file-based and MongoDB implementations
 * use this shared logic to ensure consistent behavior.
 */

import type { WorkItem } from './work-item.js';
import { getTargetCommitId } from './work-item.js';
import type { AgentType } from './agent-run.js';

/**
 * Analysis agents that process commits.
 * code-change must run first on a commit before other analysis agents.
 */
export const ANALYSIS_AGENTS: AgentType[] = [
  'code-change',
  'narrative',
  'security',
  'technical-debt',
  'pattern',
  'dependency',
];

/**
 * Meta agents that process the wiki.
 * These should only run when no analysis work is pending.
 */
export const META_AGENTS: AgentType[] = [
  'link',
  'structure',
  'quality',
  'consistency',
  'source-verification',
  'category',
];

/**
 * Result of selecting items for a batch claim operation.
 */
export interface BatchSelectionResult {
  /** Items that should be claimed */
  itemsToClaim: WorkItem[];
  /** For debugging: reasons why items were skipped */
  skippedReasons: Map<string, string>;
}

/**
 * Selects which pending work items should be claimed for processing.
 *
 * This is a pure function that applies the following business rules:
 * 1. Bootstrap must run alone - if bootstrap is pending, only claim that
 * 2. Meta agents can only run when no analysis work is pending
 * 3. Non-code-change analysis agents can only run on commits that code-change has processed
 * 4. Same commit cannot be claimed twice in one batch (prevents race conditions)
 *
 * @param pendingItems - Array of pending work items, already sorted by priority
 * @param maxItems - Maximum number of items to claim
 * @param processedCommits - Set of commit IDs that have been processed by code-change
 * @returns Items to claim and reasons for skipped items
 */
export function selectItemsForBatch(
  pendingItems: WorkItem[],
  maxItems: number,
  processedCommits: Set<string>
): BatchSelectionResult {
  const itemsToClaim: WorkItem[] = [];
  const skippedReasons = new Map<string, string>();

  if (pendingItems.length === 0) {
    return { itemsToClaim, skippedReasons };
  }

  // Rule 1: If bootstrap is pending, return only that
  const bootstrapItem = pendingItems.find(w => w.agentType === 'bootstrap');
  if (bootstrapItem) {
    return {
      itemsToClaim: [bootstrapItem],
      skippedReasons,
    };
  }

  // Check if there's any analysis work pending (for meta agent gating)
  const hasAnalysisPending = pendingItems.some(w =>
    ANALYSIS_AGENTS.includes(w.agentType as AgentType)
  );

  // Track (commit, agentType) pairs to prevent duplicate work, but allow
  // different agents to process the same commit in parallel
  const claimedCommitAgentPairs = new Set<string>();

  for (const item of pendingItems) {
    if (itemsToClaim.length >= maxItems) break;

    // Rule 2: Meta agents can only run when no analysis work is pending
    if (META_AGENTS.includes(item.agentType as AgentType)) {
      if (hasAnalysisPending) {
        skippedReasons.set(item.id, 'meta_agent_blocked_by_analysis');
        continue;
      }
    }

    const targetCommitId = getTargetCommitId(item);

    // Rule 3: For commit-targeted non-code-change analysis agents,
    // verify code-change has already processed this commit
    if (
      targetCommitId &&
      item.agentType !== 'code-change' &&
      ANALYSIS_AGENTS.includes(item.agentType as AgentType)
    ) {
      if (!processedCommits.has(targetCommitId)) {
        skippedReasons.set(item.id, 'waiting_for_code_change');
        continue;
      }
    }

    // Rule 4: Don't claim the same (commit, agentType) pair twice in one batch
    // This prevents duplicate work while allowing different agents to process
    // the same commit in parallel for increased throughput
    if (targetCommitId) {
      const pairKey = `${targetCommitId}:${item.agentType}`;
      if (claimedCommitAgentPairs.has(pairKey)) {
        skippedReasons.set(item.id, 'commit_agent_pair_already_claimed_in_batch');
        continue;
      }
      claimedCommitAgentPairs.add(pairKey);
    }

    // This item passes all checks
    itemsToClaim.push(item);
  }

  return { itemsToClaim, skippedReasons };
}

/**
 * Check if an agent type is an analysis agent.
 */
export function isAnalysisAgent(agentType: AgentType): boolean {
  return ANALYSIS_AGENTS.includes(agentType);
}

/**
 * Check if an agent type is a meta agent.
 */
export function isMetaAgent(agentType: AgentType): boolean {
  return META_AGENTS.includes(agentType);
}
