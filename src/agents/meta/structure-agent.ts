import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';

/**
 * Structure Agent - Analyzes and improves wiki organization.
 *
 * This meta-agent examines the overall structure of the wiki to identify:
 * - Pages that are too long and should be split
 * - Categories that are overloaded or underutilized
 * - Orphaned pages with no connections
 * - Naming inconsistencies
 * - Opportunities for better organization
 */
export class StructureAgent implements Agent {
  readonly type: AgentType = 'structure';

  // Thresholds for structure analysis
  private readonly MAX_PAGE_LENGTH = 5000; // characters
  private readonly MIN_CATEGORY_PAGES = 2;
  private readonly MAX_CATEGORY_PAGES = 20;
  private readonly MIN_TITLE_LENGTH = 10;
  private readonly MAX_TITLE_LENGTH = 80;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`StructureAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('StructureAgent does not run on commits. Use run() with WikiTarget instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < 3) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages for structure analysis',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Analyze structure without LLM first (fast checks)
    const structuralIssues = this.analyzeStructure(pages);

    // If we found issues, ask LLM for improvement suggestions
    if (structuralIssues.length > 0) {
      const prompt = this.buildPrompt(pages, structuralIssues);

      const completion = await context.llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 3000,
        temperature: 0.3,
      });

      const suggestions = this.parseResponse(completion.content);

      return {
        result: createAgentResult({
          summary: `Analyzed ${pages.length} pages, found ${structuralIssues.length} structural issues with ${suggestions.length} improvement suggestions`,
          findings: [
            ...structuralIssues.map(issue => createFinding({
              type: 'STRUCTURE',
              description: issue.description,
              relatedPaths: issue.affectedPages,
              importance: issue.severity,
            })),
            ...suggestions.map(s => createFinding({
              type: 'SUGGESTION',
              description: s.suggestion,
              relatedPaths: s.affectedPages,
              importance: s.priority,
            })),
          ],
          confidence: 0.8,
        }),
        updates: [], // Structure agent reports issues but doesn't auto-fix
        costUsd: completion.costUsd,
      };
    }

    return {
      result: createAgentResult({
        summary: `Wiki structure is healthy: ${pages.length} pages across ${this.getCategories(pages).size} categories`,
        findings: [],
        confidence: 0.9,
      }),
      updates: [],
      costUsd: 0,
    };
  }

  private analyzeStructure(pages: WikiPage[]): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const categories = this.getCategories(pages);

    // Check for overly long pages
    for (const page of pages) {
      if (page.content.length > this.MAX_PAGE_LENGTH) {
        issues.push({
          type: 'page_too_long',
          description: `Page "${page.title}" is ${page.content.length} characters (>${this.MAX_PAGE_LENGTH}). Consider splitting into multiple pages.`,
          affectedPages: [page.path],
          severity: 'medium',
        });
      }
    }

    // Check for category imbalances
    for (const [category, categoryPages] of categories) {
      if (categoryPages.length > this.MAX_CATEGORY_PAGES) {
        issues.push({
          type: 'category_overloaded',
          description: `Category "${category}" has ${categoryPages.length} pages (>${this.MAX_CATEGORY_PAGES}). Consider subcategories.`,
          affectedPages: categoryPages.map(p => p.path),
          severity: 'low',
        });
      }
    }

    // Check for single-page categories (might indicate misorganization)
    for (const [category, categoryPages] of categories) {
      if (categoryPages.length === 1 && category !== 'uncategorized') {
        issues.push({
          type: 'lonely_category',
          description: `Category "${category}" has only 1 page. Consider merging with a related category.`,
          affectedPages: categoryPages.map(p => p.path),
          severity: 'low',
        });
      }
    }

    // Check for poor titles
    for (const page of pages) {
      if (page.title.length < this.MIN_TITLE_LENGTH) {
        issues.push({
          type: 'title_too_short',
          description: `Page "${page.path}" has a very short title: "${page.title}". Consider a more descriptive title.`,
          affectedPages: [page.path],
          severity: 'low',
        });
      }
      if (page.title.length > this.MAX_TITLE_LENGTH) {
        issues.push({
          type: 'title_too_long',
          description: `Page "${page.path}" has a very long title (${page.title.length} chars). Consider shortening.`,
          affectedPages: [page.path],
          severity: 'low',
        });
      }
    }

    // Check for orphaned pages (no links in or out)
    const linkedPages = new Set<string>();
    for (const page of pages) {
      for (const link of page.links) {
        linkedPages.add(link);
      }
      if (page.content.includes('## Related Pages')) {
        linkedPages.add(page.path);
      }
    }

    for (const page of pages) {
      const hasIncomingLinks = linkedPages.has(page.path);
      const hasOutgoingLinks = page.links.length > 0 || page.content.includes('## Related Pages');
      if (!hasIncomingLinks && !hasOutgoingLinks && pages.length > 5) {
        issues.push({
          type: 'orphaned_page',
          description: `Page "${page.title}" has no links to or from other pages. Consider adding cross-references.`,
          affectedPages: [page.path],
          severity: 'medium',
        });
      }
    }

    // Check for missing overview pages
    for (const [category, categoryPages] of categories) {
      if (categoryPages.length >= 5) {
        const hasOverview = categoryPages.some(p =>
          p.path.includes('overview') ||
          p.path.includes('index') ||
          p.title.toLowerCase().includes('overview')
        );
        if (!hasOverview) {
          issues.push({
            type: 'missing_overview',
            description: `Category "${category}" has ${categoryPages.length} pages but no overview page.`,
            affectedPages: categoryPages.map(p => p.path),
            severity: 'medium',
          });
        }
      }
    }

    return issues;
  }

  private getCategories(pages: WikiPage[]): Map<string, WikiPage[]> {
    const categories = new Map<string, WikiPage[]>();
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(page);
    }
    return categories;
  }

  private buildPrompt(pages: WikiPage[], issues: StructuralIssue[]): string {
    const categories = this.getCategories(pages);

    return `You are analyzing wiki structure for improvement opportunities.

## Current Wiki Statistics

- Total pages: ${pages.length}
- Categories: ${Array.from(categories.keys()).join(', ')}
- Category distribution:
${Array.from(categories.entries()).map(([cat, ps]) => `  - ${cat}: ${ps.length} pages`).join('\n')}

## Identified Issues

${issues.map((issue, i) => `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`).join('\n')}

## Page Titles by Category

${Array.from(categories.entries()).map(([cat, ps]) => `### ${cat}
${ps.map(p => `- ${p.title} (${p.content.length} chars)`).join('\n')}`).join('\n\n')}

## Your Task

Analyze the wiki structure and suggest specific improvements. Consider:
1. Which pages should be split or merged?
2. How could categories be better organized?
3. What overview pages are needed?
4. Are there naming patterns that could be improved?

## Required Output Format

SUGGESTIONS:
- [PRIORITY:high/medium/low] | [affected-page-paths] | Specific improvement suggestion
- [PRIORITY:high/medium/low] | [affected-page-paths] | Specific improvement suggestion

OVERALL_ASSESSMENT: Brief assessment of wiki organization quality
`;
  }

  private parseResponse(response: string): StructureSuggestion[] {
    const suggestions: StructureSuggestion[] = [];

    const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)(?=OVERALL_ASSESSMENT:|$)/i);
    if (suggestionsMatch) {
      const lines = suggestionsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[PRIORITY:(\w+)\]\s*\|\s*\[([^\]]*)\]\s*\|\s*(.+)$/i);
        if (match) {
          suggestions.push({
            priority: match[1]!.toLowerCase() as 'high' | 'medium' | 'low',
            affectedPages: match[2]!.split(',').map(p => p.trim()).filter(Boolean),
            suggestion: match[3]!.trim(),
          });
        }
      }
    }

    return suggestions;
  }
}

interface StructuralIssue {
  type: string;
  description: string;
  affectedPages: string[];
  severity: 'high' | 'medium' | 'low';
}

interface StructureSuggestion {
  priority: 'high' | 'medium' | 'low';
  affectedPages: string[];
  suggestion: string;
}

const SYSTEM_PROMPT = `You are a Structure Agent for CodeWiki. Your job is to analyze wiki organization and suggest improvements.

Think like a Wikipedia editor reviewing article organization. Good wiki structure has:
- Clear, descriptive page titles
- Balanced categories (not too many pages, not too few)
- Overview pages for major topics
- Good cross-linking between related content
- Appropriate page lengths (not too long, not too short)

When suggesting improvements:
- Be specific and actionable
- Prioritize high-impact changes
- Consider the reader's navigation experience
- Suggest concrete page splits, merges, or reorganizations

Focus on structural improvements, not content quality (that's another agent's job).`;
