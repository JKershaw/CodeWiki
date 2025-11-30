import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';

/**
 * Link Agent - Manages cross-references between wiki pages.
 *
 * This meta-agent examines all wiki pages to find semantic relationships
 * and creates links between related content. It helps build a connected
 * knowledge graph from isolated commit-based documentation.
 */
export class LinkAgent implements Agent {
  readonly type: AgentType = 'link';

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('LinkAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
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

    // Find pages that need link analysis (no links yet or low confidence)
    const pagesToAnalyze = pages.filter(p => p.links.length === 0);

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

    const prompt = this.buildPrompt(pagesToAnalyze, pageSummaries);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(pagesToAnalyze, analysis, pages);

    return {
      result: createAgentResult({
        summary: `Found ${analysis.linkSuggestions.length} link relationships across ${pagesToAnalyze.length} pages`,
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
    // Limit pages to avoid overly long prompts
    const limitedPagesToAnalyze = pagesToAnalyze.slice(0, 10);

    return `You are analyzing wiki pages to create cross-references between related content.

## Pages to Analyze

${limitedPagesToAnalyze.map(p => `### ${p.path}
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
- [source/page-path] -> [target/page-path] | [STRENGTH:strong] | Description of relationship
- [source/page-path] -> [target/page-path] | [STRENGTH:medium] | Description of relationship
- [source/page-path] -> [target/page-path] | [STRENGTH:weak] | Description of relationship

CONFIDENCE: 0.8

## Example Output

LINK_SUGGESTIONS:
- [commits/abc123] -> [security/overview] | [STRENGTH:medium] | Commit introduces authentication changes relevant to security
- [commits/abc123] -> [architecture/auth-design] | [STRENGTH:strong] | Both discuss authentication architecture
- [architecture/api-design] -> [commits/def456] | [STRENGTH:weak] | API changes relate to design decisions

CONFIDENCE: 0.75

Now analyze the pages above and provide your link suggestions:
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      linkSuggestions: [],
      confidence: 0.7,
    };

    // Parse link suggestions
    const linksMatch = response.match(/LINK_SUGGESTIONS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (linksMatch) {
      const lines = linksMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*->\s*\[([^\]]+)\]\s*\|\s*\[STRENGTH:(\w+)\]\s*\|\s*(.+)$/i);
        if (match) {
          analysis.linkSuggestions.push({
            sourcePath: match[1]!.trim(),
            targetPath: match[2]!.trim(),
            strength: match[3]!.toLowerCase() as 'strong' | 'medium' | 'weak',
            reason: match[4]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
  }

  private generateUpdates(
    pagesToAnalyze: WikiPage[],
    analysis: ParsedAnalysis,
    allPages: WikiPage[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];
    const pageMap = new Map(allPages.map(p => [p.path, p]));

    // Group links by source page
    const linksBySource = new Map<string, Array<{ target: string; reason: string }>>();
    for (const link of analysis.linkSuggestions) {
      if (!linksBySource.has(link.sourcePath)) {
        linksBySource.set(link.sourcePath, []);
      }
      linksBySource.get(link.sourcePath)!.push({
        target: link.targetPath,
        reason: link.reason,
      });
    }

    // Create updates for pages with new links
    for (const page of pagesToAnalyze) {
      const newLinks = linksBySource.get(page.path);
      if (!newLinks || newLinks.length === 0) continue;

      // Add "Related Pages" section to content
      const relatedSection = `\n\n## Related Pages\n\n${newLinks.map(l => {
        const targetPage = pageMap.get(l.target);
        const targetTitle = targetPage?.title ?? l.target;
        return `- [${targetTitle}](${l.target}) - ${l.reason}`;
      }).join('\n')}`;

      // Check if Related Pages section already exists
      if (page.content.includes('## Related Pages')) {
        continue; // Skip if already has related pages
      }

      updates.push({
        type: 'merge',
        path: page.path,
        content: relatedSection,
        sourceCommitId: page.sourceCommits[0] ?? '',
        agentRunId: '',
        confidenceDelta: 0.05,
      });
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

Types of links to look for:
1. Commits about the same feature area
2. Architecture/design docs related to commits
3. Security analysis related to commits
4. Sequential commits telling a story
5. Any pages in the same category
6. Cross-category connections (security → commits, patterns → architecture)

You MUST output at least 2-3 link suggestions per page analyzed. Be generous with weak links.`;
