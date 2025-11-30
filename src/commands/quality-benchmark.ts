/**
 * CQRS Commands for Quality Benchmark operations.
 *
 * These commands handle all quality benchmark run state changes.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import {
  createQualityBenchmarkRun,
  calculateQualitySummary,
  type QualityBenchmarkRun,
  type PageQualityResult,
} from '../domain/quality-benchmark.js';

// ============================================================================
// StartQualityBenchmark Command
// ============================================================================

/**
 * Command to start a new quality benchmark run.
 */
export interface StartQualityBenchmarkCommand extends Command {
  readonly type: 'StartQualityBenchmark';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly iterationCount: number;
  readonly pageCount: number;
}

export function createStartQualityBenchmarkCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  iterationCount: number;
  pageCount: number;
}): StartQualityBenchmarkCommand {
  return {
    type: 'StartQualityBenchmark',
    ...params,
  };
}

/**
 * Handler for StartQualityBenchmark command.
 */
export async function handleStartQualityBenchmark(
  command: StartQualityBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<QualityBenchmarkRun>> {
  try {
    // Check if there's already a running quality benchmark
    const running = await repos.qualityBenchmarks.findRunning(command.repoId);
    if (running) {
      return failure(`A quality benchmark is already running for this repository: ${running.id}`);
    }

    const benchmarkRun = createQualityBenchmarkRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      iterationCount: command.iterationCount,
      pageCount: command.pageCount,
    });

    await repos.qualityBenchmarks.save(benchmarkRun);
    return success(benchmarkRun);
  } catch (error) {
    return failure(`Failed to start quality benchmark: ${error}`);
  }
}

// ============================================================================
// CompleteQualityBenchmark Command
// ============================================================================

/**
 * Command to mark a quality benchmark run as completed with results.
 */
export interface CompleteQualityBenchmarkCommand extends Command {
  readonly type: 'CompleteQualityBenchmark';
  readonly benchmarkId: string;
  readonly results: PageQualityResult[];
  readonly totalCostUsd: number;
}

export function createCompleteQualityBenchmarkCommand(params: {
  benchmarkId: string;
  results: PageQualityResult[];
  totalCostUsd: number;
}): CompleteQualityBenchmarkCommand {
  return {
    type: 'CompleteQualityBenchmark',
    ...params,
  };
}

/**
 * Handler for CompleteQualityBenchmark command.
 */
export async function handleCompleteQualityBenchmark(
  command: CompleteQualityBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify benchmark run exists
    const run = await repos.qualityBenchmarks.findById(command.benchmarkId);
    if (!run) {
      return failure(`Quality benchmark run not found: ${command.benchmarkId}`);
    }

    // Calculate summary from results
    const summary = calculateQualitySummary(command.results);

    await repos.qualityBenchmarks.complete(
      command.benchmarkId,
      command.results,
      summary,
      command.totalCostUsd
    );

    return success();
  } catch (error) {
    return failure(`Failed to complete quality benchmark: ${error}`);
  }
}

// ============================================================================
// FailQualityBenchmark Command
// ============================================================================

/**
 * Command to mark a quality benchmark run as failed.
 */
export interface FailQualityBenchmarkCommand extends Command {
  readonly type: 'FailQualityBenchmark';
  readonly benchmarkId: string;
  readonly error: string;
}

export function createFailQualityBenchmarkCommand(
  benchmarkId: string,
  error: string
): FailQualityBenchmarkCommand {
  return {
    type: 'FailQualityBenchmark',
    benchmarkId,
    error,
  };
}

/**
 * Handler for FailQualityBenchmark command.
 */
export async function handleFailQualityBenchmark(
  command: FailQualityBenchmarkCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify benchmark run exists
    const run = await repos.qualityBenchmarks.findById(command.benchmarkId);
    if (!run) {
      return failure(`Quality benchmark run not found: ${command.benchmarkId}`);
    }

    await repos.qualityBenchmarks.fail(command.benchmarkId, command.error);
    return success();
  } catch (error) {
    return failure(`Failed to fail quality benchmark: ${error}`);
  }
}
