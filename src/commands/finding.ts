/**
 * CQRS Commands for Finding operations.
 *
 * These commands handle all finding state changes,
 * providing a clean boundary for tracking detected issues.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Finding, FindingType, FindingMetadata } from '../domain/finding.js';
import { createFinding } from '../domain/finding.js';

// ============================================================================
// CreateFindings Command
// ============================================================================

/**
 * Input for creating a single finding.
 */
export interface CreateFindingInput {
  readonly id: string;
  readonly type: FindingType;
  readonly description: string;
  readonly affectedPaths: string[];
  readonly severity: 'low' | 'medium' | 'high';
  readonly metadata?: FindingMetadata;
}

/**
 * Command to create one or more findings.
 * Typically used by meta agents (Consistency, Quality, Structure).
 */
export interface CreateFindingsCommand extends Command {
  readonly type: 'CreateFindings';
  readonly wikiId: string;
  readonly repoId: string;
  readonly sourceAgentRunId: string;
  readonly findings: CreateFindingInput[];
  /** If true, skip findings that already exist (same type + affected paths) */
  readonly skipDuplicates?: boolean;
}

export function createCreateFindingsCommand(params: {
  wikiId: string;
  repoId: string;
  sourceAgentRunId: string;
  findings: CreateFindingInput[];
  skipDuplicates?: boolean;
}): CreateFindingsCommand {
  const cmd: CreateFindingsCommand = {
    type: 'CreateFindings',
    wikiId: params.wikiId,
    repoId: params.repoId,
    sourceAgentRunId: params.sourceAgentRunId,
    findings: params.findings,
  };

  if (params.skipDuplicates !== undefined) {
    return { ...cmd, skipDuplicates: params.skipDuplicates };
  }

  return cmd;
}

/**
 * Handler for CreateFindings command.
 * Creates finding records and optionally skips duplicates.
 */
export async function handleCreateFindings(
  command: CreateFindingsCommand,
  repos: Repositories
): Promise<CommandResult<Finding[]>> {
  try {
    const createdFindings: Finding[] = [];

    for (const input of command.findings) {
      // Check for duplicates if requested
      if (command.skipDuplicates) {
        const exists = await repos.findings.existsSimilar(
          command.wikiId,
          input.type,
          input.affectedPaths
        );
        if (exists) {
          continue; // Skip this finding
        }
      }

      const findingParams: Parameters<typeof createFinding>[0] = {
        id: input.id,
        wikiId: command.wikiId,
        repoId: command.repoId,
        sourceAgentRunId: command.sourceAgentRunId,
        type: input.type,
        description: input.description,
        affectedPaths: input.affectedPaths,
        severity: input.severity,
      };

      // Only add metadata if it exists (exactOptionalPropertyTypes)
      if (input.metadata) {
        findingParams.metadata = input.metadata;
      }

      const finding = createFinding(findingParams);

      createdFindings.push(finding);
    }

    if (createdFindings.length > 0) {
      await repos.findings.saveMany(createdFindings);
    }

    return success(createdFindings);
  } catch (error) {
    return failure(`Failed to create findings: ${error}`);
  }
}

// ============================================================================
// MarkFindingInProgress Command
// ============================================================================

/**
 * Command to mark a finding as being addressed.
 * Used when consolidation agent starts working on a finding.
 */
export interface MarkFindingInProgressCommand extends Command {
  readonly type: 'MarkFindingInProgress';
  readonly findingId: string;
  readonly agentRunId: string;
}

export function createMarkFindingInProgressCommand(
  findingId: string,
  agentRunId: string
): MarkFindingInProgressCommand {
  return {
    type: 'MarkFindingInProgress',
    findingId,
    agentRunId,
  };
}

/**
 * Handler for MarkFindingInProgress command.
 */
export async function handleMarkFindingInProgress(
  command: MarkFindingInProgressCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify finding exists
    const finding = await repos.findings.findById(command.findingId);
    if (!finding) {
      return failure(`Finding not found: ${command.findingId}`);
    }

    await repos.findings.markInProgress(command.findingId, command.agentRunId);
    return success();
  } catch (error) {
    return failure(`Failed to mark finding in progress: ${error}`);
  }
}

// ============================================================================
// MarkFindingAddressed Command
// ============================================================================

/**
 * Command to mark a finding as addressed.
 * Used when consolidation agent completes work on a finding.
 */
export interface MarkFindingAddressedCommand extends Command {
  readonly type: 'MarkFindingAddressed';
  readonly findingId: string;
  readonly agentRunId: string;
}

export function createMarkFindingAddressedCommand(
  findingId: string,
  agentRunId: string
): MarkFindingAddressedCommand {
  return {
    type: 'MarkFindingAddressed',
    findingId,
    agentRunId,
  };
}

/**
 * Handler for MarkFindingAddressed command.
 */
export async function handleMarkFindingAddressed(
  command: MarkFindingAddressedCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify finding exists
    const finding = await repos.findings.findById(command.findingId);
    if (!finding) {
      return failure(`Finding not found: ${command.findingId}`);
    }

    await repos.findings.markAddressed(command.findingId, command.agentRunId);
    return success();
  } catch (error) {
    return failure(`Failed to mark finding addressed: ${error}`);
  }
}

// ============================================================================
// MarkFindingDismissed Command
// ============================================================================

/**
 * Command to dismiss a finding.
 * Used when a finding is determined to be a false positive.
 */
export interface MarkFindingDismissedCommand extends Command {
  readonly type: 'MarkFindingDismissed';
  readonly findingId: string;
}

export function createMarkFindingDismissedCommand(
  findingId: string
): MarkFindingDismissedCommand {
  return {
    type: 'MarkFindingDismissed',
    findingId,
  };
}

/**
 * Handler for MarkFindingDismissed command.
 */
export async function handleMarkFindingDismissed(
  command: MarkFindingDismissedCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify finding exists
    const finding = await repos.findings.findById(command.findingId);
    if (!finding) {
      return failure(`Finding not found: ${command.findingId}`);
    }

    await repos.findings.markDismissed(command.findingId);
    return success();
  } catch (error) {
    return failure(`Failed to dismiss finding: ${error}`);
  }
}

// ============================================================================
// ResetFindingToOpen Command
// ============================================================================

/**
 * Command to reset a finding back to open status.
 * Used when processing fails and the finding should be retried.
 */
export interface ResetFindingToOpenCommand extends Command {
  readonly type: 'ResetFindingToOpen';
  readonly findingId: string;
}

export function createResetFindingToOpenCommand(
  findingId: string
): ResetFindingToOpenCommand {
  return {
    type: 'ResetFindingToOpen',
    findingId,
  };
}

/**
 * Handler for ResetFindingToOpen command.
 */
export async function handleResetFindingToOpen(
  command: ResetFindingToOpenCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify finding exists
    const finding = await repos.findings.findById(command.findingId);
    if (!finding) {
      return failure(`Finding not found: ${command.findingId}`);
    }

    // Reset the finding to open status
    await repos.findings.save({
      ...finding,
      status: 'open',
      addressedByAgentRunId: null,
    });
    return success();
  } catch (error) {
    return failure(`Failed to reset finding to open: ${error}`);
  }
}
