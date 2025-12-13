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
import { validateContent } from '../utils/content-validation.js';
import { findSimilarPage } from '../utils/similarity.js';
import { extractLinksFromContent } from '../utils/link-extraction.js';
import { extractFileReferencesFromContent } from '../utils/file-reference-extraction.js';

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

      // Validate content quality (check for template placeholders, minimum length)
      // Skip validation if explicitly disabled (for tests and programmatic updates)
      if (!update.skipValidation) {
        const validation = validateContent(update.content);
        if (!validation.isValid) {
          return failure(`Invalid content: ${validation.errors.join('; ')}`);
        }
      }

      // Check for pages with similar title, path, or content to prevent duplicates
      const newTitle = update.title ?? extractTitleWithFallback(update.content, update.path);
      const existingPages = await repos.wikiPages.findByWiki(wikiId);
      const similarMatch = findSimilarPage(newTitle, update.path, update.content, existingPages, 0.5);
      if (similarMatch) {
        return failure(
          `A similar page already exists at path: ${similarMatch.page.path} ` +
          `(${similarMatch.matchType} similarity: ${(similarMatch.similarity * 100).toFixed(0)}%). ` +
          `Consider updating the existing page instead.`
        );
      }

      const createParams: Parameters<typeof createWikiPage>[0] = {
        id: uuid(),
        wikiId,
        path: update.path,
        title: update.title ?? extractTitleWithFallback(update.content, update.path),
        content: update.content,
        filesReferenced: extractFileReferencesFromContent(update.content),
      };
      if (update.sourceCommitId) {
        createParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        createParams.sourceAgentRunId = update.agentRunId;
      }
      if (update.filesAccessed) {
        createParams.filesAccessed = update.filesAccessed;
      }
      if (update.targetPaths) {
        createParams.targetPaths = update.targetPaths;
      }
      const page = createWikiPage(createParams);

      // Apply confidenceDelta to the page's confidence (base is 0.5, cap at 1.0)
      page.confidence = Math.min(1, page.confidence + update.confidenceDelta);

      await repos.wikiPages.save(page);

      // Update links - use provided links or auto-extract from content
      const linksToUse = update.links ?? extractLinksFromContent(update.content);
      if (linksToUse.length > 0) {
        await repos.wikiPages.updateLinks(page.id, linksToUse);
        page.links = linksToUse;

        // Add backlinks to target pages
        await updateBacklinks(repos, wikiId, page.path, [], linksToUse);
      }

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

      const updateParams: {
        content: string;
        title?: string;
        confidence?: number;
        sourceCommitId?: string;
        sourceAgentRunId?: string;
        filesAccessed?: string[];
        filesReferenced?: string[];
        targetPaths?: string[];
      } = {
        content: update.content,
        title: update.title ?? extractTitleWithFallback(update.content, update.path),
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
        filesReferenced: extractFileReferencesFromContent(update.content),
      };
      if (update.sourceCommitId) {
        updateParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        updateParams.sourceAgentRunId = update.agentRunId;
      }
      if (update.filesAccessed) {
        updateParams.filesAccessed = update.filesAccessed;
      }
      if (update.targetPaths) {
        updateParams.targetPaths = update.targetPaths;
      }
      await repos.wikiPages.updateContent(existing.id, updateParams);

      // Update links - MERGE with existing links (same as merge operation)
      // This prevents agents that rewrite content from accidentally wiping links
      // Use provided links or auto-extract from content
      const oldLinks = existing.links || [];
      const incomingLinks = update.links ?? extractLinksFromContent(update.content);
      // Merge new links with existing ones (deduplicated)
      const mergedLinks = [...new Set([...oldLinks, ...incomingLinks])];
      await repos.wikiPages.updateLinks(existing.id, mergedLinks);

      // Update backlinks on target pages (only for newly added links)
      await updateBacklinks(repos, wikiId, existing.path, oldLinks, mergedLinks);

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
        // Validate content quality when creating via merge
        if (!update.skipValidation) {
          const validation = validateContent(update.content);
          if (!validation.isValid) {
            return failure(`Invalid content: ${validation.errors.join('; ')}`);
          }
        }

        // If page doesn't exist, create it - but first check for similar pages
        const newTitle = update.title ?? extractTitleWithFallback(update.content, update.path);
        const existingPages = await repos.wikiPages.findByWiki(wikiId);
        const similarMatch = findSimilarPage(newTitle, update.path, update.content, existingPages, 0.5);
        if (similarMatch) {
          return failure(
            `A similar page already exists at path: ${similarMatch.page.path} ` +
            `(${similarMatch.matchType} similarity: ${(similarMatch.similarity * 100).toFixed(0)}%). ` +
            `Consider updating the existing page instead.`
          );
        }

        const createParams: Parameters<typeof createWikiPage>[0] = {
          id: uuid(),
          wikiId,
          path: update.path,
          title: update.title ?? extractTitleWithFallback(update.content, update.path),
          content: update.content,
        };
        if (update.sourceCommitId) {
          createParams.sourceCommitId = update.sourceCommitId;
        }
        if (update.agentRunId) {
          createParams.sourceAgentRunId = update.agentRunId;
        }
        const page = createWikiPage(createParams);

        // Apply confidenceDelta to the page's confidence (base is 0.5, cap at 1.0)
        page.confidence = Math.min(1, page.confidence + update.confidenceDelta);

        await repos.wikiPages.save(page);

        // Update links - use provided links or auto-extract from content
        const linksToUse = update.links ?? extractLinksFromContent(update.content);
        if (linksToUse.length > 0) {
          await repos.wikiPages.updateLinks(page.id, linksToUse);
          page.links = linksToUse;

          // Add backlinks to target pages
          await updateBacklinks(repos, wikiId, page.path, [], linksToUse);
        }

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
      const mergeUpdateParams: { content: string; title?: string; confidence?: number; sourceCommitId?: string; sourceAgentRunId?: string } = {
        content: mergedContent,
        title: extractTitleWithFallback(mergedContent, update.path),
        confidence: Math.min(1, existing.confidence + update.confidenceDelta),
      };
      if (update.sourceCommitId) {
        mergeUpdateParams.sourceCommitId = update.sourceCommitId;
      }
      if (update.agentRunId) {
        mergeUpdateParams.sourceAgentRunId = update.agentRunId;
      }
      await repos.wikiPages.updateContent(existing.id, mergeUpdateParams);

      // Update links - MERGE with existing links for merge operations
      // Use provided links or auto-extract from merged content
      const oldLinks = existing.links || [];
      const incomingLinks = update.links ?? extractLinksFromContent(mergedContent);
      // Merge new links with existing ones (deduplicated)
      const mergedLinks = [...new Set([...oldLinks, ...incomingLinks])];
      await repos.wikiPages.updateLinks(existing.id, mergedLinks);

      // Update backlinks on target pages (only for newly added links)
      await updateBacklinks(repos, wikiId, existing.path, oldLinks, mergedLinks);

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
 * Looks for first H1 heading. Falls back to 'Untitled' if no H1 found.
 *
 * The regex is lenient - it allows zero or more spaces after # to handle
 * cases where LLMs generate `#Title` without a space (technically invalid
 * markdown, but common in practice).
 *
 * Uses negative lookahead (?!#) to ensure we only match H1, not H2 (##) or deeper.
 * Uses [ \t]* instead of \s* to match only horizontal whitespace (not newlines).
 */
export function extractTitle(content: string): string {
  // Match H1 with zero or more horizontal whitespace after # (more lenient than strict markdown)
  // (?!#) ensures we don't match ## (H2) or deeper headings
  // [ \t]* matches only spaces and tabs, not newlines (important for multiline content)
  const match = content.match(/^#(?!#)[ \t]*(.+)$/m);
  if (match) {
    // Trim the captured title in case of leading/trailing whitespace
    const title = match[1]!.trim();
    if (title.length > 0) {
      return title;
    }
  }
  return 'Untitled';
}

/**
 * Extract title from a page path.
 * Converts paths like "architecture/cqrs-pattern" to "Cqrs Pattern".
 * Used as a fallback when content has no H1 heading.
 */
export function extractTitleFromPath(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  if (!lastPart || lastPart.length === 0) {
    return 'Untitled';
  }
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract title from content with path-based fallback.
 * First tries to extract from H1 heading in content, then falls back to
 * deriving a title from the page path.
 */
export function extractTitleWithFallback(content: string, path: string): string {
  const contentTitle = extractTitle(content);
  if (contentTitle !== 'Untitled') {
    return contentTitle;
  }
  return extractTitleFromPath(path);
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

  // Get the next sequence number for deterministic ordering
  const sequenceNumber = await repos.wikiPageHistory.getNextSequenceNumber(params.wikiId);

  const history = createWikiPageHistory({
    id: uuid(),
    wikiId: params.wikiId,
    pageId: params.pageId,
    pagePath: params.pagePath,
    operation: params.operation,
    contentBefore: params.contentBefore,
    contentAfter: params.contentAfter,
    agentType,
    sequenceNumber,
    // Only include optional properties if defined (exactOptionalPropertyTypes)
    ...(params.agentRunId !== undefined && { agentRunId: params.agentRunId }),
    ...(params.workItemId !== undefined && { workItemId: params.workItemId }),
    ...(params.editRequestId !== undefined && { editRequestId: params.editRequestId }),
  });

  await repos.wikiPageHistory.save(history);
}

/**
 * Update backlinks on target pages when links change.
 * Adds backlinks for new links and removes backlinks for removed links.
 */
async function updateBacklinks(
  repos: Repositories,
  wikiId: string,
  sourcePath: string,
  oldLinks: string[],
  newLinks: string[]
): Promise<void> {
  // Find links that were added
  const addedLinks = newLinks.filter(link => !oldLinks.includes(link));
  // Find links that were removed
  const removedLinks = oldLinks.filter(link => !newLinks.includes(link));

  // Add backlinks to newly linked pages
  for (const targetPath of addedLinks) {
    const targetPage = await repos.wikiPages.findByPath(wikiId, targetPath);
    if (targetPage) {
      await repos.wikiPages.addBacklink(targetPage.id, sourcePath);
    }
  }

  // Remove backlinks from pages no longer linked
  for (const targetPath of removedLinks) {
    const targetPage = await repos.wikiPages.findByPath(wikiId, targetPath);
    if (targetPage) {
      await repos.wikiPages.removeBacklink(targetPage.id, sourcePath);
    }
  }
}
