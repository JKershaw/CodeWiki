/**
 * CQRS Commands for Orchestrator Run operations.
 *
 * These commands handle orchestrator decision tracking,
 * providing visibility into LLM-based work prioritization.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { OrchestratorRun } from '../domain/orchestrator-run.js';

// ============================================================================
// SaveOrchestratorRun Command
// ============================================================================

/**
 * Command to save an orchestrator run record.
 * Used to track LLM-based decision making for debugging and analysis.
 */
export interface SaveOrchestratorRunCommand extends Command {
  readonly type: 'SaveOrchestratorRun';
  readonly run: OrchestratorRun;
}

export function createSaveOrchestratorRunCommand(run: OrchestratorRun): SaveOrchestratorRunCommand {
  return {
    type: 'SaveOrchestratorRun',
    run,
  };
}

/**
 * Handler for SaveOrchestratorRun command.
 * Persists an orchestrator decision record for tracking.
 */
export async function handleSaveOrchestratorRun(
  command: SaveOrchestratorRunCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    await repos.orchestratorRuns.save(command.run);
    return success();
  } catch (error) {
    return failure(`Failed to save orchestrator run: ${error}`);
  }
}
