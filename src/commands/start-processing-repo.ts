import { v4 as uuid } from 'uuid';
import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createRepo, type Repo } from '../domain/repo.js';

/**
 * Command to start processing a repository.
 */
export interface StartProcessingRepoCommand extends Command {
  readonly type: 'StartProcessingRepo';
  /** GitHub full name (owner/repo) */
  readonly fullName: string;
  /** Clone URL */
  readonly cloneUrl: string;
  /** Default branch */
  readonly defaultBranch: string;
}

export function createStartProcessingRepoCommand(params: {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}): StartProcessingRepoCommand {
  return {
    type: 'StartProcessingRepo',
    fullName: params.fullName,
    cloneUrl: params.cloneUrl,
    defaultBranch: params.defaultBranch,
  };
}

/**
 * Handler for StartProcessingRepo command.
 */
export async function handleStartProcessingRepo(
  command: StartProcessingRepoCommand,
  repos: Repositories
): Promise<CommandResult<Repo>> {
  // Check if repo already exists
  const existing = await repos.repos.findByFullName(command.fullName);
  if (existing) {
    // If already processing, just return it
    if (existing.status === 'processing') {
      return success(existing);
    }
    // If paused or error, resume processing
    await repos.repos.updateStatus(existing.id, 'processing');
    const updated = await repos.repos.findById(existing.id);
    return success(updated!);
  }

  // Create new repo
  const repo = createRepo({
    id: uuid(),
    fullName: command.fullName,
    cloneUrl: command.cloneUrl,
    defaultBranch: command.defaultBranch,
  });
  repo.status = 'processing';

  try {
    await repos.repos.save(repo);
    return success(repo);
  } catch (error) {
    return failure(`Failed to save repo: ${error}`);
  }
}
