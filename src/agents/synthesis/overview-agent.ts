import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';

/**
 * Overview Agent - Creates category overview pages that synthesize all pages in a category.
 *
 * This synthesis agent runs on a category (not a commit) and produces a Wikipedia-style
 * overview page that introduces the topic and links to detailed pages.
 */
export class OverviewAgent implements Agent {
  readonly type: AgentType = 'overview';

  // Minimum pages needed before creating an overview
  private readonly MIN_PAGES_FOR_OVERVIEW = 3;

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('OverviewAgent does not run on commits. Use runOnCategory instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Group pages by category
    const categories = this.groupByCategory(pages);

    // Find categories that need overviews
    const categoriesNeedingOverview = this.findCategoriesNeedingOverview(categories, pages);

    if (categoriesNeedingOverview.length === 0) {
      return {
        result: createAgentResult({
          summary: 'All categories have overview pages or are too small',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Generate overview for the first category that needs one
    const [category, categoryPages] = categoriesNeedingOverview[0]!;
    const prompt = this.buildPrompt(category, categoryPages);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const overview = this.parseResponse(completion.content);
    const update = this.generateUpdate(category, overview, categoryPages);

    return {
      result: createAgentResult({
        summary: `Created overview for ${category}/ (${categoryPages.length} pages)`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: `Generated overview page for ${category} category`,
          relatedPaths: [`${category}/overview`],
          importance: 'medium',
        })],
        confidence: overview.confidence,
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  /**
   * Run on a specific category to generate its overview.
   */
  async runOnCategory(category: string, context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];
    const categoryPages = pages.filter(p => p.path.startsWith(category + '/'));

    if (categoryPages.length < this.MIN_PAGES_FOR_OVERVIEW) {
      return {
        result: createAgentResult({
          summary: `Category ${category} has too few pages for overview`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    const prompt = this.buildPrompt(category, categoryPages);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const overview = this.parseResponse(completion.content);
    const update = this.generateUpdate(category, overview, categoryPages);

    return {
      result: createAgentResult({
        summary: `Created overview for ${category}/ (${categoryPages.length} pages)`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: `Generated overview page for ${category} category`,
          relatedPaths: [`${category}/overview`],
          importance: 'medium',
        })],
        confidence: overview.confidence,
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  private groupByCategory(pages: WikiPage[]): Map<string, WikiPage[]> {
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

  private findCategoriesNeedingOverview(
    categories: Map<string, WikiPage[]>,
    allPages: WikiPage[]
  ): Array<[string, WikiPage[]]> {
    const needsOverview: Array<[string, WikiPage[]]> = [];

    // Skip commits category - those are too granular for an overview
    const skipCategories = ['commits'];

    for (const [category, pages] of categories) {
      if (skipCategories.includes(category)) continue;
      if (pages.length < this.MIN_PAGES_FOR_OVERVIEW) continue;

      // Check if overview already exists
      const hasOverview = pages.some(p =>
        p.path === `${category}/overview` ||
        p.path === `${category}/index`
      );

      if (!hasOverview) {
        needsOverview.push([category, pages]);
      }
    }

    // Sort by number of pages (prioritize larger categories)
    needsOverview.sort((a, b) => b[1].length - a[1].length);

    return needsOverview;
  }

  private buildPrompt(category: string, pages: WikiPage[]): string {
    const pagesSummary = pages.map(p => {
      // Extract first paragraph as summary
      const firstPara = p.content.split('\n\n').slice(0, 2).join('\n\n');
      return `### ${p.title}
Path: ${p.path}
Confidence: ${(p.confidence * 100).toFixed(0)}%

${firstPara.slice(0, 500)}${firstPara.length > 500 ? '...' : ''}
`;
    }).join('\n---\n');

    return `Create an overview page for the "${category}" category.

## Pages in this Category (${pages.length} total)

${pagesSummary}

## Your Task

Write a comprehensive overview page that:
1. Introduces what this category covers
2. Explains how the pages relate to each other
3. Highlights the most important concepts
4. Provides a reading order or navigation guide
5. Links to the individual pages

Format your response as:

TITLE:
[A descriptive title for this overview page]

INTRODUCTION:
[2-3 paragraphs introducing this topic area. What is it? Why does it matter? What will readers learn?]

KEY_CONCEPTS:
- [Concept 1]: [Brief explanation]
- [Concept 2]: [Brief explanation]

PAGES:
- [page-path]: [One sentence description of what it covers]

READING_ORDER:
[Suggested order for reading the pages, if applicable]

CONFIDENCE: [0-1]
`;
  }

  private parseResponse(response: string): ParsedOverview {
    const overview: ParsedOverview = {
      title: '',
      introduction: '',
      keyConcepts: [],
      pageDescriptions: [],
      readingOrder: '',
      confidence: 0.7,
    };

    // Parse title
    const titleMatch = response.match(/TITLE:\s*(.+?)(?=\n|INTRODUCTION:|$)/i);
    if (titleMatch) {
      overview.title = titleMatch[1]!.trim();
    }

    // Parse introduction
    const introMatch = response.match(/INTRODUCTION:\s*([\s\S]*?)(?=KEY_CONCEPTS:|PAGES:|$)/i);
    if (introMatch) {
      overview.introduction = introMatch[1]!.trim();
    }

    // Parse key concepts
    const conceptsMatch = response.match(/KEY_CONCEPTS:\s*([\s\S]*?)(?=PAGES:|READING_ORDER:|CONFIDENCE:|$)/i);
    if (conceptsMatch) {
      const lines = conceptsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*(.+)$/);
        if (match) {
          overview.keyConcepts.push({
            name: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse page descriptions
    const pagesMatch = response.match(/PAGES:\s*([\s\S]*?)(?=READING_ORDER:|CONFIDENCE:|$)/i);
    if (pagesMatch) {
      const lines = pagesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*(.+)$/);
        if (match) {
          overview.pageDescriptions.push({
            path: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse reading order
    const readingMatch = response.match(/READING_ORDER:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (readingMatch) {
      overview.readingOrder = readingMatch[1]!.trim();
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      overview.confidence = parseFloat(confidenceMatch[1]!);
    }

    return overview;
  }

  private generateUpdate(
    category: string,
    overview: ParsedOverview,
    pages: WikiPage[]
  ): WikiPageUpdate {
    const title = overview.title || `${capitalize(category)} Overview`;

    // Build key concepts section
    const conceptsSection = overview.keyConcepts.length > 0
      ? `## Key Concepts

${overview.keyConcepts.map(c => `- **${c.name}**: ${c.description}`).join('\n')}`
      : '';

    // Build pages section with links
    const pagesSection = `## Pages in this Category

${pages.map(p => {
  const desc = overview.pageDescriptions.find(pd =>
    pd.path === p.path || pd.path.includes(p.path.split('/').pop()!)
  );
  return `- [${p.title}](${p.path}.md)${desc ? ` - ${desc.description}` : ''}`;
}).join('\n')}`;

    // Build reading order section if provided
    const readingSection = overview.readingOrder
      ? `## Suggested Reading Order

${overview.readingOrder}`
      : '';

    const content = `# ${title}

${overview.introduction}

${conceptsSection}

${pagesSection}

${readingSection}
`.trim();

    return {
      type: 'create',
      path: `${category}/overview`,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.5,
    };
  }
}

interface ParsedOverview {
  title: string;
  introduction: string;
  keyConcepts: Array<{ name: string; description: string }>;
  pageDescriptions: Array<{ path: string; description: string }>;
  readingOrder: string;
  confidence: number;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const SYSTEM_PROMPT = `You are a technical writer creating overview pages for a project wiki.

Your job is to synthesize multiple wiki pages into a cohesive introduction that helps readers understand a topic area.

Good overview pages:
- Start with a clear explanation of what the topic covers
- Explain how individual pages relate to each other
- Highlight the most important concepts
- Provide a logical reading path
- Link to detailed pages for deeper information

Write in an encyclopedic style - informative, neutral, and helpful. The overview should help a new developer understand this area of the codebase quickly.

Do NOT:
- Repeat detailed content from individual pages
- Write about commits or git history
- Include implementation details (that's what the linked pages are for)`;
