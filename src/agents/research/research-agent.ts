import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { WikiPage } from '../../domain/wiki-page.js';

/**
 * Research Agent - A shared service for querying the wiki.
 *
 * Given a question, it searches the wiki, synthesizes relevant information,
 * and returns a coherent answer with confidence indicators and source references.
 *
 * This agent is used by:
 * - Other agents needing context
 * - The MCP endpoint for external AI agents
 * - The CLI query command
 */
export class ResearchAgent {
  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService
  ) {}

  /**
   * Answer a question using the wiki content.
   */
  async query(repoId: string, question: string): Promise<ResearchResult> {
    // Search for relevant wiki pages
    const relevantPages = await this.findRelevantPages(repoId, question);

    if (relevantPages.length === 0) {
      return {
        answer: "I don't have enough information in the wiki to answer this question. The wiki may need more commits processed to build up relevant content.",
        confidence: 0,
        sources: [],
        searchedPages: 0,
      };
    }

    // Build context from relevant pages
    const context = this.buildContext(relevantPages);

    // Use LLM to synthesize an answer
    const completion = await this.llm.complete({
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\n\n${context}`,
        },
      ],
      maxTokens: 1500,
      temperature: 0.3,
    });

    // Parse the response
    const parsed = this.parseResponse(completion.content);

    return {
      answer: parsed.answer,
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
   * Find wiki pages relevant to the question.
   */
  private async findRelevantPages(
    repoId: string,
    question: string
  ): Promise<RelevantPage[]> {
    // Get all wiki pages for this repo
    const allPages = await this.repos.wikiPages.findByRepo(repoId);

    if (allPages.length === 0) {
      return [];
    }

    // Extract keywords from the question
    const keywords = this.extractKeywords(question);

    // Score each page by relevance
    const scored: RelevantPage[] = allPages.map(page => ({
      page,
      relevance: this.scoreRelevance(page, keywords, question),
    }));

    // Sort by relevance and filter out low-relevance pages
    return scored
      .filter(p => p.relevance > 0.1)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Top 10 most relevant
  }

  /**
   * Extract keywords from a question.
   */
  private extractKeywords(question: string): string[] {
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
    ]);

    return question
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Score a page's relevance to the question.
   */
  private scoreRelevance(
    page: WikiPage,
    keywords: string[],
    question: string
  ): number {
    const lowerContent = page.content.toLowerCase();
    const lowerTitle = page.title.toLowerCase();
    const lowerPath = page.path.toLowerCase();
    const lowerQuestion = question.toLowerCase();

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

    for (const { page, relevance } of pages.slice(0, 5)) {
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
  /** Number of pages searched */
  searchedPages: number;
  /** Cost of the query in USD */
  costUsd?: number;
}

const RESEARCH_SYSTEM_PROMPT = `You are a research assistant for CodeWiki, a system that generates documentation from Git repositories.

Your job is to answer questions about the codebase using the wiki content provided. You have access to wiki pages that were generated from analyzing commits.

Guidelines:
- Answer based ONLY on the wiki content provided
- If the wiki doesn't contain enough information, say so clearly
- Be concise but thorough
- Cite specific pages when relevant (use the page paths)
- If information seems outdated or low-confidence, mention that
- Focus on the "why" behind decisions, not just the "what"

Format your response as:
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
export function createResearchAgent(
  repos: Repositories,
  llm: LLMService
): ResearchAgent {
  return new ResearchAgent(repos, llm);
}
