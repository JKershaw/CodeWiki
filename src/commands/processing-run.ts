/**
 * CQRS Commands for Processing Run operations.
 *
 * These commands handle all processing run state changes,
 * providing a clean boundary for tracking batch execution sessions.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createProcessingRun, type ProcessingRun } from '../domain/processing-run.js';
import {
  handleIncrementWikiIterations,
  createIncrementWikiIterationsCommand,
} from './wiki.js';

// ============================================================================
// StartProcessingRun Command
// ============================================================================

/**
 * Command to start a new processing run.
 */
export interface StartProcessingRunCommand extends Command {
  readonly type: 'StartProcessingRun';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly totalIterations: number;
}

export function createStartProcessingRunCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  totalIterations: number;
}): StartProcessingRunCommand {
  return {
    type: 'StartProcessingRun',
    ...params,
  };
}

/**
 * Handler for StartProcessingRun command.
 */
export async function handleStartProcessingRun(
  command: StartProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<ProcessingRun>> {
  try {
    const processingRun = createProcessingRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      totalIterations: command.totalIterations,
    });

    await repos.processingRuns.save(processingRun);
    return success(processingRun);
  } catch (error) {
    return failure(`Failed to start processing run: ${error}`);
  }
}

// ============================================================================
// UpdateProcessingProgress Command
// ============================================================================

/**
 * Progress update data for a processing run.
 */
export interface ProcessingProgress {
  completedIterations: number;
  successfulIterations: number;
  failedIterations: number;
  totalCostUsd: number;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  /** Cumulative count of work items filtered as duplicates */
  duplicatesFiltered?: number;
}

/**
 * Command to update processing run progress.
 */
export interface UpdateProcessingProgressCommand extends Command {
  readonly type: 'UpdateProcessingProgress';
  readonly processingRunId: string;
  readonly progress: ProcessingProgress;
}

export function createUpdateProcessingProgressCommand(
  processingRunId: string,
  progress: ProcessingProgress
): UpdateProcessingProgressCommand {
  return {
    type: 'UpdateProcessingProgress',
    processingRunId,
    progress,
  };
}

/**
 * Handler for UpdateProcessingProgress command.
 */
export async function handleUpdateProcessingProgress(
  command: UpdateProcessingProgressCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    await repos.processingRuns.updateProgress(command.processingRunId, command.progress);
    return success();
  } catch (error) {
    return failure(`Failed to update processing progress: ${error}`);
  }
}

// ============================================================================
// CompleteProcessingRun Command
// ============================================================================

/**
 * Command to mark a processing run as completed.
 */
export interface CompleteProcessingRunCommand extends Command {
  readonly type: 'CompleteProcessingRun';
  readonly processingRunId: string;
}

export function createCompleteProcessingRunCommand(processingRunId: string): CompleteProcessingRunCommand {
  return {
    type: 'CompleteProcessingRun',
    processingRunId,
  };
}

/**
 * Handler for CompleteProcessingRun command.
 * Also increments the wiki's cumulative iteration count.
 */
export async function handleCompleteProcessingRun(
  command: CompleteProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    await repos.processingRuns.complete(command.processingRunId);

    // Increment wiki's cumulative iteration count
    if (run.completedIterations > 0) {
      await handleIncrementWikiIterations(
        createIncrementWikiIterationsCommand(run.wikiId, run.completedIterations),
        repos
      );
    }

    return success();
  } catch (error) {
    return failure(`Failed to complete processing run: ${error}`);
  }
}

// ============================================================================
// FailProcessingRun Command
// ============================================================================

/**
 * Command to mark a processing run as failed.
 */
export interface FailProcessingRunCommand extends Command {
  readonly type: 'FailProcessingRun';
  readonly processingRunId: string;
  readonly error: string;
}

export function createFailProcessingRunCommand(
  processingRunId: string,
  error: string
): FailProcessingRunCommand {
  return {
    type: 'FailProcessingRun',
    processingRunId,
    error,
  };
}

/**
 * Handler for FailProcessingRun command.
 */
export async function handleFailProcessingRun(
  command: FailProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    await repos.processingRuns.fail(command.processingRunId, command.error);
    return success();
  } catch (error) {
    return failure(`Failed to fail processing run: ${error}`);
  }
}

// ============================================================================
// StopProcessingRun Command
// ============================================================================

/**
 * Command to mark a processing run as manually stopped.
 */
export interface StopProcessingRunCommand extends Command {
  readonly type: 'StopProcessingRun';
  readonly processingRunId: string;
}

export function createStopProcessingRunCommand(processingRunId: string): StopProcessingRunCommand {
  return {
    type: 'StopProcessingRun',
    processingRunId,
  };
}

/**
 * Handler for StopProcessingRun command.
 */
export async function handleStopProcessingRun(
  command: StopProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    await repos.processingRuns.stop(command.processingRunId);
    return success();
  } catch (error) {
    return failure(`Failed to stop processing run: ${error}`);
  }
}

// ============================================================================
// RequestStopProcessingRun Command
// ============================================================================

/**
 * Command to request a graceful stop of a processing run.
 * Sets status to 'stopping' and resets totalIterations to completedIterations.
 * The executor will finish current work and then confirm the stop.
 */
export interface RequestStopProcessingRunCommand extends Command {
  readonly type: 'RequestStopProcessingRun';
  readonly processingRunId: string;
}

export function createRequestStopProcessingRunCommand(processingRunId: string): RequestStopProcessingRunCommand {
  return {
    type: 'RequestStopProcessingRun',
    processingRunId,
  };
}

/**
 * Handler for RequestStopProcessingRun command.
 */
export async function handleRequestStopProcessingRun(
  command: RequestStopProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists and is running
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    if (run.status !== 'running') {
      return failure(`Processing run is not running (status: ${run.status})`);
    }

    await repos.processingRuns.requestStop(command.processingRunId);
    return success();
  } catch (error) {
    return failure(`Failed to request stop for processing run: ${error}`);
  }
}

// ============================================================================
// ConfirmStopProcessingRun Command
// ============================================================================

/**
 * Command to confirm a processing run has stopped.
 * Called by the executor after finishing current work when status is 'stopping'.
 */
export interface ConfirmStopProcessingRunCommand extends Command {
  readonly type: 'ConfirmStopProcessingRun';
  readonly processingRunId: string;
}

export function createConfirmStopProcessingRunCommand(processingRunId: string): ConfirmStopProcessingRunCommand {
  return {
    type: 'ConfirmStopProcessingRun',
    processingRunId,
  };
}

/**
 * Handler for ConfirmStopProcessingRun command.
 * Also increments the wiki's cumulative iteration count for completed iterations.
 */
export async function handleConfirmStopProcessingRun(
  command: ConfirmStopProcessingRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify processing run exists and is stopping
    const run = await repos.processingRuns.findById(command.processingRunId);
    if (!run) {
      return failure(`Processing run not found: ${command.processingRunId}`);
    }

    if (run.status !== 'stopping') {
      return failure(`Processing run is not stopping (status: ${run.status})`);
    }

    await repos.processingRuns.confirmStop(command.processingRunId);

    // Increment wiki's cumulative iteration count for completed iterations
    if (run.completedIterations > 0) {
      await handleIncrementWikiIterations(
        createIncrementWikiIterationsCommand(run.wikiId, run.completedIterations),
        repos
      );
    }

    return success();
  } catch (error) {
    return failure(`Failed to confirm stop for processing run: ${error}`);
  }
}
