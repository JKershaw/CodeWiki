/**
 * Page Evaluator - Non-agentic quality evaluation of wiki pages.
 *
 * Evaluates a single wiki page across all 8 quality dimensions
 * using a single LLM call (no tool-calling loops).
 */

import type { LLMService } from '../services/llm/llm-service.js';
import type { WikiPage } from '../domain/wiki-page.js';
import {
  type PageQualityResult,
  type QualityDimension,
  QUALITY_DIMENSIONS,
  DIMENSION_NAMES,
  DIMENSION_DESCRIPTIONS,
  createEmptyPageResult,
} from '../domain/quality-benchmark.js';

/**
 * Context about the wiki for coherence/consistency evaluation.
 */
export interface WikiContext {
  /** Total number of pages in the wiki */
  totalPages: number;
  /** Average confidence across all pages */
  averageConfidence: number;
  /** Confidence distribution buckets */
  confidenceDistribution: {
    low: number; // < 0.4
    medium: number; // 0.4 - 0.7
    high: number; // > 0.7
  };
  /** Titles of pages this page links to */
  linkedPageTitles: string[];
  /** Titles of pages that link to this page */
  backlinkPageTitles: string[];
  /** Sample of other page titles for terminology comparison */
  samplePageTitles: string[];
}

/**
 * Page Evaluator that scores pages on quality dimensions.
 */
export class PageEvaluator {
  constructor(private readonly llm: LLMService) {}

  /**
   * Evaluate a single page across all quality dimensions.
   */
  async evaluate(page: WikiPage, context: WikiContext): Promise<PageQualityResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(page, context);

      const completion = await this.llm.complete({
        system: EVALUATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4000,
        temperature: 0.3,
      });

      const parsed = this.parseResponse(completion.content);
      const durationMs = Date.now() - startTime;

      return {
        pageId: page.id,
        pagePath: page.path,
        pageTitle: page.title,
        scores: parsed.scores,
        reasoning: parsed.reasoning,
        findings: parsed.findings,
        durationMs,
        costUsd: completion.costUsd,
      };
    } catch (error) {
      return createEmptyPageResult(
        page.id,
        page.path,
        page.title,
        String(error)
      );
    }
  }

  /**
   * Build the evaluation prompt for a page.
   */
  private buildPrompt(page: WikiPage, context: WikiContext): string {
    const sections: string[] = [];

    // Page information
    sections.push(`# Page to Evaluate

**Path:** ${page.path}
**Title:** ${page.title}
**Confidence Score:** ${(page.confidence * 100).toFixed(0)}%
**Links to:** ${page.links.length} pages
**Linked from:** ${page.backlinks.length} pages
**Last Updated:** ${page.updatedAt.toISOString()}

## Content

${page.content}
`);

    // Wiki context
    sections.push(`# Wiki Context

- **Total Pages:** ${context.totalPages}
- **Average Confidence:** ${(context.averageConfidence * 100).toFixed(0)}%
- **Confidence Distribution:** ${context.confidenceDistribution.low} low, ${context.confidenceDistribution.medium} medium, ${context.confidenceDistribution.high} high

**This page links to:** ${context.linkedPageTitles.length > 0 ? context.linkedPageTitles.join(', ') : 'None'}
**Pages linking here:** ${context.backlinkPageTitles.length > 0 ? context.backlinkPageTitles.join(', ') : 'None'}
**Other pages in wiki:** ${context.samplePageTitles.slice(0, 10).join(', ')}${context.samplePageTitles.length > 10 ? '...' : ''}
`);

    // Scoring rubric
    sections.push(`# Scoring Instructions

Rate this page on each of the 8 quality dimensions below. For each dimension, provide a score from 0-100.

## Dimensions and Rubric
`);

    for (const dim of QUALITY_DIMENSIONS) {
      sections.push(`### ${DIMENSION_NAMES[dim]}
${DIMENSION_DESCRIPTIONS[dim]}

Scoring guide:
- **80-100:** Excellent - fully meets or exceeds expectations
- **60-79:** Good - meets most expectations with minor gaps
- **40-59:** Fair - partially meets expectations, notable gaps
- **20-39:** Poor - significant gaps or issues
- **0-19:** Very poor - fails to meet expectations
`);
    }

    // Output format
    sections.push(`# Required Output Format

Provide your evaluation in EXACTLY this format:

SCORES:
contextual_richness=[0-100]
coherence_consistency=[0-100]
completeness_coverage=[0-100]
actionability=[0-100]
structural_quality=[0-100]
confidence_calibration=[0-100]
machine_readability=[0-100]
information_density=[0-100]

FINDINGS:
- [Specific finding or issue 1]
- [Specific finding or issue 2]
- [Add more as needed, or "None" if no issues]

REASONING:
[2-4 sentences explaining the overall quality assessment and key factors]
`);

    return sections.join('\n');
  }

  /**
   * Parse the LLM response into structured scores.
   */
  private parseResponse(response: string): {
    scores: Record<QualityDimension, number>;
    reasoning: string;
    findings: string[];
  } {
    const scores = {} as Record<QualityDimension, number>;

    // Initialize with default scores
    for (const dim of QUALITY_DIMENSIONS) {
      scores[dim] = 50; // Default to middle score
    }

    // Parse scores section
    const scoresMatch = response.match(/SCORES:\s*([\s\S]*?)(?=FINDINGS:|REASONING:|$)/i);
    if (scoresMatch) {
      const scoresText = scoresMatch[1]!;
      for (const dim of QUALITY_DIMENSIONS) {
        const dimMatch = scoresText.match(new RegExp(`${dim}\\s*=\\s*(\\d+)`, 'i'));
        if (dimMatch) {
          const score = parseInt(dimMatch[1]!, 10);
          scores[dim] = Math.max(0, Math.min(100, score)); // Clamp to 0-100
        }
      }
    }

    // Parse findings section
    const findings: string[] = [];
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=REASONING:|$)/i);
    if (findingsMatch) {
      const findingsText = findingsMatch[1]!.trim();
      const lines = findingsText.split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned && cleaned.toLowerCase() !== 'none') {
          findings.push(cleaned);
        }
      }
    }

    // Parse reasoning section
    let reasoning = '';
    const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)$/i);
    if (reasoningMatch) {
      reasoning = reasoningMatch[1]!.trim();
      // Truncate if too long
      if (reasoning.length > 1000) {
        reasoning = reasoning.slice(0, 1000) + '...';
      }
    }

    return { scores, reasoning, findings };
  }
}

