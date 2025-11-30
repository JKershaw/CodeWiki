import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType } from '../../../domain/finding.js';
import type { WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../../queries/index.js';

/**
 * Handler for broken link findings.
 * Fixes or removes broken links by finding similar valid paths or removing the link.
 */
export class BrokenLinkHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['broken_link'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const pages = await HandlerUtils.loadPages(group.affectedPaths, context);
    // Get all wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const allPages = pagesResult.data || [];
    const validPaths = new Set(allPages.map(p => p.path));

    const updates: WikiPageUpdate[] = [];
    const fixedLinks: string[] = [];

    for (const page of pages) {
      let updatedContent = page.content;
      let modified = false;

      for (const finding of group.findings) {
        const brokenPath = finding.metadata?.brokenLinkPath;
        if (!brokenPath) continue;

        // Try to find a similar valid path
        const suggestion = this.findSimilarPath(brokenPath, validPaths);

        if (suggestion) {
          // Replace the broken link with the suggested one
          const linkRegex = new RegExp(
            `\\[([^\\]]+)\\]\\(${HandlerUtils.escapeRegExp(brokenPath)}(\\.md)?\\)`,
            'g'
          );
          const newContent = updatedContent.replace(linkRegex, `[$1](${suggestion}.md)`);
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            modified = true;
            fixedLinks.push(`${brokenPath} → ${suggestion}`);
          }
        } else {
          // Remove the link, keep the text
          const linkRegex = new RegExp(
            `\\[([^\\]]+)\\]\\(${HandlerUtils.escapeRegExp(brokenPath)}(\\.md)?\\)`,
            'g'
          );
          const newContent = updatedContent.replace(linkRegex, '$1');
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            modified = true;
            fixedLinks.push(`${brokenPath} (removed)`);
          }
        }
      }

      if (modified) {
        updates.push({
          type: 'update',
          path: page.path,
          content: updatedContent,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.1,
        });
      }
    }

    return {
      result: createAgentResult({
        summary: `Fixed ${fixedLinks.length} broken link(s): ${fixedLinks.join(', ')}`,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: `Fixed broken links in ${updates.length} page(s)`,
            relatedPaths: group.affectedPaths,
            importance: 'medium',
          }),
        ],
        confidence: 0.8,
      }),
      updates,
      costUsd: 0,
    };
  }

  /**
   * Find a similar valid path for a broken link.
   */
  private findSimilarPath(brokenPath: string, validPaths: Set<string>): string | null {
    const brokenParts = brokenPath.toLowerCase().split('/');
    const brokenName = brokenParts[brokenParts.length - 1] ?? '';

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const validPath of validPaths) {
      const validParts = validPath.toLowerCase().split('/');
      const validName = validParts[validParts.length - 1] ?? '';

      // Check if the names are similar
      if (validName === brokenName) {
        return validPath; // Exact name match
      }

      // Check for partial match
      if (validName.includes(brokenName) || brokenName.includes(validName)) {
        const score = Math.max(validName.length, brokenName.length);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = validPath;
        }
      }
    }

    return bestMatch;
  }
}
