import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createParseContext,
  parseListItemsWithFallback,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';
import { extractLinkTargetsAsSet } from '../../utils/link-extraction.js';

/**
 * Link Agent - Manages cross-references between wiki pages.
 *
 * This meta-agent examines all wiki pages to find semantic relationships
 * and creates links between related content. It helps build a connected
 * knowledge graph from isolated commit-based documentation.
 */
export class LinkAgent implements Agent {
  readonly type: AgentType = 'link';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`LinkAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWikiImpl(context);
  }

  private async runOnWikiImpl(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages to create links',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Find the newest page creation time to determine if older pages need re-analysis
    const newestPageCreation = Math.max(...pages.map(p => p.createdAt.getTime()));

    // Find pages that need link analysis:
    // 1. Pages with no links (always need analysis)
    // 2. Pages with links but updated before a newer page was created (might need new links)
    const pagesToAnalyze = pages.filter(p => {
      // Always analyze pages with no links
      if (p.links.length === 0) {
        return true;
      }
      // Re-analyze pages with links if they were updated before a newer page was created
      // This ensures old pages can get links to newly created pages
      const pageUpdatedAt = p.updatedAt.getTime();
      return pageUpdatedAt < newestPageCreation;
    });

    if (pagesToAnalyze.length === 0) {
      return {
        result: createAgentResult({
          summary: 'All pages already have links analyzed',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Build page summaries for context
    const pageSummaries = pages.map(p => ({
      path: p.path,
      title: p.title,
      category: p.path.split('/')[0] ?? 'uncategorized',
      excerpt: p.content.slice(0, 500),
    }));

    // Limit pages to analyze to avoid overly long prompts (increased from 10 to 20)
    const limitedPagesToAnalyze = pagesToAnalyze.slice(0, 20);

    const prompt = this.buildPrompt(limitedPagesToAnalyze, pageSummaries);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    // Only generate updates for pages that were actually analyzed
    const updates = this.generateUpdates(limitedPagesToAnalyze, analysis, pages);

    return {
      result: createAgentResult({
        summary: `Found ${analysis.linkSuggestions.length} link relationships across ${limitedPagesToAnalyze.length} pages`,
        findings: analysis.linkSuggestions.slice(0, 10).map(link => createFinding({
          type: 'LINK',
          description: `${link.sourcePath} → ${link.targetPath}: ${link.reason}`,
          relatedPaths: [link.sourcePath, link.targetPath],
          importance: link.strength === 'strong' ? 'high' : link.strength === 'medium' ? 'medium' : 'low',
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(
    pagesToAnalyze: WikiPage[],
    allPages: Array<{ path: string; title: string; category: string; excerpt: string }>
  ): string {
    // Note: pagesToAnalyze is already limited by caller (to 20 pages max)

    return `You are analyzing wiki pages to create cross-references between related content.

## Pages to Analyze

${pagesToAnalyze.map(p => `### ${p.path}
**Title:** ${p.title}
**Category:** ${p.path.split('/')[0] ?? 'uncategorized'}
**Content Preview:**
${p.content.slice(0, 800)}
---`).join('\n\n')}

## All Available Pages (link targets)

${allPages.map(p => `- ${p.path} (${p.category}): ${p.title} - ${p.excerpt.slice(0, 100)}...`).join('\n')}

## Your Task

IMPORTANT: You MUST suggest at least 2-3 links for each page analyzed. Look for ANY semantic connection, even weak ones.

For each page above, suggest pages it should link to. Consider:
- Same topic or feature (commits about same area → related docs)
- Same category (security → security, architecture → architecture)
- Cause and effect (commits that build on each other)
- Cross-category (security issues → the commit that introduced them)

## Required Output Format

You MUST use exactly this format:

LINK_SUGGESTIONS:
- source/page-path -> target/page-path | strong | Description of relationship
- source/page-path -> target/page-path | medium | Description of relationship
- source/page-path -> target/page-path | weak | Description of relationship

CONFIDENCE: 0.8

## Example Output

LINK_SUGGESTIONS:
- commits/abc123 -> security/overview | medium | Commit introduces authentication changes relevant to security
- commits/abc123 -> architecture/auth-design | strong | Both discuss authentication architecture
- architecture/api-design -> commits/def456 | weak | API changes relate to design decisions

CONFIDENCE: 0.75

Now analyze the pages above and provide your link suggestions:
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('link', response);

