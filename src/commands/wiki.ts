/**
 * CQRS Commands for Wiki operations.
 *
 * These commands handle wiki configuration and lifecycle,
 * providing a clean boundary for wiki management.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { WikiConfig } from '../domain/wiki.js';

// ============================================================================
// UpdateWikiSettings Command
// ============================================================================

/**
 * Partial settings that can be updated on a wiki.
 */
export interface WikiSettingsUpdate {
  name?: string;
  description?: string;
  branchFilter?: string;
  pathFilters?: string[];
  config?: Partial<WikiConfig>;
}

/**
 * Command to update wiki settings.
 */
export interface UpdateWikiSettingsCommand extends Command {
  readonly type: 'UpdateWikiSettings';
  readonly wikiId: string;
  readonly settings: WikiSettingsUpdate;
}

export function createUpdateWikiSettingsCommand(
  wikiId: string,
  settings: WikiSettingsUpdate
): UpdateWikiSettingsCommand {
  return {
    type: 'UpdateWikiSettings',
    wikiId,
    settings,
  };
}

/**
 * Handler for UpdateWikiSettings command.
 * Updates the specified settings on a wiki.
 */
export async function handleUpdateWikiSettings(
  command: UpdateWikiSettingsCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Find the wiki
    const wiki = await repos.wikis.findById(command.wikiId);
    if (!wiki) {
      return failure(`Wiki not found: ${command.wikiId}`);
    }

    // Apply updates
    const { settings } = command;

    if (settings.name !== undefined) {
      wiki.name = settings.name;
    }
    if (settings.description !== undefined) {
      wiki.description = settings.description;
    }
    if (settings.branchFilter !== undefined) {
      wiki.branchFilter = settings.branchFilter;
    }
    if (settings.pathFilters !== undefined) {
      wiki.pathFilters = settings.pathFilters;
    }
    if (settings.config !== undefined) {
      wiki.config = {
        ...wiki.config,
        ...settings.config,
      };
    }

    wiki.updatedAt = new Date();

    await repos.wikis.save(wiki);
    return success();
  } catch (error) {
    return failure(`Failed to update wiki settings: ${error}`);
  }
}

// ============================================================================
// DeleteWiki Command
// ============================================================================

/**
 * Command to delete a wiki.
 */
export interface DeleteWikiCommand extends Command {
  readonly type: 'DeleteWiki';
  readonly wikiId: string;
}

export function createDeleteWikiCommand(wikiId: string): DeleteWikiCommand {
  return {
    type: 'DeleteWiki',
    wikiId,
  };
}

/**
 * Handler for DeleteWiki command.
 * Deletes a wiki and all its pages.
 * Fails if the wiki is currently active.
 */
export async function handleDeleteWiki(
  command: DeleteWikiCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Find the wiki
    const wiki = await repos.wikis.findById(command.wikiId);
    if (!wiki) {
      return failure(`Wiki not found: ${command.wikiId}`);
    }

    // Cannot delete active wiki
    if (wiki.isActive) {
      return failure('Cannot delete active wiki. Deactivate it first.');
    }

    // Delete all wiki pages first
    await repos.wikiPages.deleteByWiki(command.wikiId);

    // Delete the wiki
    await repos.wikis.delete(command.wikiId);

    return success();
  } catch (error) {
    return failure(`Failed to delete wiki: ${error}`);
  }
}

// ============================================================================
// IncrementWikiIterations Command
// ============================================================================

/**
 * Command to increment the total iterations count for a wiki.
 * Called when a processing run completes successfully.
 */
export interface IncrementWikiIterationsCommand extends Command {
  readonly type: 'IncrementWikiIterations';
  readonly wikiId: string;
  readonly count: number;
}

export function createIncrementWikiIterationsCommand(
  wikiId: string,
  count: number
): IncrementWikiIterationsCommand {
  return {
    type: 'IncrementWikiIterations',
    wikiId,
    count,
  };
}

/**
 * Handler for IncrementWikiIterations command.
 * Increments the cumulative iteration count for a wiki.
 */
export async function handleIncrementWikiIterations(
  command: IncrementWikiIterationsCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    const wiki = await repos.wikis.findById(command.wikiId);
    if (!wiki) {
      return failure(`Wiki not found: ${command.wikiId}`);
    }

    await repos.wikis.incrementIterations(command.wikiId, command.count);
    return success();
  } catch (error) {
    return failure(`Failed to increment wiki iterations: ${error}`);
  }
}
