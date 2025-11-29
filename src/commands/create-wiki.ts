import { v4 as uuid } from 'uuid';
import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createWiki, createDefaultWiki, type Wiki, type WikiConfig } from '../domain/wiki.js';

/**
 * Command to create a new wiki for a repository.
 */
export interface CreateWikiCommand extends Command {
  readonly type: 'CreateWiki';
  readonly repoId: string;
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
  readonly branchFilter?: string;
  readonly pathFilters?: string[];
  readonly config?: Partial<WikiConfig>;
  /** If true, sets this as the active wiki */
  readonly setActive?: boolean;
}

export function createCreateWikiCommand(params: Omit<CreateWikiCommand, 'type'>): CreateWikiCommand {
  return {
    type: 'CreateWiki',
    ...params,
  };
}

/**
 * Handler for CreateWiki command.
 */
export async function handleCreateWiki(
  command: CreateWikiCommand,
  repos: Repositories
): Promise<CommandResult<Wiki>> {
  try {
    // Verify repo exists
    const repo = await repos.repos.findById(command.repoId);
    if (!repo) {
      return failure(`Repository not found: ${command.repoId}`);
    }

    // Check if wiki with same slug already exists
    const slug = command.slug ?? slugify(command.name);
    const existing = await repos.wikis.findBySlug(command.repoId, slug);
    if (existing) {
      return failure(`Wiki with slug '${slug}' already exists for this repository`);
    }

    // If setActive, deactivate other wikis first
    if (command.setActive !== false) {
      const activeWiki = await repos.wikis.findActive(command.repoId);
      if (activeWiki) {
        await repos.wikis.setActive(activeWiki.id); // This will be overwritten below
      }
    }

    const wiki = createWiki({
      id: uuid(),
      repoId: command.repoId,
      name: command.name,
      slug,
      ...(command.description ? { description: command.description } : {}),
      isActive: command.setActive !== false,
      ...(command.branchFilter ? { branchFilter: command.branchFilter } : {}),
      ...(command.pathFilters ? { pathFilters: command.pathFilters } : {}),
      ...(command.config ? { config: command.config } : {}),
    });

    await repos.wikis.save(wiki);

    // If setting as active, use the dedicated method to ensure only one is active
    if (command.setActive !== false) {
      await repos.wikis.setActive(wiki.id);
    }

    return success(wiki);
  } catch (error) {
    return failure(`Failed to create wiki: ${error}`);
  }
}

/**
 * Get or create the active wiki for a repository.
 * If no wiki exists, creates a default one.
 */
export async function getOrCreateActiveWiki(
  repoId: string,
  repos: Repositories
): Promise<Wiki> {
  // Try to find existing active wiki
  let wiki = await repos.wikis.findActive(repoId);

  if (!wiki) {
    // No active wiki - check if any wikis exist
    const wikis = await repos.wikis.findByRepo(repoId);

    if (wikis.length > 0) {
      // Activate the first one
      wiki = wikis[0]!;
      await repos.wikis.setActive(wiki.id);
    } else {
      // Create default wiki
      wiki = createDefaultWiki({
        id: uuid(),
        repoId,
      });
      await repos.wikis.save(wiki);
    }
  }

  return wiki;
}

/**
 * Convert a name to a URL-friendly slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
