import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createParseContext,
  parseSection,
  parseConfidence,
} from '../parsing/index.js';

/**
 * Spec Agent - Generates context specifications for coding agents.
 *
 * Given a task description, it searches the wiki, synthesizes relevant context,
 * and returns a structured specification that a coding agent can use to
 * implement the task effectively.
 *
 * This agent is used by:
 * - AI coding agents needing context before implementation
 * - The MCP endpoint for external AI agents
 * - The CLI spec command
 */
export class SpecAgent {
  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService
  ) {}

  /**
   * Generate a specification for a coding task.
   */
  async generateSpec(wikiId: string, task: string): Promise<SpecResult> {
    // Search for relevant wiki pages
    const relevantPages = await this.findRelevantPages(wikiId, task);

    if (relevantPages.length === 0) {
      return {
        task,
        interpretation: 'Unable to interpret task - no wiki content available.',
        spec: {
          context: 'No wiki content is available for this repository. The wiki may need commits processed to build up relevant content.',
          keyFiles: [],
          patterns: 'Unknown - no wiki content available.',
          conventions: 'Unknown - no wiki content available.',
          dependencies: 'Unknown - no wiki content available.',
          testing: 'Unknown - no wiki content available.',
          pitfalls: 'Without wiki documentation, be careful to explore the codebase manually before making changes.',
        },
        confidence: 0,
        sources: [],
        searchedPages: 0,
      };
    }

    // Build context from relevant pages
    const context = this.buildContext(relevantPages);

    // Use LLM to generate specification
    const completion = await this.llm.complete({
      system: SPEC_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Task: ${task}\n\n${context}`,
        },
      ],
      maxTokens: 2500,
      temperature: 0.3,
    });

    // Parse the structured response
    const parsed = this.parseResponse(completion.content, task);

    return {
      task,
      interpretation: parsed.interpretation,
      spec: parsed.spec,
      confidence: this.calculateConfidence(relevantPages, parsed.confidence),
      sources: relevantPages.slice(0, 5).map(p => ({
        path: p.page.path,
        title: p.page.title,
        relevance: p.relevance,
        confidence: p.page.confidence,
      })),
      searchedPages: relevantPages.length,
      costUsd: completion.costUsd,
    };
  }

  /**
   * Find wiki pages relevant to the task.
   */
  private async findRelevantPages(
    wikiId: string,
    task: string
  ): Promise<RelevantPage[]> {
    // Get all wiki pages for this wiki via CQRS query
    const query = createListWikiPagesQuery(wikiId);
    const result = await handleListWikiPages(query, this.repos);

    if (!result.success || !result.data || result.data.length === 0) {
      return [];
    }

    const allPages = result.data;

    // Extract keywords from the task
    const keywords = this.extractKeywords(task);

    // Score each page by relevance
    const scored: RelevantPage[] = allPages.map(page => ({
      page,
      relevance: this.scoreRelevance(page, keywords, task),
    }));

    // Sort by relevance and filter out low-relevance pages
    return scored
      .filter(p => p.relevance > 0.1)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Top 10 most relevant
  }

  /**
   * Extract keywords from a task description.
   */
  private extractKeywords(task: string): string[] {
    // Remove common words and punctuation
    const stopWords = new Set([
      'what', 'why', 'how', 'when', 'where', 'who', 'which',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at',
      'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
      'about', 'this', 'that', 'these', 'those',
      'i', 'you', 'we', 'they', 'it', 'my', 'our', 'your',
      'can', 'could', 'would', 'should', 'will', 'shall',
      'add', 'create', 'make', 'build', 'implement', 'fix', 'update',
      'change', 'modify', 'remove', 'delete', 'new', 'existing',
      'need', 'want', 'like', 'please', 'help',
    ]);

    return task
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Score a page's relevance to the task.
   */
  private scoreRelevance(
    page: WikiPage,
    keywords: string[],
    _task: string
  ): number {
    const lowerContent = page.content.toLowerCase();
    const lowerTitle = page.title.toLowerCase();
    const lowerPath = page.path.toLowerCase();

    let score = 0;

    // Keyword matches in title (high weight)
    for (const keyword of keywords) {
      if (lowerTitle.includes(keyword)) {
        score += 3;
      }
    }

    // Keyword matches in path (medium weight)
    for (const keyword of keywords) {
      if (lowerPath.includes(keyword)) {
        score += 2;
      }
    }

    // Keyword matches in content (lower weight, but count occurrences)
    for (const keyword of keywords) {
      const matches = (lowerContent.match(new RegExp(keyword, 'g')) || []).length;
      score += Math.min(matches * 0.5, 3); // Cap contribution per keyword
    }

    // Boost for architecture/patterns/overview pages (often more useful for implementation)
    if (lowerPath.includes('architecture') ||
        lowerPath.includes('pattern') ||
        lowerPath.includes('overview') ||
        lowerPath.includes('getting-started')) {
      score *= 1.3;
    }

    // Boost for pages with higher confidence
    score *= (0.5 + page.confidence * 0.5);

    // Normalize to 0-1 range (roughly)
    return Math.min(score / (keywords.length * 5), 1);
  }

  /**
   * Build context string from relevant pages.
   */
  private buildContext(pages: RelevantPage[]): string {
    const sections: string[] = [];

    sections.push('## Relevant Wiki Content\n');

    for (const { page } of pages.slice(0, 5)) {
      // Truncate very long content
      let content = page.content;
      if (content.length > 3000) {
        content = content.slice(0, 3000) + '\n... (content truncated)';
      }

      sections.push(`### ${page.title} (${page.path})`);
      sections.push(`Confidence: ${(page.confidence * 100).toFixed(0)}%`);
      sections.push('');
      sections.push(content);
      sections.push('');
      sections.push('---');
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Parse the LLM response into structured sections.
   */
  private parseResponse(
    response: string,
    originalTask: string
  ): { interpretation: string; spec: SpecResult['spec']; confidence: number } {
    const ctx = createParseContext('spec', response);

    // Helper to create dynamic regex for each section
    const makeSectionRegex = (marker: string) =>
      new RegExp(`${marker}:\\s*([\\s\\S]*?)(?=(?:[A-Z_]+:|CONFIDENCE:|$))`, 'i');

    // Extract sections using centralized parser
    const interpretation = parseSection(ctx, 'INTERPRETATION', makeSectionRegex('INTERPRETATION')) ||
      `Implement: ${originalTask}`;
    const context = parseSection(ctx, 'CONTEXT', makeSectionRegex('CONTEXT')) ||
      'No specific context found.';
    const keyFilesRaw = parseSection(ctx, 'KEY_FILES', makeSectionRegex('KEY_FILES')) || '';
    const patterns = parseSection(ctx, 'PATTERNS', makeSectionRegex('PATTERNS')) ||
      'Follow existing patterns in the codebase.';
    const conventions = parseSection(ctx, 'CONVENTIONS', makeSectionRegex('CONVENTIONS')) ||
      'Follow existing code style and conventions.';
    const dependencies = parseSection(ctx, 'DEPENDENCIES', makeSectionRegex('DEPENDENCIES')) ||
      'No specific dependencies identified.';
    const testing = parseSection(ctx, 'TESTING', makeSectionRegex('TESTING')) ||
      'Add appropriate tests for new functionality.';
    const pitfalls = parseSection(ctx, 'PITFALLS', makeSectionRegex('PITFALLS')) ||
      'No specific pitfalls identified.';

    // Parse key files as a list
    const keyFiles = keyFilesRaw
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0 && !line.toLowerCase().startsWith('none'));

    // Extract confidence using centralized parser
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      interpretation,
      spec: {
        context,
        keyFiles,
        patterns,
        conventions,
        dependencies,
        testing,
        pitfalls,
      },
      confidence,
    };
  }

  /**
   * Calculate overall confidence based on sources and LLM confidence.
   */
  private calculateConfidence(pages: RelevantPage[], llmConfidence: number): number {
    if (pages.length === 0) return 0;

    // Average confidence of source pages
    const avgSourceConfidence =
      pages.reduce((sum, p) => sum + p.page.confidence, 0) / pages.length;

    // Average relevance
    const avgRelevance =
      pages.reduce((sum, p) => sum + p.relevance, 0) / pages.length;

    // Combine factors
    return (avgSourceConfidence * 0.3 + avgRelevance * 0.3 + llmConfidence * 0.4);
  }
}

