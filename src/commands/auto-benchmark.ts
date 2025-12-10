/**
 * CQRS Commands for Auto-Benchmark operations.
 *
 * These commands handle all auto-benchmark run state changes.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import {
  createAutoBenchmarkRun,
  type AutoBenchmarkRun,
  type AutoBenchmarkConfig,
  type AutoBenchmarkPhase,
} from '../domain/auto-benchmark.js';

// ============================================================================
// StartAutoBenchmark Command
// ============================================================================

/**
 * Command to start a new auto-benchmark run.
 */
export interface StartAutoBenchmarkCommand extends Command {
  readonly type: 'StartAutoBenchmark';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly config: AutoBenchmarkConfig;
}

export function createStartAutoBenchmarkCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  config: AutoBenchmarkConfig;
}): StartAutoBenchmarkCommand {
  return {
    type: 'StartAutoBenchmark',
    ...params,
  };
}

/**
 * Handler for StartAutoBenchmark command.
 */
export async function handleStartAutoBenchmark(
  command: StartAutoBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<AutoBenchmarkRun>> {
  try {
    // Check if there's already a running auto-benchmark
    const running = await repos.autoBenchmarks.findRunning(command.repoId);
    if (running) {
      return failure(`An auto-benchmark is already running for this repository: ${running.id}`);
    }

    const autoBenchmarkRun = createAutoBenchmarkRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      config: command.config,
    });

    await repos.autoBenchmarks.save(autoBenchmarkRun);
    return success(autoBenchmarkRun);
  } catch (error) {
    return failure(`Failed to start auto-benchmark: ${error}`);
  }
}

// ============================================================================
// UpdateAutoBenchmarkProgress Command
// ============================================================================

/**
 * Command to update auto-benchmark progress.
 */
export interface UpdateAutoBenchmarkProgressCommand extends Command {
  readonly type: 'UpdateAutoBenchmarkProgress';
  readonly runId: string;
  readonly cycle: number;
  readonly phase: AutoBenchmarkPhase;
}

export function createUpdateAutoBenchmarkProgressCommand(
  runId: string,
  cycle: number,
  phase: AutoBenchmarkPhase
): UpdateAutoBenchmarkProgressCommand {
  return {
    type: 'UpdateAutoBenchmarkProgress',
    runId,
    cycle,
    phase,
  };
}

/**
 * Handler for UpdateAutoBenchmarkProgress command.
 */
export async function handleUpdateAutoBenchmarkProgress(
  command: UpdateAutoBenchmarkProgressCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify run exists
    const run = await repos.autoBenchmarks.findById(command.runId);
    if (!run) {
      return failure(`Auto-benchmark run not found: ${command.runId}`);
    }

    await repos.autoBenchmarks.updateProgress(command.runId, command.cycle, command.phase);
    return success();
  } catch (error) {
    return failure(`Failed to update auto-benchmark progress: ${error}`);
  }
}

// ============================================================================
// StopAutoBenchmark Command
// ============================================================================

/**
 * Command to stop an auto-benchmark run.
 */
export interface StopAutoBenchmarkCommand extends Command {
  readonly type: 'StopAutoBenchmark';
  readonly runId: string;
}

export function createStopAutoBenchmarkCommand(runId: string): StopAutoBenchmarkCommand {
  return {
    type: 'StopAutoBenchmark',
    runId,
  };
}

/**
 * Handler for StopAutoBenchmark command.
 */
export async function handleStopAutoBenchmark(
  command: StopAutoBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify run exists
    const run = await repos.autoBenchmarks.findById(command.runId);
    if (!run) {
      return failure(`Auto-benchmark run not found: ${command.runId}`);
    }

    await repos.autoBenchmarks.stop(command.runId);
    return success();
  } catch (error) {
    return failure(`Failed to stop auto-benchmark: ${error}`);
  }
}

// ============================================================================
// CompleteAutoBenchmark Command
// ============================================================================

/**
 * Command to mark an auto-benchmark run as completed.
 */
export interface CompleteAutoBenchmarkCommand extends Command {
  readonly type: 'CompleteAutoBenchmark';
  readonly runId: string;
}

export function createCompleteAutoBenchmarkCommand(runId: string): CompleteAutoBenchmarkCommand {
  return {
    type: 'CompleteAutoBenchmark',
    runId,
  };
}

/**
 * Handler for CompleteAutoBenchmark command.
 */
export async function handleCompleteAutoBenchmark(
  command: CompleteAutoBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify run exists
    const run = await repos.autoBenchmarks.findById(command.runId);
    if (!run) {
      return failure(`Auto-benchmark run not found: ${command.runId}`);
    }

    await repos.autoBenchmarks.complete(command.runId);
    return success();
  } catch (error) {
    return failure(`Failed to complete auto-benchmark: ${error}`);
  }
}

// ============================================================================
// FailAutoBenchmark Command
// ============================================================================

/**
 * Command to mark an auto-benchmark run as failed.
 */
export interface FailAutoBenchmarkCommand extends Command {
  readonly type: 'FailAutoBenchmark';
  readonly runId: string;
  readonly error: string;
}

export function createFailAutoBenchmarkCommand(
  runId: string,
  error: string
): FailAutoBenchmarkCommand {
  return {
    type: 'FailAutoBenchmark',
    runId,
    error,
  };
}

/**
 * Handler for FailAutoBenchmark command.
 */
export async function handleFailAutoBenchmark(
  command: FailAutoBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify run exists
    const run = await repos.autoBenchmarks.findById(command.runId);
    if (!run) {
      return failure(`Auto-benchmark run not found: ${command.runId}`);
    }

    await repos.autoBenchmarks.fail(command.runId, command.error);
    return success();
  } catch (error) {
    return failure(`Failed to fail auto-benchmark: ${error}`);
  }
}

// ============================================================================
// DeleteAutoBenchmark Command
// ============================================================================

/**
 * Command to delete an auto-benchmark run.
 */
export interface DeleteAutoBenchmarkCommand extends Command {
  readonly type: 'DeleteAutoBenchmark';
  readonly runId: string;
}

export function createDeleteAutoBenchmarkCommand(runId: string): DeleteAutoBenchmarkCommand {
  return {
    type: 'DeleteAutoBenchmark',
    runId,
  };
}

/**
 * Handler for DeleteAutoBenchmark command.
 *
 * Note: Running auto-benchmarks can be deleted to handle cleanup after server
 * restarts where runs get stuck in "running" status.
 */
export async function handleDeleteAutoBenchmark(
  command: DeleteAutoBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify run exists
    const run = await repos.autoBenchmarks.findById(command.runId);
    if (!run) {
      return failure(`Auto-benchmark run not found: ${command.runId}`);
    }

    await repos.autoBenchmarks.delete(command.runId);
    return success();
  } catch (error) {
    return failure(`Failed to delete auto-benchmark: ${error}`);
  }
}
