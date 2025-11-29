import { v4 as uuid } from 'uuid';
import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createWikiPage, type WikiPage, type WikiPageUpdate } from '../domain/wiki-page.js';

/**
 * Command to update a wiki page.
 * All wiki modifications flow through this command.
 */
export interface UpdateWikiPageCommand extends Command {
  readonly type: 'UpdateWikiPage';
  readonly update: WikiPageUpdate;
}

export function createUpdateWikiPageCommand(update: WikiPageUpdate): UpdateWikiPageCommand {
  return {
    type: 'UpdateWikiPage',
    update,
  };
}

/**
 * Handler for UpdateWikiPage command.
 */
export async function handleUpdateWikiPage(
  command: UpdateWikiPageCommand,
  repos: Repositories,
  wikiId: string
): Promise<CommandResult<WikiPage>> {
  const { update } = command;

  try {
    // Check if page exists
    const existing = await repos.wikiPages.findByPath(wikiId, update.path);

    if (update.type === 'create') {
      if (existing) {
        return failure(`Page already exists at path: ${update.path}`);
      }

      const page = createWikiPage({
        id: uuid(),
        wikiId,
        path: update.path,
        title: extractTitle(update.content),
        content: update.content,
        sourceCommitId: update.sourceCommitId,
      });

      await repos.wikiPages.save(page);
      return success(page);
    }

    if (update.type === 'update') {
      if (!existing) {
        return failure(`Page not found at path: ${update.path}`);
      }

      await repos.wikiPages.updateContent(existing.id, {
        content: update.content,
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
        sourceCommitId: update.sourceCommitId,
      });

      const updated = await repos.wikiPages.findById(existing.id);
      return success(updated!);
    }

    if (update.type === 'merge') {
      if (!existing) {
        // If page doesn't exist, create it
        const page = createWikiPage({
          id: uuid(),
          wikiId,
          path: update.path,
          title: extractTitle(update.content),
          content: update.content,
          sourceCommitId: update.sourceCommitId,
        });

        await repos.wikiPages.save(page);
        return success(page);
      }

      // Merge content (append new content to existing)
      const mergedContent = mergeContent(existing.content, update.content);
      await repos.wikiPages.updateContent(existing.id, {
        content: mergedContent,
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
        sourceCommitId: update.sourceCommitId,
      });

      const updated = await repos.wikiPages.findById(existing.id);
      return success(updated!);
    }

    return failure(`Unknown update type: ${update.type}`);
  } catch (error) {
    return failure(`Failed to update wiki page: ${error}`);
  }
}

/**
 * Extract title from markdown content.
 * Looks for first H1 heading.
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1]! : 'Untitled';
}

/**
 * Simple content merge - appends new sections.
 * A more sophisticated implementation would do semantic merging.
 */
function mergeContent(existing: string, incoming: string): string {
  // For now, just append with a separator
  return `${existing}\n\n---\n\n${incoming}`;
}
