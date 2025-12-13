/**
 * CQRS Commands for Iteration operations.
 *
 * These commands handle all iteration state changes within processing runs,
 * providing a clean boundary for tracking individual work item execution.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createIteration, type Iteration } from '../domain/iteration.js';
import type { AgentType } from '../domain/agent-run.js';

// ============================================================================
// StartIteration Command
// ============================================================================

/**
 * Command to start a new iteration within a processing run.
 */
export interface StartIterationCommand extends Command {
  readonly type: 'StartIteration';
  readonly id: string;
  readonly processingRunId: string;
  readonly iterationNumber: number;
}

export function createStartIterationCommand(params: {
  id: string;
  processingRunId: string;
  iterationNumber: number;
}): StartIterationCommand {
  return {
    type: 'StartIteration',
    ...params,
  };
}

/**
 * Handler for StartIteration command.
 */
export async function handleStartIteration(
  command: StartIterationCommand,
  repos: Repositories
): Promise<CommandResult<Iteration>> {
  try {
    const iteration = createIteration({
      id: command.id,
      processingRunId: command.processingRunId,
      iterationNumber: command.iterationNumber,
    });

    await repos.iterations.save(iteration);
    return success(iteration);
  } catch (error) {
    return failure(`Failed to start iteration: ${error}`);
  }
}

// ============================================================================
// UpdateIterationWorkItem Command
// ============================================================================

/**
 * Work item details for an iteration.
 */
export interface IterationWorkItemDetails {
  workItemId: string;
  agentType: AgentType;
}

/**
 * Command to update an iteration with work item details.
 */
export interface UpdateIterationWorkItemCommand extends Command {
  readonly type: 'UpdateIterationWorkItem';
  readonly iterationId: string;
  readonly workItem: IterationWorkItemDetails;
}

export function createUpdateIterationWorkItemCommand(
  iterationId: string,
  workItem: IterationWorkItemDetails
): UpdateIterationWorkItemCommand {
  return {
    type: 'UpdateIterationWorkItem',
    iterationId,
    workItem,
  };
}

/**
 * Handler for UpdateIterationWorkItem command.
 */
export async function handleUpdateIterationWorkItem(
  command: UpdateIterationWorkItemCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify iteration exists
    const iteration = await repos.iterations.findById(command.iterationId);
    if (!iteration) {
      return failure(`Iteration not found: ${command.iterationId}`);
    }

    await repos.iterations.updateWorkItem(command.iterationId, command.workItem);
    return success();
  } catch (error) {
    return failure(`Failed to update iteration work item: ${error}`);
  }
}

// ============================================================================
// CompleteIteration Command
// ============================================================================

/**
 * Completion results for an iteration.
 */
export interface IterationCompletionResult {
  agentRunId: string;
  durationMs: number;
  costUsd: number;
  pagesCreated: number;
  pagesUpdated: number;
  /** Optional snapshot of KPIs at iteration completion (for charting/tracking) */
  kpiSnapshot?: Record<string, unknown>;
}

/**
 * Command to mark an iteration as completed.
 */
export interface CompleteIterationCommand extends Command {
  readonly type: 'CompleteIteration';
  readonly iterationId: string;
  readonly result: IterationCompletionResult;
}

export function createCompleteIterationCommand(
  iterationId: string,
  result: IterationCompletionResult
): CompleteIterationCommand {
  return {
    type: 'CompleteIteration',
    iterationId,
    result,
  };
}

/**
 * Handler for CompleteIteration command.
 */
export async function handleCompleteIteration(
  command: CompleteIterationCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify iteration exists
    const iteration = await repos.iterations.findById(command.iterationId);
    if (!iteration) {
      return failure(`Iteration not found: ${command.iterationId}`);
    }

    await repos.iterations.complete(command.iterationId, command.result);
    return success();
  } catch (error) {
    return failure(`Failed to complete iteration: ${error}`);
  }
}

// ============================================================================
// FailIteration Command
// ============================================================================

/**
 * Command to mark an iteration as failed.
 */
export interface FailIterationCommand extends Command {
  readonly type: 'FailIteration';
  readonly iterationId: string;
  readonly error: string;
  readonly durationMs: number;
}

export function createFailIterationCommand(
  iterationId: string,
  error: string,
  durationMs: number
): FailIterationCommand {
  return {
    type: 'FailIteration',
    iterationId,
    error,
    durationMs,
  };
}

/**
 * Handler for FailIteration command.
 */
export async function handleFailIteration(
  command: FailIterationCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify iteration exists
    const iteration = await repos.iterations.findById(command.iterationId);
    if (!iteration) {
      return failure(`Iteration not found: ${command.iterationId}`);
    }

    await repos.iterations.fail(command.iterationId, command.error, command.durationMs);
    return success();
  } catch (error) {
    return failure(`Failed to fail iteration: ${error}`);
  }
}

// ============================================================================
// SkipIteration Command
// ============================================================================

/**
 * Command to mark an iteration as skipped.
 */
export interface SkipIterationCommand extends Command {
  readonly type: 'SkipIteration';
  readonly iterationId: string;
  readonly reason: string;
}

export function createSkipIterationCommand(
  iterationId: string,
  reason: string
): SkipIterationCommand {
  return {
    type: 'SkipIteration',
    iterationId,
    reason,
  };
}

/**
 * Handler for SkipIteration command.
 */
export async function handleSkipIteration(
  command: SkipIterationCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify iteration exists
    const iteration = await repos.iterations.findById(command.iterationId);
    if (!iteration) {
      return failure(`Iteration not found: ${command.iterationId}`);
    }

    await repos.iterations.skip(command.iterationId, command.reason);
    return success();
  } catch (error) {
    return failure(`Failed to skip iteration: ${error}`);
  }
}
