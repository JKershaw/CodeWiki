import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  wikiTools,
  type WikiToolContext,
} from '../../services/llm/wiki-tools.js';
import {
  createParseContext,
  parseConfidence,
} from '../parsing/index.js';

/**
 * Research Agent - An agentic service for querying the wiki.
 *
 * Given a question, it uses tools to iteratively search the wiki,
 * read pages, follow links, and synthesize an answer. This approach
 * allows the LLM to refine searches and explore related content,
 * resulting in higher quality answers than one-shot keyword search.
 *
 * OPTIMIZATION: For small wikis (<20 pages), all content is pre-fetched
 * and included in the prompt, eliminating tool calls. For larger wikis,
 * the top 10-15 most relevant pages (by keyword matching) are included,
 * with tools available as fallback for edge cases.
 *
 * This agent is used by:
 * - Other agents needing context
 * - The MCP endpoint for external AI agents
 * - The CLI query command
 * - The benchmark evaluation system
 */
export class ResearchAgent {
  // Threshold for using prefetch vs tool-based approach
  private readonly SMALL_WIKI_THRESHOLD = 20;
  // Max pages to include in prefetch for larger wikis
  private readonly MAX_PREFETCH_PAGES = 15;
  // Max content length per page in prefetch (chars)
  private readonly MAX_PAGE_CONTENT_LENGTH = 3000;
  // Total max context for prefetched content (chars)
  private readonly MAX_TOTAL_PREFETCH_LENGTH = 40000;

  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService
  ) {}

  /**
   * Answer a question using the wiki content.
   *
   * Uses an optimized approach for small wikis (<20 pages) where all content
   * is pre-fetched into the prompt. For larger wikis, uses keyword matching
   * to select the most relevant pages and includes their full content,
   * with tool fallback for edge cases.
   */
  async query(wikiId: string, question: string): Promise<ResearchResult> {
    // Get all wiki pages for this wiki via CQRS query
    const pagesQuery = createListWikiPagesQuery(wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, this.repos);

    if (!pagesResult.success || !pagesResult.data || pagesResult.data.length === 0) {
      return {
        answer:
          "I don't have enough information in the wiki to answer this question. " +
          'The wiki may need more commits processed to build up relevant content.',
        confidence: 0,
        sources: [],
        searchedPages: 0,
      };
    }

    const allPages = pagesResult.data;

    // Use optimized single-call approach for small wikis or when we can pre-select relevant pages
    if (allPages.length <= this.SMALL_WIKI_THRESHOLD) {
      return this.queryWithPrefetch(question, allPages, allPages);
    }

    // For larger wikis, score and select most relevant pages
    const relevantPages = this.selectRelevantPages(allPages, question);

    // If we found relevant pages, use prefetch approach with tool fallback
    if (relevantPages.length > 0) {
      return this.queryWithPrefetchAndFallback(question, relevantPages, allPages);
    }

    // Fall back to full tool-based approach for complex cases
    return this.queryWithTools(question, allPages);
  }

  /**
   * Optimized query using pre-fetched page content (no tool calls).
   */
  private async queryWithPrefetch(
    question: string,
    relevantPages: WikiPage[],
    allPages: WikiPage[]
  ): Promise<ResearchResult> {
    const prompt = this.buildPrefetchPrompt(question, relevantPages);

    const completion = await this.llm.complete({
      system: RESEARCH_SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3,
    });

    const parsed = this.parseResponse(completion.content);

    // Extract cited sources from the answer
    const sources = this.extractCitedSources(completion.content, relevantPages);

    return {
      answer: parsed.answer,
      confidence: this.calculateConfidence(sources, parsed.confidence),
      sources: sources.slice(0, 10),
      searchedPages: allPages.length,
      costUsd: completion.costUsd,
      toolRounds: 0,
      toolCalls: 0,
    };
  }

  /**
   * Hybrid approach: prefetch relevant pages but allow tool fallback for edge cases.
   */
  private async queryWithPrefetchAndFallback(
    question: string,
    relevantPages: WikiPage[],
    allPages: WikiPage[]
  ): Promise<ResearchResult> {
    // Create wiki tool context for fallback
    const toolContext: WikiToolContext = {
      pages: allPages,
      maxContentLength: 4000,
    };

    const executeTools = async (
      calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    ) => {
      const results = await Promise.all(
        calls.map(async call => {
          const tool = wikiTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          const result = await tool.execute(call.input, toolContext);
          return { id: call.id, result };
        })
      );
      return results;
    };

    const prompt = this.buildPrefetchWithFallbackPrompt(question, relevantPages, allPages.length);

    // Use tools but with limited rounds since we already have most relevant content
    const completion = await this.llm.completeWithTools({
      system: RESEARCH_SYSTEM_PROMPT_HYBRID,
      messages: [{ role: 'user', content: prompt }],
      tools: wikiTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      executeTools,
      maxToolRounds: 1, // Allow 1 round for edge cases
      maxTokens: 2000,
      temperature: 0.3,
    });

    const parsed = this.parseResponse(completion.content);

    // Combine pre-selected pages with any tool-read pages as sources
    const toolReadPaths = this.extractPagesRead(completion.toolCalls);
    const allSourcePaths = [
      ...relevantPages.map(p => p.path),
      ...toolReadPaths,
    ];
    const uniquePaths = [...new Set(allSourcePaths)];

    const sources = uniquePaths.map(path => {
      const page = allPages.find(p => p.path.toLowerCase() === path.toLowerCase());
      return {
        path,
        title: page?.title || path,
        relevance: 1,
        confidence: page?.confidence || 0.5,
      };
    });

    return {
      answer: parsed.answer,
      confidence: this.calculateConfidence(sources, parsed.confidence),
      sources: sources.slice(0, 10),
      searchedPages: allPages.length,
      costUsd: completion.costUsd,
      toolRounds: completion.toolRounds,
      toolCalls: completion.toolCalls.length,
    };
  }

  /**
   * Full tool-based approach for complex queries on large wikis.
   */
  private async queryWithTools(
    question: string,
    allPages: WikiPage[]
  ): Promise<ResearchResult> {
    // Create warm start suggestions using keyword search
    const warmStartSuggestions = this.getWarmStartSuggestions(allPages, question);

    // Create wiki tool context
    const toolContext: WikiToolContext = {
      pages: allPages,
      maxContentLength: 4000,
    };

    // Create tool executor
    const executeTools = async (
      calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    ) => {
      const results = await Promise.all(
        calls.map(async call => {
          const tool = wikiTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          const result = await tool.execute(call.input, toolContext);
          return { id: call.id, result };
        })
      );
      return results;
    };

    // Build initial prompt with warm start
    const prompt = this.buildPrompt(question, warmStartSuggestions, allPages.length);

    // Use LLM with tools for agentic research
    const completion = await this.llm.completeWithTools({
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      tools: wikiTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      executeTools,
      maxToolRounds: 5,
      maxTokens: 2000,
      temperature: 0.3,
    });

    // Parse the response
    const parsed = this.parseResponse(completion.content);

    // Extract sources from tool calls
    const pagesRead = this.extractPagesRead(completion.toolCalls);
    const sources = pagesRead.map(path => {
      const page = allPages.find(p => p.path.toLowerCase() === path.toLowerCase());
      return {
        path,
        title: page?.title || path,
        relevance: 1, // All read pages are considered relevant
        confidence: page?.confidence || 0.5,
      };
    });

    return {
      answer: parsed.answer,
      confidence: this.calculateConfidence(sources, parsed.confidence),
      sources: sources.slice(0, 10),
      searchedPages: allPages.length,
      costUsd: completion.costUsd,
      toolRounds: completion.toolRounds,
      toolCalls: completion.toolCalls.length,
    };
  }

  /**
   * Select the most relevant pages for a question using keyword scoring.
   */
  private selectRelevantPages(pages: WikiPage[], question: string): WikiPage[] {
    const keywords = this.extractKeywords(question);

    if (keywords.length === 0) {
      // No keywords extracted, return empty to trigger tool-based fallback
      return [];
    }

    // Score pages by keyword relevance
    const scored = pages.map(page => {
      const lowerTitle = page.title.toLowerCase();
      const lowerPath = page.path.toLowerCase();
      const lowerContent = page.content.toLowerCase();

      let score = 0;
      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword)) score += 5;
        if (lowerPath.includes(keyword)) score += 3;
        const matches = (lowerContent.match(new RegExp(keyword, 'g')) || []).length;
        score += Math.min(matches * 0.5, 5);
      }
      // Boost by page confidence
      score *= 0.5 + page.confidence * 0.5;

      return { page, score };
    });

    // Get top relevant pages that fit within context limits
    const relevant = scored
      .filter(s => s.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.MAX_PREFETCH_PAGES);

    // Check total content size and trim if needed
    let totalLength = 0;
    const selected: WikiPage[] = [];

    for (const { page } of relevant) {
      const pageLength = Math.min(page.content.length, this.MAX_PAGE_CONTENT_LENGTH);
      if (totalLength + pageLength > this.MAX_TOTAL_PREFETCH_LENGTH) {
        break;
      }
      selected.push(page);
      totalLength += pageLength;
    }

    return selected;
  }

  /**
   * Build prompt with full page content for prefetch approach.
   */
  private buildPrefetchPrompt(question: string, pages: WikiPage[]): string {
    const sections: string[] = [];

    sections.push(`## Question\n${question}`);

    sections.push(`\n## Wiki Content\nThe following ${pages.length} wiki pages are available:\n`);

    for (const page of pages) {
      const content = page.content.length > this.MAX_PAGE_CONTENT_LENGTH
        ? page.content.slice(0, this.MAX_PAGE_CONTENT_LENGTH) + '\n\n[Content truncated...]'
        : page.content;

      sections.push(`### ${page.title} (${page.path})`);
      sections.push(`Confidence: ${(page.confidence * 100).toFixed(0)}%\n`);
      sections.push(content);
      sections.push('\n---\n');
    }

    sections.push('\n## Instructions');
    sections.push(
      'Answer the question using the wiki content provided above. ' +
      'Cite specific pages when relevant (use the page paths). ' +
      'If the information is not available in the provided pages, say so clearly.'
    );

    return sections.join('\n');
  }

  /**
   * Build prompt with prefetched content and tool fallback instructions.
   */
  private buildPrefetchWithFallbackPrompt(
    question: string,
    relevantPages: WikiPage[],
    totalPages: number
  ): string {
    const sections: string[] = [];

    sections.push(`## Question\n${question}`);

    sections.push(`\n## Most Relevant Wiki Pages (${relevantPages.length} of ${totalPages} total)\n`);
    sections.push('These pages were selected as most likely to contain relevant information:\n');

    for (const page of relevantPages) {
      const content = page.content.length > this.MAX_PAGE_CONTENT_LENGTH
        ? page.content.slice(0, this.MAX_PAGE_CONTENT_LENGTH) + '\n\n[Content truncated...]'
        : page.content;

      sections.push(`### ${page.title} (${page.path})`);
      sections.push(`Confidence: ${(page.confidence * 100).toFixed(0)}%\n`);
      sections.push(content);
      sections.push('\n---\n');
    }

    sections.push('\n## Instructions');
    sections.push(
      'Answer the question using the wiki content provided above. ' +
      'If the answer is contained in the provided pages, respond directly without using tools. ' +
      'Only use the search/read tools if the provided pages do not contain the needed information. ' +
      'Cite specific pages when relevant (use the page paths).'
    );

    return sections.join('\n');
  }

  /**
   * Extract sources that were cited in the answer text.
   */
  private extractCitedSources(
    answer: string,
    availablePages: WikiPage[]
  ): Array<{ path: string; title: string; relevance: number; confidence: number }> {
    const sources: Array<{ path: string; title: string; relevance: number; confidence: number }> = [];
    const seen = new Set<string>();

    for (const page of availablePages) {
      // Check if page path or title is mentioned in the answer
      if (
        !seen.has(page.path) &&
        (answer.toLowerCase().includes(page.path.toLowerCase()) ||
         answer.toLowerCase().includes(page.title.toLowerCase()))
      ) {
        sources.push({
          path: page.path,
          title: page.title,
          relevance: 1,
          confidence: page.confidence,
        });
        seen.add(page.path);
      }
    }

    // If no explicit citations found, include all provided pages as potential sources
    if (sources.length === 0) {
      for (const page of availablePages.slice(0, 5)) {
        sources.push({
          path: page.path,
          title: page.title,
          relevance: 0.5,
          confidence: page.confidence,
        });
      }
    }

    return sources;
  }

  /**
   * Get warm start suggestions using keyword-based search.
   * These give the LLM initial pages to consider before exploring further.
   */
  private getWarmStartSuggestions(
    pages: WikiPage[],
    question: string
  ): Array<{ title: string; path: string; snippet: string }> {
    const keywords = this.extractKeywords(question);

    if (keywords.length === 0) {
      return [];
    }

    // Score pages by keyword relevance
    const scored = pages.map(page => {
      const lowerTitle = page.title.toLowerCase();
      const lowerPath = page.path.toLowerCase();
      const lowerContent = page.content.toLowerCase();

      let score = 0;
      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword)) score += 3;
        if (lowerPath.includes(keyword)) score += 2;
        const matches = (lowerContent.match(new RegExp(keyword, 'g')) || []).length;
        score += Math.min(matches * 0.5, 3);
      }
      score *= 0.5 + page.confidence * 0.5;

      return { page, score };
    });

    // Return top 3 as warm start
    return scored
      .filter(s => s.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ page }) => ({
        title: page.title,
        path: page.path,
        snippet: this.extractSnippet(page.content, keywords[0] || ''),
      }));
  }

  /**
   * Extract keywords from a question.
   */
  private extractKeywords(question: string): string[] {
    const stopWords = new Set([
      'what',
      'why',
      'how',
      'when',
      'where',
      'who',
      'which',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'a',
      'an',
      'the',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'into',
      'about',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'we',
      'they',
      'it',
      'my',
      'our',
      'your',
      'can',
      'could',
      'would',
      'should',
      'will',
      'shall',
    ]);

    return question
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Extract a snippet from content around a keyword.
   */
  private extractSnippet(content: string, keyword: string, length: number = 150): string {
    const lowerContent = content.toLowerCase();
    const index = keyword ? lowerContent.indexOf(keyword.toLowerCase()) : -1;

    if (index === -1) {
      return content.slice(0, length) + (content.length > length ? '...' : '');
    }

    const start = Math.max(0, index - length / 2);
    const end = Math.min(content.length, index + length / 2);

    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Build the initial prompt with warm start suggestions.
   */
  private buildPrompt(
    question: string,
    warmStart: Array<{ title: string; path: string; snippet: string }>,
    totalPages: number
  ): string {
    const sections: string[] = [];

    sections.push(`## Question\n${question}`);

    sections.push(`\n## Wiki Overview\nThe wiki contains ${totalPages} pages.`);

    if (warmStart.length > 0) {
      sections.push('\n## Suggested Starting Points');
      sections.push(
        'Based on initial keyword matching, these pages might be relevant (but explore further if needed):\n'
      );
      for (const suggestion of warmStart) {
        sections.push(`- **${suggestion.title}** (${suggestion.path})`);
        sections.push(`  ${suggestion.snippet}\n`);
      }
    }

    sections.push('\n## Instructions');
    sections.push(
      'Use the available tools to research this question. You can search for pages, ' +
        'read their full content, list pages by category, and follow links to related pages. ' +
        'Try different search terms if initial results are not helpful. ' +
        'Once you have gathered enough information, synthesize a complete answer.'
    );

    return sections.join('\n');
  }

  /**
   * Extract the paths of pages that were read via tool calls.
   */
  private extractPagesRead(
    toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>
  ): string[] {
    const paths: string[] = [];

    for (const call of toolCalls) {
      if (call.name === 'read_page') {
        const path = call.input['path'] as string;
        if (path && !call.result.includes('not found')) {
          paths.push(path);
        }
      }
    }

    return [...new Set(paths)]; // Deduplicate
  }

  /**
   * Parse the LLM response.
   */
  private parseResponse(response: string): { answer: string; confidence: number } {
    const ctx = createParseContext('research', response);

    // Parse confidence using centralized parser
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    // Remove confidence line from answer
    let answer = response.replace(/CONFIDENCE:\s*[\d.]+/i, '').trim();

    // Also handle ANSWER: prefix if present
    answer = answer.replace(/^ANSWER:\s*/i, '').trim();

    return { answer, confidence };
  }

  /**
   * Calculate overall confidence based on sources and LLM confidence.
   */
  private calculateConfidence(
    sources: Array<{ confidence: number }>,
    llmConfidence: number
  ): number {
    if (sources.length === 0) return llmConfidence * 0.5;

    // Average confidence of source pages
    const avgSourceConfidence =
      sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length;

    // Combine factors - weight LLM confidence more since it's making the final judgment
    return avgSourceConfidence * 0.4 + llmConfidence * 0.6;
  }
}

/**
 * Result of a research query.
 */
export interface ResearchResult {
  /** The synthesized answer */
  answer: string;
  /** Overall confidence in the answer (0-1) */
  confidence: number;
  /** Source pages used to generate the answer */
  sources: Array<{
    path: string;
    title: string;
    relevance: number;
    confidence: number;
  }>;
  /** Number of pages in the wiki */
  searchedPages: number;
  /** Cost of the query in USD */
  costUsd?: number;
  /** Number of tool rounds used (for agentic research) */
  toolRounds?: number;
  /** Total number of tool calls made */
  toolCalls?: number;
}

const RESEARCH_SYSTEM_PROMPT = `You are a research assistant for CodeWiki, a system that generates documentation from Git repositories.

Your job is to answer questions about a codebase using the wiki. You have tools to explore the wiki:
- search_wiki: Search for pages by keywords or concepts
- read_page: Read the full content of a specific page
- list_pages: See all pages or filter by category
- get_related_pages: Find pages linked to/from a given page

## Research Strategy
1. Start with the suggested pages if they look relevant
2. Search for key concepts from the question
3. Read promising pages to understand the content
4. Follow links to related pages for additional context
5. Try alternative search terms if initial results don't help
6. Once you understand the topic, synthesize your answer

## Guidelines
- Be thorough - explore multiple pages before answering
- If the wiki doesn't contain relevant information, say so clearly
- Cite specific pages when relevant (use the page paths)
- If information seems low-confidence or incomplete, mention that
- Focus on answering the question directly

## Response Format
After researching, provide:
1. A clear, direct answer to the question
2. Supporting details from the wiki
3. Any caveats or limitations

End your response with a confidence score:
CONFIDENCE: [0.0-1.0]

Where:
- 0.9+: Answer is well-supported by multiple high-confidence sources
- 0.7-0.9: Answer is supported but may have gaps
- 0.5-0.7: Answer is partially supported, some inference required
- <0.5: Limited information available, answer is speculative`;

/**
 * System prompt for prefetch approach (all content provided, no tools).
 */
const RESEARCH_SYSTEM_PROMPT_PREFETCH = `You are a research assistant for CodeWiki, a system that generates documentation from Git repositories.

Your job is to answer questions about a codebase using wiki content that has been provided to you. The wiki pages and their content are included in the prompt - you do not need tools to access them.

## Guidelines
- Read through the provided wiki pages to find relevant information
- If the wiki doesn't contain relevant information, say so clearly
- Cite specific pages when relevant (use the page paths like "auth/jwt" or "api/endpoints")
- If information seems low-confidence or incomplete, mention that
- Focus on answering the question directly

## Response Format
Provide:
1. A clear, direct answer to the question
2. Supporting details from the wiki
3. Any caveats or limitations

End your response with a confidence score:
CONFIDENCE: [0.0-1.0]

Where:
- 0.9+: Answer is well-supported by multiple high-confidence sources
- 0.7-0.9: Answer is supported but may have gaps
- 0.5-0.7: Answer is partially supported, some inference required
- <0.5: Limited information available, answer is speculative`;

/**
 * System prompt for hybrid approach (prefetched content with optional tool fallback).
 */
const RESEARCH_SYSTEM_PROMPT_HYBRID = `You are a research assistant for CodeWiki, a system that generates documentation from Git repositories.

Your job is to answer questions about a codebase using wiki content. The most relevant wiki pages have been pre-selected and their content is provided in the prompt. You also have access to tools if you need to explore further.

## Available Tools (use only if needed)
- search_wiki: Search for pages by keywords or concepts
- read_page: Read the full content of a specific page
- list_pages: See all pages or filter by category
- get_related_pages: Find pages linked to/from a given page

## Strategy
1. First, check if the provided pages contain the answer
2. If yes, respond directly without using tools
3. Only use tools if the provided pages don't contain the needed information
4. This approach is faster and more efficient

## Guidelines
- Prefer using the provided content over making tool calls
- Cite specific pages when relevant (use the page paths)
- If information seems low-confidence or incomplete, mention that
- Focus on answering the question directly

## Response Format
Provide:
1. A clear, direct answer to the question
2. Supporting details from the wiki
3. Any caveats or limitations

End your response with a confidence score:
CONFIDENCE: [0.0-1.0]

Where:
- 0.9+: Answer is well-supported by multiple high-confidence sources
- 0.7-0.9: Answer is supported but may have gaps
- 0.5-0.7: Answer is partially supported, some inference required
- <0.5: Limited information available, answer is speculative`;

/**
 * Create a research agent instance.
 */
export function createResearchAgent(repos: Repositories, llm: LLMService): ResearchAgent {
  return new ResearchAgent(repos, llm);
}
