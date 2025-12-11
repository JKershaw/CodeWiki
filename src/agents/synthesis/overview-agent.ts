import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createParseContext,
  parseSection,
  parseListItemsWithFallback,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Overview Agent - Creates category overview pages that synthesize all pages in a category.
 *
 * OPTIMIZATION: Uses single LLM call with all page summaries provided in prompt.
 * The wiki pages already contain the synthesized information needed - tool calls
 * for "verification" provide minimal value for synthesis tasks.
 *
 * This synthesis agent runs on a category (not a commit) and produces a Wikipedia-style
 * overview page that introduces the topic and links to detailed pages.
 */
export class OverviewAgent implements Agent {
  readonly type: AgentType = 'overview';

  // Minimum pages needed before creating an overview
  private readonly MIN_PAGES_FOR_OVERVIEW = 3;
  // Max content length per page in prompt
  private readonly MAX_PAGE_CONTENT_LENGTH = 1000;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`OverviewAgent cannot handle target type: ${target.type}`);
    }

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
    const [category, categoryPages, operationType] = categoriesNeedingOverview[0]!;
    const prompt = this.buildPrompt(category, categoryPages);

    // Use single LLM call - page summaries already contain synthesized info
    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_OPTIMIZED,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2500,
      temperature: 0.4,
    });

    const overview = this.parseResponse(completion.content);
    const update = this.generateUpdate(category, overview, categoryPages, operationType);

    const actionVerb = operationType === 'update' ? 'Updated' : 'Created';
    return {
      result: createAgentResult({
        summary: `${actionVerb} overview for ${category}/ (${categoryPages.length} pages)`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: `${actionVerb} overview page for ${category} category`,
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

    // Use single LLM call - page summaries already contain synthesized info
    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_OPTIMIZED,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2500,
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
    _allPages: WikiPage[]
  ): Array<[string, WikiPage[], 'create' | 'update']> {
    const needsOverview: Array<[string, WikiPage[], 'create' | 'update']> = [];

    // Skip commits category - those are too granular for an overview
    const skipCategories = ['commits'];

    for (const [category, pages] of categories) {
      if (skipCategories.includes(category)) continue;
      if (pages.length < this.MIN_PAGES_FOR_OVERVIEW) continue;

      // Check if overview already exists
      const existingOverview = pages.find(p =>
        p.path === `${category}/overview` ||
        p.path === `${category}/index`
      );

      if (!existingOverview) {
        // No overview exists - need to create one
        needsOverview.push([category, pages, 'create']);
      } else {
        // Overview exists - check if it's stale (missing pages)
        const listedPaths = this.extractListedPagePaths(existingOverview.content);
        const contentPages = pages.filter(p =>
          p.path !== `${category}/overview` && p.path !== `${category}/index`
        );

        // Check if any content pages are not listed in the overview
        const unlistedPages = contentPages.filter(p => !listedPaths.has(p.path));

        if (unlistedPages.length > 0) {
          // Overview is stale - needs update
          needsOverview.push([category, pages, 'update']);
        }
      }
    }

    // Sort by number of pages (prioritize larger categories)
    needsOverview.sort((a, b) => b[1].length - a[1].length);

    return needsOverview;
  }

  /**
   * Extract page paths that are listed/linked in an overview's content.
   * Looks for markdown links like [Title](path) and extracts the paths.
   */
  private extractListedPagePaths(content: string): Set<string> {
    const paths = new Set<string>();

    // Match markdown links: [Title](path)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      const path = match[2]!;
      // Normalize path (remove leading ./ or /, remove .md extension)
      const normalizedPath = path
        .replace(/^\.?\//, '')
        .replace(/\.md$/, '');
      paths.add(normalizedPath);
    }

    return paths;
  }

  private buildPrompt(category: string, pages: WikiPage[]): string {
    const pagesSummary = pages.map(p => {
      // Extract more content for better synthesis
      const contentPreview = p.content.slice(0, this.MAX_PAGE_CONTENT_LENGTH);
      return `### ${p.title}
Path: ${p.path}
Confidence: ${(p.confidence * 100).toFixed(0)}%

${contentPreview}${p.content.length > this.MAX_PAGE_CONTENT_LENGTH ? '...' : ''}
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
[2-3 paragraphs that directly explain this topic area. Write the actual content - what it IS, how it works, why it matters. Do NOT write meta-commentary like "This category covers..." or "Readers will learn..." - instead, write the explanation itself as encyclopedia content.]

KEY_CONCEPTS:
- [Concept 1]: [Brief explanation]
- [Concept 2]: [Brief explanation]

PAGES:
- [page-path]: [One sentence description of what it covers]

READING_ORDER:
[Suggested order for reading the pages, if applicable]

CONFIDENCE: [0-1]

## Example

TITLE:
Architecture Patterns Overview

INTRODUCTION:
The codebase employs several well-established architectural patterns to maintain separation of concerns and testability. The Repository pattern abstracts data access, allowing business logic to remain independent of storage mechanisms. CQRS separates read and write operations for better scalability.

These patterns work together to create a maintainable, testable codebase where each component has a clear responsibility.

KEY_CONCEPTS:
- Repository Pattern: Abstracts data access behind interfaces for testability
- CQRS: Separates queries (reads) from commands (writes)
- Dependency Injection: Components receive dependencies rather than creating them

PAGES:
- architecture/repository-pattern: Explains how repositories abstract database operations
- architecture/cqrs-implementation: Details the command and query separation approach
- architecture/dependency-injection: Shows how DI is configured and used

READING_ORDER:
Start with repository-pattern for foundational concepts, then cqrs-implementation to understand data flow, finally dependency-injection to see how components are wired together.

CONFIDENCE: 0.85
`;
  }

  private parseResponse(response: string): ParsedOverview {
    const ctx = createParseContext('overview', response);

    // Parse title
    const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|INTRODUCTION:|$)/i) || '';

    // Parse introduction
    const introduction = parseSection(ctx, 'INTRODUCTION', /INTRODUCTION:\s*([\s\S]*?)(?=KEY_CONCEPTS:|PAGES:|$)/i) || '';

    // Parse key concepts
    const conceptPatterns: ItemPattern<{ name: string; description: string }>[] = [
      {
        pattern: /^-\s*\[?([^\]:]+)\]?:\s*(.+)$/,
        mapper: (m) => ({
          name: m[1]!.trim(),
          description: m[2]!.trim(),
        }),
      },
    ];
    const keyConcepts = parseListItemsWithFallback(
      ctx,
      'KEY_CONCEPTS',
      /KEY_CONCEPTS:\s*([\s\S]*?)(?=PAGES:|READING_ORDER:|CONFIDENCE:|$)/i,
      conceptPatterns
    );

    // Parse page descriptions
    const pagePatterns: ItemPattern<{ path: string; description: string }>[] = [
      {
        pattern: /^-\s*\[?([^\]:]+)\]?:\s*(.+)$/,
        mapper: (m) => ({
          path: m[1]!.trim(),
          description: m[2]!.trim(),
        }),
      },
    ];
    const pageDescriptions = parseListItemsWithFallback(
      ctx,
      'PAGES',
      /PAGES:\s*([\s\S]*?)(?=READING_ORDER:|CONFIDENCE:|$)/i,
      pagePatterns
    );

    // Parse reading order
    const readingOrder = parseSection(ctx, 'READING_ORDER', /READING_ORDER:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i) || '';

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      title,
      introduction,
      keyConcepts,
      pageDescriptions,
      readingOrder,
      confidence,
    };
  }

  private generateUpdate(
    category: string,
    overview: ParsedOverview,
    pages: WikiPage[],
    operationType: 'create' | 'update' = 'create'
  ): WikiPageUpdate {
    const title = overview.title || `${capitalize(category)} Overview`;

    // Build key concepts section
    const conceptsSection = overview.keyConcepts.length > 0
      ? `## Key Concepts

${overview.keyConcepts.map(c => `- **${c.name}**: ${c.description}`).join('\n')}`
      : '';

    // Filter out the overview page itself from the pages list
    const contentPages = pages.filter(p =>
      p.path !== `${category}/overview` && p.path !== `${category}/index`
    );

    // Build pages section with links
    const pagesSection = `## Pages in this Category

${contentPages.map(p => {
  const desc = overview.pageDescriptions.find(pd =>
    pd.path === p.path || pd.path.includes(p.path.split('/').pop()!)
  );
  return `- [${p.title}](${p.path})${desc ? ` - ${desc.description}` : ''}`;
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
      type: operationType,
      path: `${category}/overview`,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: operationType === 'update' ? 0.1 : 0.5,
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

## Tool Usage for Verification

You have access to tools (read_file, search_files, list_directory) to explore the source code. Use them when:
- You need to verify technical relationships between components
- You want to confirm that a concept mentioned in page summaries is accurate
- You need to understand how different parts connect

If a technical claim seems uncertain, use the tools to verify before including it.

## Writing Style

Write as if you ARE the encyclopedia article, not as if you're describing what the article contains.

Great overview openings directly explain the topic:
- "The architecture layer handles request routing, response parsing, and data consolidation across the system."
- "Testing infrastructure in CodeWiki spans unit tests, integration tests, and end-to-end validation."
- "Agent coordination uses a pipeline model where specialized agents process different aspects of changes."
- "Response parsing transforms raw LLM output into structured data that other components can consume."

Notice how each example states what something IS or DOES - not what the page will teach. Write explanatory content, not previews of content.

Avoid meta-commentary that describes the page rather than explaining the topic:
- Phrases like "This category encompasses...", "Readers will gain insights into...", "This overview provides..."

## Good Overview Pages

- Start with a clear explanation of what the topic covers (not what the PAGE covers)
- Explain how individual pages relate to each other
- Highlight the most important concepts (verified against code when possible)
- Provide a logical reading path
- Link to detailed pages for deeper information

Write in an encyclopedic style - informative, neutral, and helpful. The overview should help a new developer understand this area of the codebase quickly.

## Do NOT

- Repeat detailed content from individual pages
- Write about commits or git history
- Include implementation details (that's what the linked pages are for)
- Make claims about code relationships without verification`;

/**
 * Optimized system prompt for single LLM call (no tools).
 * Page summaries already contain the synthesized information needed.
 */
const SYSTEM_PROMPT_OPTIMIZED = `You are a technical writer creating overview pages for a project wiki.

Your job is to synthesize multiple wiki pages into a cohesive introduction that helps readers understand a topic area. The wiki page content is provided to you - use it to create the overview.

## Writing Style

Write as if you ARE the encyclopedia article, not as if you're describing what the article contains.

Great overview openings directly explain the topic:
- "The architecture layer handles request routing, response parsing, and data consolidation across the system."
- "Testing infrastructure in CodeWiki spans unit tests, integration tests, and end-to-end validation."
- "Agent coordination uses a pipeline model where specialized agents process different aspects of changes."
- "Response parsing transforms raw LLM output into structured data that other components can consume."

Notice how each example states what something IS or DOES - not what the page will teach. Write explanatory content, not previews of content.

Avoid meta-commentary that describes the page rather than explaining the topic:
- Phrases like "This category encompasses...", "Readers will gain insights into...", "This overview provides..."

## Good Overview Pages

- Start with a clear explanation of what the topic covers (not what the PAGE covers)
- Explain how individual pages relate to each other
- Highlight the most important concepts based on the page summaries
- Provide a logical reading path
- Link to detailed pages for deeper information

Write in an encyclopedic style - informative, neutral, and helpful. The overview should help a new developer understand this area of the codebase quickly.

## Do NOT

- Repeat detailed content from individual pages
- Write about commits or git history
- Include implementation details (that's what the linked pages are for)
- Invent information not present in the page summaries`;