    // Multiple patterns to handle different LLM output formats
    const linkPatterns: ItemPattern<ParsedAnalysis['linkSuggestions'][0]>[] = [
      {
        // Full format: - source/path -> target/path | strength | description
        pattern: /^-\s*(.+?)\s*->\s*(.+?)\s*\|\s*(\w+)\s*\|\s*(.+)$/i,
        mapper: (m) => ({
          sourcePath: m[1]!.trim(),
          targetPath: m[2]!.trim(),
          strength: m[3]!.toLowerCase() as 'strong' | 'medium' | 'weak',
          reason: m[4]!.trim(),
        }),
      },
      {
        // Simple format without strength/reason: - source/path -> target/path
        // Many LLMs output this simpler format despite instructions
        pattern: /^-\s*(.+?)\s*->\s*([^\s|]+)\s*$/i,
        mapper: (m) => ({
          sourcePath: m[1]!.trim(),
          targetPath: m[2]!.trim(),
          strength: 'medium' as const,
          reason: 'Related content',
        }),
      },
    ];

    const linkSuggestions = parseListItemsWithFallback(
      ctx,
      'LINK_SUGGESTIONS',
      /LINK_SUGGESTIONS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      linkPatterns
    );

    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      linkSuggestions,
      confidence,
    };
  }

  private generateUpdates(
    pagesToAnalyze: WikiPage[],
    analysis: ParsedAnalysis,
    allPages: WikiPage[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];
    const pageMap = new Map(allPages.map(p => [p.path, p]));
    const validPaths = new Set(allPages.map(p => p.path));

    // Group links by source page, validating that targets exist
    const linksBySource = new Map<string, Array<{ target: string; reason: string }>>();
    for (const link of analysis.linkSuggestions) {
      // BUG 3 FIX: Only include links to pages that actually exist
      if (!validPaths.has(link.targetPath)) {
        continue;
      }
      if (!linksBySource.has(link.sourcePath)) {
        linksBySource.set(link.sourcePath, []);
      }
      linksBySource.get(link.sourcePath)!.push({
        target: link.targetPath,
        reason: link.reason,
      });
    }

    // Track backlinks to create (target -> sources)
    const backlinksToCreate = new Map<string, Array<{ source: string; reason: string }>>();

    // Create updates for pages with new links
    for (const page of pagesToAnalyze) {
      const suggestedLinks = linksBySource.get(page.path);
      if (!suggestedLinks || suggestedLinks.length === 0) continue;

      // BUG 1 FIX: Extract existing links from Related Pages section if present
      const existingTargets = extractLinkTargetsAsSet(page.content);

      // Filter to only truly new links that don't already exist
      const newLinks = suggestedLinks.filter(l => !existingTargets.has(l.target));

      // Skip if no new links to add
      if (newLinks.length === 0) continue;

      // Build content for new links only
      const newLinksContent = newLinks.map(l => {
        const targetPage = pageMap.get(l.target);
        const targetTitle = targetPage?.title ?? l.target;
        return `- [${targetTitle}](${l.target}) - ${l.reason}`;
      }).join('\n');

      let contentUpdate: string;
      if (page.content.includes('## Related Pages')) {
        // Append new links to existing section
        contentUpdate = `\n${newLinksContent}`;
      } else {
        // Create new Related Pages section
        contentUpdate = `\n\n## Related Pages\n\n${newLinksContent}`;
      }

      // Extract link target paths for the structured links array (only new ones)
      const linkPaths = newLinks.map(l => l.target);

      updates.push({
        type: 'merge',
        path: page.path,
        content: contentUpdate,
        sourceCommitId: page.sourceCommits[0] ?? '',
        agentRunId: '',
        confidenceDelta: 0.05,
        links: linkPaths,
      });

      // Track backlinks: for each new link, create a backlink from target to source
      for (const link of newLinks) {
        const targetBacklinks = backlinksToCreate.get(link.target) || [];
        targetBacklinks.push({ source: page.path, reason: `Linked from ${page.title}` });
        backlinksToCreate.set(link.target, targetBacklinks);
      }
    }

    // Create backlink updates for target pages
    for (const [targetPath, backlinks] of backlinksToCreate) {
      const targetPage = pageMap.get(targetPath);
      if (!targetPage) continue;

      // Check if target page already has these backlinks
      const existingTargetLinks = extractLinkTargetsAsSet(targetPage.content);

      // Filter to only new backlinks
      const newBacklinks = backlinks.filter(bl => !existingTargetLinks.has(bl.source));
      if (newBacklinks.length === 0) continue;

      // Check if we already created an update for this target (as a source page)
      const existingUpdate = updates.find(u => u.path === targetPath);
      if (existingUpdate) {
        // Append backlinks to existing update
        const backlinkContent = newBacklinks.map(bl => {
          const sourcePage = pageMap.get(bl.source);
          const sourceTitle = sourcePage?.title ?? bl.source;
          return `- [${sourceTitle}](${bl.source}) - ${bl.reason}`;
        }).join('\n');

        existingUpdate.content += `\n${backlinkContent}`;
        existingUpdate.links = [...(existingUpdate.links || []), ...newBacklinks.map(bl => bl.source)];
      } else {
        // Create new update for target page with backlinks
        const backlinkContent = newBacklinks.map(bl => {
          const sourcePage = pageMap.get(bl.source);
          const sourceTitle = sourcePage?.title ?? bl.source;
          return `- [${sourceTitle}](${bl.source}) - ${bl.reason}`;
        }).join('\n');

        let contentUpdate: string;
        if (targetPage.content.includes('## Related Pages')) {
          contentUpdate = `\n${backlinkContent}`;
        } else {
          contentUpdate = `\n\n## Related Pages\n\n${backlinkContent}`;
        }

        updates.push({
          type: 'merge',
          path: targetPath,
          content: contentUpdate,
          sourceCommitId: targetPage.sourceCommits[0] ?? '',
          agentRunId: '',
          confidenceDelta: 0.05,
          links: newBacklinks.map(bl => bl.source),
        });
      }
    }

    return updates;
  }
}

interface ParsedAnalysis {
  linkSuggestions: Array<{
    sourcePath: string;
    targetPath: string;
    strength: 'strong' | 'medium' | 'weak';
    reason: string;
  }>;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a Link Agent for CodeWiki, a documentation system. Your job is to find and create cross-references between wiki pages.

IMPORTANT: You should ALWAYS find connections between pages. Even if relationships seem weak, suggest them. It's better to suggest too many links than too few. The user can filter out weak links later.

Link strength guidelines:
- **strong**: Direct relationship (same feature, same commit, cause-and-effect)
- **medium**: Related context (same component area, similar patterns, same time period)
- **weak**: Any topical connection (same category, mentioned concepts, related technology)

Quality consideration:
Before suggesting a link, consider whether the source page has enough context that the link will be useful. If a page is very shallow (just a title and one sentence), note in your reason that it "needs more content before linking would add value".

Types of links to look for:
1. Commits about the same feature area
2. Architecture/design docs related to commits
3. Security analysis related to commits
4. Sequential commits telling a story
5. Any pages in the same category
6. Cross-category connections (security → commits, patterns → architecture)

You MUST output at least 2-3 link suggestions per page analyzed. Be generous with weak links.`;