const EVALUATOR_SYSTEM_PROMPT = `You are a documentation quality evaluator for CodeWiki, a system that generates wiki documentation from Git repositories.

Your job is to evaluate wiki pages across 8 quality dimensions. Be rigorous but fair in your assessment.

## Evaluation Principles

1. **Be objective** - Base scores on concrete evidence in the content
2. **Be specific** - Cite specific examples when noting issues
3. **Consider context** - A page about a simple utility has different needs than one about core architecture
4. **Reward substance** - Value insight and explanation over length
5. **Penalize fluff** - Boilerplate, repetition, and vague statements lower quality

## Quality Dimension Guidelines

**Contextual Richness:** Look for "why" explanations, decision rationale, trade-offs discussed, alternatives mentioned, historical context. Purely descriptive content (just "what") scores lower.

**Coherence & Consistency:** Check terminology usage, whether links make sense, if the content flows logically. Note any contradictions or confusing structure.

**Completeness Coverage:** For the topic at hand, is it sufficiently covered? Are there obvious gaps? Does depth match complexity?

**Actionability:** Are there examples, code snippets, step-by-step guidance? Could someone use this to actually do something?

**Structural Quality:** Is it well-organized? Good headings? Appropriate sections? Easy to scan and find information?

**Confidence Calibration:** Does the stated confidence score (if any) seem appropriate? Are uncertainties acknowledged?

**Machine Readability:** Consistent formatting? Clear structure an AI could parse? Explicit relationships stated?

**Information Density:** Signal vs noise. Concise? No unnecessary repetition? Every paragraph adds value?

## Important Notes

- Score each dimension independently
- A page can score high on some dimensions and low on others
- Short pages can score well if they're dense with quality content
- Long pages can score poorly if they're padded with fluff
- Consider what the page is trying to achieve when scoring completeness`;

/**
 * Create a page evaluator instance.
 */
export function createPageEvaluator(llm: LLMService): PageEvaluator {
  return new PageEvaluator(llm);
}

/**
 * Build wiki context from pages.
 */
export function buildWikiContext(
  allPages: WikiPage[],
  targetPage: WikiPage
): WikiContext {
  // Calculate average confidence
  const avgConfidence =
    allPages.length > 0
      ? allPages.reduce((sum, p) => sum + p.confidence, 0) / allPages.length
      : 0;

  // Calculate confidence distribution
  const distribution = { low: 0, medium: 0, high: 0 };
  for (const page of allPages) {
    if (page.confidence < 0.4) distribution.low++;
    else if (page.confidence <= 0.7) distribution.medium++;
    else distribution.high++;
  }

  // Get linked page titles
  const pagesByPath = new Map(allPages.map(p => [p.path.toLowerCase(), p]));
  const linkedPageTitles = targetPage.links
    .map(link => pagesByPath.get(link.toLowerCase())?.title)
    .filter((t): t is string => !!t);

  // Get backlink page titles
  const backlinkPageTitles = targetPage.backlinks
    .map(link => pagesByPath.get(link.toLowerCase())?.title)
    .filter((t): t is string => !!t);

  // Sample other page titles (excluding target)
  const otherPages = allPages.filter(p => p.id !== targetPage.id);
  const samplePageTitles = otherPages
    .slice(0, 20)
    .map(p => p.title);

  return {
    totalPages: allPages.length,
    averageConfidence: avgConfidence,
    confidenceDistribution: distribution,
    linkedPageTitles,
    backlinkPageTitles,
    samplePageTitles,
  };
}
