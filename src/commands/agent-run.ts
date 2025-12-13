/**
 * CQRS Commands for Agent Run operations.
 *
 * These commands handle all agent run state changes,
 * providing a clean boundary for tracking agent execution.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createAgentRun, type AgentRun, type AgentType, type AgentResult, type ToolMetrics } from '../domain/agent-run.js';

// ============================================================================
// CreateAgentRun Command
// ============================================================================

/**
 * Command to create a new agent run record.
 * Sets initial status to 'running'.
 */
export interface CreateAgentRunCommand extends Command {
  readonly type: 'CreateAgentRun';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly agentType: AgentType;
  readonly targetCommitId?: string | undefined;
  readonly targetPath?: string | undefined;
}

export function createCreateAgentRunCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  agentType: AgentType;
  targetCommitId?: string | undefined;
  targetPath?: string | undefined;
}): CreateAgentRunCommand {
  return {
    type: 'CreateAgentRun',
    ...params,
  };
}

/**
 * Handler for CreateAgentRun command.
 * Creates the run record with status 'running'.
 */
export async function handleCreateAgentRun(
  command: CreateAgentRunCommand,
  repos: Repositories
): Promise<CommandResult<AgentRun>> {
  try {
    const agentRun = createAgentRun({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      agentType: command.agentType,
      targetCommitId: command.targetCommitId,
      targetPath: command.targetPath,
    });

    // Set to running immediately (agent is about to execute)
    agentRun.status = 'running';

    await repos.agentRuns.save(agentRun);
    return success(agentRun);
  } catch (error) {
    return failure(`Failed to create agent run: ${error}`);
  }
}

// ============================================================================
// CompleteAgentRun Command
// ============================================================================

/**
 * Command to mark an agent run as completed with results.
 */
export interface CompleteAgentRunCommand extends Command {
  readonly type: 'CompleteAgentRun';
  readonly agentRunId: string;
  readonly result: AgentResult;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly toolMetrics?: ToolMetrics;
}

export function createCompleteAgentRunCommand(
  agentRunId: string,
  result: AgentResult,
  durationMs: number,
  costUsd: number,
  toolMetrics?: ToolMetrics
): CompleteAgentRunCommand {
  const command: CompleteAgentRunCommand = {
    type: 'CompleteAgentRun',
    agentRunId,
    result,
    durationMs,
    costUsd,
  };
  if (toolMetrics !== undefined) {
    return { ...command, toolMetrics };
  }
  return command;
}

/**
 * Handler for CompleteAgentRun command.
 */
export async function handleCompleteAgentRun(
  command: CompleteAgentRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify agent run exists
    const agentRun = await repos.agentRuns.findById(command.agentRunId);
    if (!agentRun) {
      return failure(`Agent run not found: ${command.agentRunId}`);
    }

    await repos.agentRuns.complete(
      command.agentRunId,
      command.result,
      command.durationMs,
      command.costUsd,
      command.toolMetrics
    );
    return success();
  } catch (error) {
    return failure(`Failed to complete agent run: ${error}`);
  }
}

// ============================================================================
// FailAgentRun Command
// ============================================================================

/**
 * Command to mark an agent run as failed with an error.
 */
export interface FailAgentRunCommand extends Command {
  readonly type: 'FailAgentRun';
  readonly agentRunId: string;
  readonly error: string;
  readonly durationMs: number;
}

export function createFailAgentRunCommand(
  agentRunId: string,
  error: string,
  durationMs: number
): FailAgentRunCommand {
  return {
    type: 'FailAgentRun',
    agentRunId,
    error,
    durationMs,
  };
}

/**
 * Handler for FailAgentRun command.
 */
export async function handleFailAgentRun(
  command: FailAgentRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify agent run exists
    const agentRun = await repos.agentRuns.findById(command.agentRunId);
    if (!agentRun) {
      return failure(`Agent run not found: ${command.agentRunId}`);
    }

    await repos.agentRuns.fail(
      command.agentRunId,
      command.error,
      command.durationMs
    );
    return success();
  } catch (error) {
    return failure(`Failed to fail agent run: ${error}`);
  }
}
