/**
 * CQRS Commands for Benchmark operations.
 *
 * These commands handle all benchmark run state changes.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import {
  createBenchmarkRun,
  calculateSummary,
  type BenchmarkRun,
  type BenchmarkResult,
  type BenchmarkQuestion,
} from '../domain/benchmark.js';

// ============================================================================
// StartBenchmark Command
// ============================================================================

/**
 * Command to start a new benchmark run.
 */
export interface StartBenchmarkCommand extends Command {
  readonly type: 'StartBenchmark';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly iterationCount: number;
  readonly pageCount: number;
}

export function createStartBenchmarkCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  iterationCount: number;
  pageCount: number;
}): StartBenchmarkCommand {
  return {
    type: 'StartBenchmark',
    ...params,
  };
}

/**
 * Handler for StartBenchmark command.
 */
export async function handleStartBenchmark(
  command: StartBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<BenchmarkRun>> {
  try {
    // Check if there's already a running benchmark
    const running = await repos.benchmarks.findRunning(command.repoId);
    if (running) {
      return failure(`A benchmark is already running for this repository: ${running.id}`);
    }

    const benchmarkRun = createBenchmarkRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      iterationCount: command.iterationCount,
      pageCount: command.pageCount,
    });

    await repos.benchmarks.save(benchmarkRun);
    return success(benchmarkRun);
  } catch (error) {
    return failure(`Failed to start benchmark: ${error}`);
  }
}

// ============================================================================
// CompleteBenchmark Command
// ============================================================================

/**
 * Command to mark a benchmark run as completed with results.
 */
export interface CompleteBenchmarkCommand extends Command {
  readonly type: 'CompleteBenchmark';
  readonly benchmarkId: string;
  readonly results: BenchmarkResult[];
  readonly questions: BenchmarkQuestion[];
  readonly totalCostUsd: number;
}

export function createCompleteBenchmarkCommand(params: {
  benchmarkId: string;
  results: BenchmarkResult[];
  questions: BenchmarkQuestion[];
  totalCostUsd: number;
}): CompleteBenchmarkCommand {
  return {
    type: 'CompleteBenchmark',
    ...params,
  };
}

/**
 * Handler for CompleteBenchmark command.
 */
export async function handleCompleteBenchmark(
  command: CompleteBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify benchmark run exists
    const run = await repos.benchmarks.findById(command.benchmarkId);
    if (!run) {
      return failure(`Benchmark run not found: ${command.benchmarkId}`);
    }

    // Calculate summary from results
    const summary = calculateSummary(command.results, command.questions);

    await repos.benchmarks.complete(
      command.benchmarkId,
      command.results,
      summary,
      command.totalCostUsd
    );

    return success();
  } catch (error) {
    return failure(`Failed to complete benchmark: ${error}`);
  }
}

// ============================================================================
// FailBenchmark Command
// ============================================================================

/**
 * Command to mark a benchmark run as failed.
 */
export interface FailBenchmarkCommand extends Command {
  readonly type: 'FailBenchmark';
  readonly benchmarkId: string;
  readonly error: string;
}

export function createFailBenchmarkCommand(
  benchmarkId: string,
  error: string
): FailBenchmarkCommand {
  return {
    type: 'FailBenchmark',
    benchmarkId,
    error,
  };
}

/**
 * Handler for FailBenchmark command.
 */
export async function handleFailBenchmark(
  command: FailBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify benchmark run exists
    const run = await repos.benchmarks.findById(command.benchmarkId);
    if (!run) {
      return failure(`Benchmark run not found: ${command.benchmarkId}`);
    }

    await repos.benchmarks.fail(command.benchmarkId, command.error);
    return success();
  } catch (error) {
    return failure(`Failed to fail benchmark: ${error}`);
  }
}

// ============================================================================
// DeleteBenchmark Command
// ============================================================================

/**
 * Command to delete a specific benchmark run.
 */
export interface DeleteBenchmarkCommand extends Command {
  readonly type: 'DeleteBenchmark';
  readonly benchmarkId: string;
}

export function createDeleteBenchmarkCommand(
  benchmarkId: string
): DeleteBenchmarkCommand {
  return {
    type: 'DeleteBenchmark',
    benchmarkId,
  };
}

/**
 * Handler for DeleteBenchmark command.
 *
 * Note: Running benchmarks can be deleted to handle cleanup after server
 * restarts where benchmarks get stuck in "running" status.
 */
export async function handleDeleteBenchmark(
  command: DeleteBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify benchmark run exists
    const run = await repos.benchmarks.findById(command.benchmarkId);
    if (!run) {
      return failure(`Benchmark run not found: ${command.benchmarkId}`);
    }

    // Running benchmarks can be deleted for cleanup after server restarts
    await repos.benchmarks.delete(command.benchmarkId);
    return success();
  } catch (error) {
    return failure(`Failed to delete benchmark: ${error}`);
  }
}
