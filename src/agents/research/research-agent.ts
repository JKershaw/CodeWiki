import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  wikiTools,
  type WikiToolContext,
  type WikiToolDefinition,
} from '../../services/llm/wiki-tools.js';

/**
 * Research Agent - An agentic service for querying the wiki.
 *
 * Given a question, it uses tools to iteratively search the wiki,
 * read pages, follow links, and synthesize an answer. This approach
 * allows the LLM to refine searches and explore related content,
 * resulting in higher quality answers than one-shot keyword search.
 *
 * This agent is used by:
 * - Other agents needing context
 * - The MCP endpoint for external AI agents
 * - The CLI query command
 * - The benchmark evaluation system
 */
export class ResearchAgent {
  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService
  ) {}

  /**
   * Answer a question using the wiki content via agentic exploration.
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
    // Look for structured confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]!) : 0.7;

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
 * Create a research agent instance.
 */
export function createResearchAgent(repos: Repositories, llm: LLMService): ResearchAgent {
  return new ResearchAgent(repos, llm);
}