interface RelevantPage {
  page: WikiPage;
  relevance: number;
}

/**
 * Result of generating a spec for a coding task.
 */
export interface SpecResult {
  /** The original task description */
  task: string;
  /** How the task was interpreted */
  interpretation: string;
  /** The generated specification */
  spec: {
    /** Relevant architecture/background context */
    context: string;
    /** Files likely to be involved */
    keyFiles: string[];
    /** Patterns to follow */
    patterns: string;
    /** Code style and naming conventions */
    conventions: string;
    /** Related systems and dependencies */
    dependencies: string;
    /** How to test the changes */
    testing: string;
    /** Things to watch out for */
    pitfalls: string;
  };
  /** Overall confidence in the spec (0-1) */
  confidence: number;
  /** Source pages used to generate the spec */
  sources: Array<{
    path: string;
    title: string;
    relevance: number;
    confidence: number;
  }>;
  /** Number of pages searched */
  searchedPages: number;
  /** Cost in USD */
  costUsd?: number;
}

const SPEC_SYSTEM_PROMPT = `You are a specification generator for CodeWiki. Your job is to analyze a coding task and generate a structured specification that an AI coding agent can use to implement the task effectively.

You will receive:
1. A task description
2. Relevant wiki content about the codebase

Generate a specification with the following sections. Use these EXACT markers:

INTERPRETATION: A clear, concise interpretation of what the task requires. Clarify any ambiguities and state assumptions.

CONTEXT: Relevant architectural background, design decisions, and context that the coding agent needs to understand before implementing. Focus on the "why" behind the existing design.

KEY_FILES: List the specific files or directories that will likely need to be modified or consulted. One per line, using - prefix. If you cannot determine specific files, list relevant areas or patterns to search for.

PATTERNS: Describe the coding patterns, architectural patterns, or conventions the implementation should follow. Reference specific patterns from the wiki if available.

CONVENTIONS: Code style conventions, naming conventions, and structural conventions to follow. Be specific about things like file naming, function naming, import ordering, etc.

DEPENDENCIES: Related systems, services, or components that the implementation might interact with. Note any APIs, interfaces, or contracts that must be maintained.

TESTING: How the changes should be tested. Include specific test patterns used in the codebase, test file locations, and any particular testing approaches.

PITFALLS: Potential issues, edge cases, or common mistakes to avoid. Include any architectural constraints or limitations that might not be obvious.

End with:
CONFIDENCE: [0.0-1.0]

Where confidence reflects how well the wiki content supports generating a useful spec:
- 0.9+: Wiki has excellent coverage of the relevant areas
- 0.7-0.9: Good coverage but some gaps
- 0.5-0.7: Partial coverage, some speculation required
- <0.5: Limited coverage, spec is largely generic

Guidelines:
- Base your specification ONLY on the wiki content provided
- Be specific and actionable - vague advice is not helpful
- If the wiki lacks information about an area, say so explicitly
- Prioritize information that helps with implementation, not theory
- Include file paths and code references when available in the wiki`;

/**
 * Create a spec agent instance.
 */
export function createSpecAgent(
  repos: Repositories,
  llm: LLMService
): SpecAgent {
  return new SpecAgent(repos, llm);
}
