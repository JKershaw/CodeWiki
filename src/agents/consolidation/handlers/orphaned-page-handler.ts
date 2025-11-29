import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType } from '../../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';

/**
 * Handler for orphaned page findings.
 * Adds links to orphaned pages from their category overview pages.
 */
export class OrphanedPageHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['orphaned_page'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const orphanedPages = await HandlerUtils.loadPages(group.affectedPaths, context);
    const allPages = await context.repos.wikiPages.findByWiki(context.wikiId);

    const updates: WikiPageUpdate[] = [];

    for (const orphan of orphanedPages) {
      const category = orphan.path.split('/')[0] ?? '';

      // Find overview page for this category
      const overviewPage = allPages.find(p =>
        p.path === `${category}/overview` || p.path === `${category}/index`
      );

      if (overviewPage && !overviewPage.content.includes(`](${orphan.path}`)) {
        // Add link to orphan in the overview page
        const linkedContent = this.addLinkToPage(overviewPage.content, orphan);
        updates.push({
          type: 'update',
          path: overviewPage.path,
          content: linkedContent,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.05,
        });
      }
    }

    return {
      result: createAgentResult({
        summary: `Linked ${updates.length} orphaned page(s) to their category overviews`,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: `Added links to orphaned pages`,
            relatedPaths: group.affectedPaths,
            importance: 'low',
          }),
        ],
        confidence: 0.7,
      }),
      updates,
      costUsd: 0,
    };
  }

  /**
   * Add a link to a target page in the given content.
   */
  private addLinkToPage(content: string, targetPage: WikiPage): string {
    // Add link in a "Related" section if it exists, otherwise at the end
    const relatedMatch = content.match(/^## Related\s*\n/m);
    if (relatedMatch) {
      const insertPos = relatedMatch.index! + relatedMatch[0].length;
      const linkLine = `- [${targetPage.title}](${targetPage.path}.md)\n`;
      return content.slice(0, insertPos) + linkLine + content.slice(insertPos);
    }

    // Add a Related section at the end
    return `${content.trimEnd()}\n\n## Related\n\n- [${targetPage.title}](${targetPage.path}.md)\n`;
  }
}
