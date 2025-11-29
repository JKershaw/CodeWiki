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
