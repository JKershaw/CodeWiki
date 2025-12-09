/**
 * CQRS Commands for Work Queue operations.
 *
 * These commands handle all work queue state changes,
 * providing a clean boundary for the executor's work management.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WorkItem } from '../domain/work-item.js';

// ============================================================================
// ClaimWorkItem Command
// ============================================================================

/**
 * Command to claim the next pending work item for a repository.
 * Atomically sets the work item status to 'claimed'.
 */
export interface ClaimWorkItemCommand extends Command {
  readonly type: 'ClaimWorkItem';
  readonly repoId: string;
}

export function createClaimWorkItemCommand(repoId: string): ClaimWorkItemCommand {
  return {
    type: 'ClaimWorkItem',
    repoId,
  };
}

/**
 * Handler for ClaimWorkItem command.
 * Returns the claimed work item, or null if no work is available.
 */
export async function handleClaimWorkItem(
  command: ClaimWorkItemCommand,
  repos: Repositories
): Promise<CommandResult<WorkItem | null>> {
  try {
    const workItem = await repos.workQueue.claimNext(command.repoId);
    return success(workItem);
  } catch (error) {
    return failure(`Failed to claim work item: ${error}`);
  }
}

// ============================================================================
// ClaimWorkItemBatch Command
// ============================================================================

/**
 * Command to claim a batch of pending work items for parallel execution.
 * Respects ordering constraints defined in the work queue repository.
 */
export interface ClaimWorkItemBatchCommand extends Command {
  readonly type: 'ClaimWorkItemBatch';
  readonly repoId: string;
  readonly maxItems: number;
  /** Set of commit SHAs that have been processed by code-change agent */
  readonly processedCommits: Set<string>;
}

export function createClaimWorkItemBatchCommand(
  repoId: string,
  maxItems: number,
  processedCommits: Set<string>
): ClaimWorkItemBatchCommand {
  return {
    type: 'ClaimWorkItemBatch',
    repoId,
    maxItems,
    processedCommits,
  };
}

/**
 * Handler for ClaimWorkItemBatch command.
 * Returns the claimed work items, or empty array if no work is available.
 */
export async function handleClaimWorkItemBatch(
  command: ClaimWorkItemBatchCommand,
  repos: Repositories
): Promise<CommandResult<WorkItem[]>> {
  try {
    const workItems = await repos.workQueue.claimBatch(
      command.repoId,
      command.maxItems,
      command.processedCommits
    );
    return success(workItems);
  } catch (error) {
    return failure(`Failed to claim work item batch: ${error}`);
  }
}

// ============================================================================
// ClaimWorkItemOne Command
// ============================================================================

/**
 * Command to claim a single work item for execution.
 * Used by the continuous worker pool for one-at-a-time claiming.
 */
export interface ClaimWorkItemOneCommand extends Command {
  readonly type: 'ClaimWorkItemOne';
  readonly repoId: string;
  /** Set of commit SHAs that have been processed by code-change agent */
  readonly processedCommits: Set<string>;
}

export function createClaimWorkItemOneCommand(
  repoId: string,
  processedCommits: Set<string>
): ClaimWorkItemOneCommand {
  return {
    type: 'ClaimWorkItemOne',
    repoId,
    processedCommits,
  };
}

/**
 * Handler for ClaimWorkItemOne command.
 * Returns the claimed work item, or null if no eligible work is available.
 */
export async function handleClaimWorkItemOne(
  command: ClaimWorkItemOneCommand,
  repos: Repositories
): Promise<CommandResult<WorkItem | null>> {
  try {
    const workItem = await repos.workQueue.claimOne(
      command.repoId,
      command.processedCommits
    );
    return success(workItem);
  } catch (error) {
    return failure(`Failed to claim work item: ${error}`);
  }
}

// ============================================================================
// SaveWorkItems Command
// ============================================================================

/**
 * Command to save multiple work items to the queue.
 * Used when the orchestrator generates new work.
 */
export interface SaveWorkItemsCommand extends Command {
  readonly type: 'SaveWorkItems';
  readonly workItems: WorkItem[];
}

export function createSaveWorkItemsCommand(workItems: WorkItem[]): SaveWorkItemsCommand {
  return {
    type: 'SaveWorkItems',
    workItems,
  };
}

/**
 * Handler for SaveWorkItems command.
 * Returns the number of items saved.
 */
export async function handleSaveWorkItems(
  command: SaveWorkItemsCommand,
  repos: Repositories
): Promise<CommandResult<number>> {
  try {
    if (command.workItems.length === 0) {
      return success(0);
    }
    await repos.workQueue.saveMany(command.workItems);
    return success(command.workItems.length);
  } catch (error) {
    return failure(`Failed to save work items: ${error}`);
  }
}

// ============================================================================
// CompleteWorkItem Command
// ============================================================================

/**
 * Command to mark a work item as completed.
 */
export interface CompleteWorkItemCommand extends Command {
  readonly type: 'CompleteWorkItem';
  readonly workItemId: string;
  readonly agentRunId: string;
}

export function createCompleteWorkItemCommand(
  workItemId: string,
  agentRunId: string
): CompleteWorkItemCommand {
  return {
    type: 'CompleteWorkItem',
    workItemId,
    agentRunId,
  };
}

/**
 * Handler for CompleteWorkItem command.
 */
export async function handleCompleteWorkItem(
  command: CompleteWorkItemCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify work item exists
    const workItem = await repos.workQueue.findById(command.workItemId);
    if (!workItem) {
      return failure(`Work item not found: ${command.workItemId}`);
    }

    await repos.workQueue.complete(command.workItemId, command.agentRunId);
    return success();
  } catch (error) {
    return failure(`Failed to complete work item: ${error}`);
  }
}

// ============================================================================
// FailWorkItem Command
// ============================================================================

/**
 * Command to mark a work item as failed.
 */
export interface FailWorkItemCommand extends Command {
  readonly type: 'FailWorkItem';
  readonly workItemId: string;
}

export function createFailWorkItemCommand(workItemId: string): FailWorkItemCommand {
  return {
    type: 'FailWorkItem',
    workItemId,
  };
}

/**
 * Handler for FailWorkItem command.
 */
export async function handleFailWorkItem(
  command: FailWorkItemCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify work item exists
    const workItem = await repos.workQueue.findById(command.workItemId);
    if (!workItem) {
      return failure(`Work item not found: ${command.workItemId}`);
    }

    await repos.workQueue.fail(command.workItemId);
    return success();
  } catch (error) {
    return failure(`Failed to fail work item: ${error}`);
  }
}
