import { v4 as uuid } from 'uuid';
import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createWikiPage, type WikiPage, type WikiPageUpdate } from '../domain/wiki-page.js';
import {
  createWikiPageHistory,
  type WikiPageHistoryOperation,
  type WikiPageHistoryAgentType,
} from '../domain/wiki-page-history.js';

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

      const createParams: Parameters<typeof createWikiPage>[0] = {
        id: uuid(),
        wikiId,
        path: update.path,
        title: extractTitle(update.content),
        content: update.content,
      };
      if (update.sourceCommitId) {
        createParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        createParams.sourceAgentRunId = update.agentRunId;
      }
      const page = createWikiPage(createParams);

      await repos.wikiPages.save(page);

      // Record history for create
      await recordHistory(repos, {
        wikiId,
        pageId: page.id,
        pagePath: page.path,
        operation: 'create',
        contentBefore: null,
        contentAfter: page.content,
        agentRunId: update.agentRunId,
      });

      return success(page);
    }

    if (update.type === 'update') {
      if (!existing) {
        return failure(`Page not found at path: ${update.path}`);
      }

      // Capture content before update for history
      const contentBefore = existing.content;

      const updateParams: { content: string; confidence?: number; sourceCommitId?: string; sourceAgentRunId?: string } = {
        content: update.content,
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
      };
      if (update.sourceCommitId) {
        updateParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        updateParams.sourceAgentRunId = update.agentRunId;
      }
      await repos.wikiPages.updateContent(existing.id, updateParams);

      // Record history for update
      await recordHistory(repos, {
        wikiId,
        pageId: existing.id,
        pagePath: existing.path,
        operation: 'update',
        contentBefore,
        contentAfter: update.content,
        agentRunId: update.agentRunId,
      });

      const updated = await repos.wikiPages.findById(existing.id);
      return success(updated!);
    }

    if (update.type === 'merge') {
      if (!existing) {
        // If page doesn't exist, create it
        const createParams: Parameters<typeof createWikiPage>[0] = {
          id: uuid(),
          wikiId,
          path: update.path,
          title: extractTitle(update.content),
          content: update.content,
        };
        if (update.sourceCommitId) {
          createParams.sourceCommitId = update.sourceCommitId;
        }
        if (update.agentRunId) {
          createParams.sourceAgentRunId = update.agentRunId;
        }
        const page = createWikiPage(createParams);

        await repos.wikiPages.save(page);

        // Record history for create (merge on non-existent page)
        await recordHistory(repos, {
          wikiId,
          pageId: page.id,
          pagePath: page.path,
          operation: 'create',
          contentBefore: null,
          contentAfter: page.content,
          agentRunId: update.agentRunId,
        });

        return success(page);
      }

      // Capture content before merge for history
      const contentBefore = existing.content;

      // Merge content (append new content to existing)
      const mergedContent = mergeContent(existing.content, update.content);
      const mergeUpdateParams: { content: string; confidence?: number; sourceCommitId?: string; sourceAgentRunId?: string } = {
        content: mergedContent,
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
      };
      if (update.sourceCommitId) {
        mergeUpdateParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        mergeUpdateParams.sourceAgentRunId = update.agentRunId;
      }
      await repos.wikiPages.updateContent(existing.id, mergeUpdateParams);

      // Record history for update (merge on existing page)
      await recordHistory(repos, {
        wikiId,
        pageId: existing.id,
        pagePath: existing.path,
        operation: 'update',
        contentBefore,
        contentAfter: mergedContent,
        agentRunId: update.agentRunId,
      });

      const updated = await repos.wikiPages.findById(existing.id);
      return success(updated!);
    }

    if (update.type === 'delete') {
      if (!existing) {
        return failure(`Page not found at path: ${update.path}`);
      }

      // Update any pages that link to the deleted page
      if (update.redirectTo) {
        const allPages = await repos.wikiPages.findByWiki(wikiId);
        for (const page of allPages) {
          if (page.links.includes(update.path)) {
            // Update the page content to redirect links
            const updatedContent = page.content.replace(
              new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegExp(update.path)}(\\.md)?\\)`, 'g'),
              `[$1](${update.redirectTo}.md)`
            );
            if (updatedContent !== page.content) {
              await repos.wikiPages.updateContent(page.id, {
                content: updatedContent,
              });
            }
          }
        }
      }

      // Record history for delete (before actual deletion)
      await recordHistory(repos, {
        wikiId,
        pageId: existing.id,
        pagePath: existing.path,
        operation: 'delete',
        contentBefore: existing.content,
        contentAfter: null,
        agentRunId: update.agentRunId,
      });

      // Delete the page
      await repos.wikiPages.delete(existing.id);

      // Return the deleted page (for tracking what was removed)
      return success(existing);
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

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Record a wiki page mutation in the history.
 */
async function recordHistory(
  repos: Repositories,
  params: {
    wikiId: string;
    pageId: string;
    pagePath: string;
    operation: WikiPageHistoryOperation;
    contentBefore: string | null;
    contentAfter: string | null;
    agentRunId?: string;
    workItemId?: string;
    editRequestId?: string;
  }
): Promise<void> {
  // Infer agent type from context (could be enhanced with more metadata)
  const agentType: WikiPageHistoryAgentType = params.agentRunId
    ? 'wiki-editor' // Default to wiki-editor when we have an agent run
    : 'unknown';

  const history = createWikiPageHistory({
    id: uuid(),
    wikiId: params.wikiId,
    pageId: params.pageId,
    pagePath: params.pagePath,
    operation: params.operation,
    contentBefore: params.contentBefore,
    contentAfter: params.contentAfter,
    agentRunId: params.agentRunId,
    workItemId: params.workItemId,
    editRequestId: params.editRequestId,
    agentType,
  });

  await repos.wikiPageHistory.save(history);
}
