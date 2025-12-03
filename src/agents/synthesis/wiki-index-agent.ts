import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';

/**
 * Wiki Index Agent - Creates a master navigation page for the wiki.
 *
 * This agent generates a comprehensive index page at `navigation/wiki-index`
 * that organizes all wiki pages by category, shows confidence scores, and
 * provides a central navigation point for both human users and AI agents.
 *
 * Features:
 * - Organizes pages by category with clear headings
 * - Shows page confidence levels for transparency
 * - Extracts brief descriptions from page content
 * - Updates as the wiki grows (re-runs when pages change)
 *
 * Trigger: When wiki has 10+ pages but no navigation/wiki-index page.
 */
export class WikiIndexAgent implements Agent {
  readonly type: AgentType = 'wiki-index';

  private readonly MIN_PAGES_FOR_INDEX = 10;
  private readonly INDEX_PATH = 'navigation/wiki-index';

  getSystemPrompt(): null {
    return null; // This agent uses pure computation, no LLM
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`WikiIndexAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('WikiIndexAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_INDEX) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_INDEX}+ for wiki index`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Check if index already exists and is up-to-date
    const existingIndex = pages.find(p =>
      p.path === this.INDEX_PATH ||
      p.path === 'navigation/index' ||
      p.path === 'guides/wiki-index'
    );

    // Filter out the index page itself from the list
    const contentPages = pages.filter(p =>
      p.path !== this.INDEX_PATH &&
      p.path !== 'navigation/index' &&
      p.path !== 'guides/wiki-index'
    );

    // If index exists, check if it needs updating (significant changes)
    if (existingIndex) {
      // Simple heuristic: if page count changed by less than 3, skip
      const pageCountInIndex = this.extractPageCountFromIndex(existingIndex.content);
      if (pageCountInIndex > 0 && Math.abs(contentPages.length - pageCountInIndex) < 3) {
        return {
          result: createAgentResult({
            summary: 'Wiki index is up-to-date',
            findings: [],
            confidence: 1.0,
          }),
          updates: [],
          costUsd: 0,
        };
      }
    }

    // Generate the index content
    const content = this.generateIndexContent(contentPages);

    const update: WikiPageUpdate = {
      type: existingIndex ? 'update' : 'create',
      path: this.INDEX_PATH,
      title: 'Wiki Index',
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.8,
    };

    return {
      result: createAgentResult({
        summary: `${existingIndex ? 'Updated' : 'Created'} wiki index with ${contentPages.length} pages across ${this.countCategories(contentPages)} categories`,
        findings: [
          createFinding({
            type: 'SYNTHESIS',
            description: 'Generated wiki navigation index for improved discoverability',
            relatedPaths: [this.INDEX_PATH],
            importance: 'high',
          }),
        ],
        confidence: 0.9,
      }),
      updates: [update],
      costUsd: 0, // No LLM cost - pure computation
    };
  }

  /**
   * Generate the markdown content for the wiki index.
   */
  private generateIndexContent(pages: WikiPage[]): string {
    // Group pages by category
    const categories = new Map<string, WikiPage[]>();
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(page);
    }

    // Sort categories alphabetically, but put "guides" and "architecture" first
    const priorityCategories = ['guides', 'architecture', 'overview'];
    const sortedCategories = [...categories.keys()].sort((a, b) => {
      const aIndex = priorityCategories.indexOf(a);
      const bIndex = priorityCategories.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });

    // Calculate wiki stats
    const avgConfidence = pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;
    const highConfidenceCount = pages.filter(p => p.confidence >= 0.7).length;

    // Build the markdown content
    let content = `# Wiki Index

This page provides a comprehensive navigation index for the wiki, organizing all ${pages.length} pages by category.

## Quick Stats

| Metric | Value |
|--------|-------|
| Total Pages | ${pages.length} |
| Categories | ${categories.size} |
| Avg Confidence | ${(avgConfidence * 100).toFixed(0)}% |
| High Confidence Pages | ${highConfidenceCount} |

## Table of Contents

${sortedCategories.map(cat => `- [${this.formatCategoryName(cat)}](#${this.slugify(cat)})`).join('\n')}

---

`;

    // Add each category section
    for (const category of sortedCategories) {
      const categoryPages = categories.get(category)!;
      // Sort pages: overviews first, then by title
      categoryPages.sort((a, b) => {
        const aIsOverview = a.path.endsWith('/overview') || a.path.endsWith('/index');
        const bIsOverview = b.path.endsWith('/overview') || b.path.endsWith('/index');
        if (aIsOverview && !bIsOverview) return -1;
        if (!aIsOverview && bIsOverview) return 1;
        return a.title.localeCompare(b.title);
      });

      content += `## ${this.formatCategoryName(category)}

`;

      // Create a table for this category
      content += `| Page | Confidence | Description |
|------|------------|-------------|
`;

      for (const page of categoryPages) {
        const description = this.extractDescription(page);
        const confidenceIcon = this.getConfidenceIcon(page.confidence);
        content += `| [${page.title}](/${page.path}) | ${confidenceIcon} ${(page.confidence * 100).toFixed(0)}% | ${description} |
`;
      }

      content += '\n';
    }

    // Add footer with generation info
    content += `---

*This index was automatically generated by the Wiki Index Agent. Last updated: ${new Date().toISOString().split('T')[0]}*

*Page count at generation: ${pages.length}*
`;

    return content;
  }

  /**
   * Extract a brief description from page content.
   */
  private extractDescription(page: WikiPage): string {
    // Skip the title line and get the first meaningful paragraph
    const lines = page.content.split('\n');
    let description = '';

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, headings, and code blocks
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('```')) continue;
      if (trimmed.startsWith('|')) continue; // Tables
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) continue; // Lists

      // Found a paragraph
      description = trimmed;
      break;
    }

    // Truncate to ~80 chars
    if (description.length > 80) {
      description = description.slice(0, 77) + '...';
    }

    // Escape pipe characters for markdown table
    return description.replace(/\|/g, '\\|');
  }

  /**
   * Get confidence icon based on score.
   */
  private getConfidenceIcon(confidence: number): string {
    if (confidence >= 0.8) return '🟢';
    if (confidence >= 0.6) return '🟡';
    if (confidence >= 0.4) return '🟠';
    return '🔴';
  }

  /**
   * Format category name for display.
   */
  private formatCategoryName(category: string): string {
    return category
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Create a slug for anchor links.
   */
  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  /**
   * Count unique categories.
   */
  private countCategories(pages: WikiPage[]): number {
    const categories = new Set(pages.map(p => p.path.split('/')[0]));
    return categories.size;
  }

  /**
   * Extract page count from existing index content.
   */
  private extractPageCountFromIndex(content: string): number {
    const match = content.match(/Page count at generation:\s*(\d+)/);
    if (match) {
      return parseInt(match[1]!, 10);
    }
    return 0;
  }
}
