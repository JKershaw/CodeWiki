/**
 * CQRS Commands for Self-Improvement Analysis operations.
 *
 * These commands handle all self-improvement analysis run state changes.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import {
  createSelfImprovementRun,
  completeSelfImprovementRun,
  failSelfImprovementRun,
  type SelfImprovementRun,
} from '../domain/self-improvement.js';

// ============================================================================
// StartSelfImprovement Command
// ============================================================================

/**
 * Command to start a new self-improvement analysis run.
 */
export interface StartSelfImprovementCommand extends Command {
  readonly type: 'StartSelfImprovement';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly benchmarkRunIds: string[];
  readonly iterationRange: [number, number];
}

export function createStartSelfImprovementCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  benchmarkRunIds: string[];
  iterationRange: [number, number];
}): StartSelfImprovementCommand {
  return {
    type: 'StartSelfImprovement',
    ...params,
  };
}

/**
 * Handler for StartSelfImprovement command.
 */
export async function handleStartSelfImprovement(
  command: StartSelfImprovementCommand,
  repos: Repositories
): Promise<CommandResult<SelfImprovementRun>> {
  try {
    // Check if there's already a running analysis
    const running = await repos.selfImprovements.findRunning(command.repoId);
    if (running) {
      return failure(`A self-improvement analysis is already running for this repository: ${running.id}`);
    }

    const run = createSelfImprovementRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      benchmarkRunIds: command.benchmarkRunIds,
      iterationRange: command.iterationRange,
    });

    await repos.selfImprovements.save(run);
    return success(run);
  } catch (error) {
    return failure(`Failed to start self-improvement analysis: ${error}`);
  }
}

// ============================================================================
// CompleteSelfImprovement Command
// ============================================================================

/**
 * Command to mark a self-improvement analysis as completed.
 */
export interface CompleteSelfImprovementCommand extends Command {
  readonly type: 'CompleteSelfImprovement';
  readonly runId: string;
  readonly report: string;
  readonly costUsd: number;
}

export function createCompleteSelfImprovementCommand(params: {
  runId: string;
  report: string;
  costUsd: number;
}): CompleteSelfImprovementCommand {
  return {
    type: 'CompleteSelfImprovement',
    ...params,
  };
}

/**
 * Handler for CompleteSelfImprovement command.
 */
export async function handleCompleteSelfImprovement(
  command: CompleteSelfImprovementCommand,
  repos: Repositories
): Promise<CommandResult<SelfImprovementRun>> {
  try {
    const run = await repos.selfImprovements.findById(command.runId);
    if (!run) {
      return failure(`Self-improvement run not found: ${command.runId}`);
    }

    const completedRun = completeSelfImprovementRun(run, command.report, command.costUsd);
    await repos.selfImprovements.complete(command.runId, command.report, command.costUsd);

    return success(completedRun);
  } catch (error) {
    return failure(`Failed to complete self-improvement analysis: ${error}`);
  }
}

// ============================================================================
// FailSelfImprovement Command
// ============================================================================

/**
 * Command to mark a self-improvement analysis as failed.
 */
export interface FailSelfImprovementCommand extends Command {
  readonly type: 'FailSelfImprovement';
  readonly runId: string;
  readonly error: string;
}

export function createFailSelfImprovementCommand(
  runId: string,
  error: string
): FailSelfImprovementCommand {
  return {
    type: 'FailSelfImprovement',
    runId,
    error,
  };
}

/**
 * Handler for FailSelfImprovement command.
 */
export async function handleFailSelfImprovement(
  command: FailSelfImprovementCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    const run = await repos.selfImprovements.findById(command.runId);
    if (!run) {
      return failure(`Self-improvement run not found: ${command.runId}`);
    }

    await repos.selfImprovements.fail(command.runId, command.error);
    return success(undefined);
  } catch (error) {
    return failure(`Failed to mark self-improvement as failed: ${error}`);
  }
}
