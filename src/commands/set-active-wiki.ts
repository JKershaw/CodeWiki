import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Wiki } from '../domain/wiki.js';

/**
 * Command to set a wiki as the active wiki for its repository.
 * Only one wiki can be active per repository at a time.
 */
export interface SetActiveWikiCommand extends Command {
  readonly type: 'SetActiveWiki';
  readonly wikiId: string;
}

export function createSetActiveWikiCommand(wikiId: string): SetActiveWikiCommand {
  return {
    type: 'SetActiveWiki',
    wikiId,
  };
}

/**
 * Handler for SetActiveWiki command.
 */
export async function handleSetActiveWiki(
  command: SetActiveWikiCommand,
  repos: Repositories
): Promise<CommandResult<Wiki>> {
  try {
    const wiki = await repos.wikis.findById(command.wikiId);
    if (!wiki) {
      return failure(`Wiki not found: ${command.wikiId}`);
    }

    if (wiki.status === 'archived') {
      return failure('Cannot activate an archived wiki');
    }

    await repos.wikis.setActive(command.wikiId);

    // Return the updated wiki
    const updated = await repos.wikis.findById(command.wikiId);
    return success(updated!);
  } catch (error) {
    return failure(`Failed to set active wiki: ${error}`);
  }
}
