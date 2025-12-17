import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createParseContext,
  parseListItemsWithFallback,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Quality Agent - Reviews wiki content quality and suggests improvements.
 *
 * This meta-agent examines wiki pages for:
 * - Content clarity and readability
 * - Proper source citations (commit refs, file paths)
 * - Completeness (no empty sections)
 * - Low confidence pages needing attention
 * - Writing style consistency
 */
export class QualityAgent implements Agent {
  readonly type: AgentType = 'quality';

  // Thresholds
  // MIN_CONTENT_LENGTH aligned with context-gatherer's shallow page threshold (500)
  private readonly MIN_CONTENT_LENGTH = 100;
  private readonly SHALLOW_CONTENT_LENGTH = 500;  // Pages < this need depth work
  private readonly LOW_CONFIDENCE_THRESHOLD = 0.5;
  private readonly MAX_PAGES_PER_RUN = 10;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`QualityAgent cannot handle target type: ${target.type}`);
    }

    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages for quality analysis',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Find pages that need quality review
    const pagesToReview = this.selectPagesForReview(pages);

    if (pagesToReview.length === 0) {
      return {
        result: createAgentResult({
          summary: 'All pages meet quality standards',
          findings: [],
          confidence: 0.9,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Quick checks (no LLM needed)
    const quickIssues = this.runQuickChecks(pagesToReview);

    // LLM-based quality analysis for pages with issues
    const prompt = this.buildPrompt(pagesToReview, quickIssues);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const analysis = this.parseResponse(completion.content);

    // Generate improved content for pages with issues (makes additional LLM calls)
    const { updates, additionalCost } = await this.generateUpdates(pagesToReview, analysis, context);

    return {
      result: createAgentResult({
        summary: `Reviewed ${pagesToReview.length} pages, found ${quickIssues.length + analysis.issues.length} quality issues`,
        findings: [
          ...quickIssues.map(issue => createFinding({
            type: 'QUALITY',
            description: issue.description,
            relatedPaths: [issue.pagePath],
            importance: issue.severity,
          })),
          ...analysis.issues.map(issue => createFinding({
            type: 'QUALITY',
            description: issue.description,
            relatedPaths: [issue.pagePath],
            importance: issue.severity,
          })),
        ],
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd + additionalCost,
    };
  }

  private selectPagesForReview(pages: WikiPage[]): WikiPage[] {
    // Prioritize: low confidence, recently updated, short content
    const scored = pages.map(page => ({
      page,
      score: this.calculateReviewPriority(page),
    }));

    // Only review pages that have at least one quality concern (score > 0)
    const pagesWithIssues = scored.filter(s => s.score > 0);
    pagesWithIssues.sort((a, b) => b.score - a.score);

    return pagesWithIssues
      .slice(0, this.MAX_PAGES_PER_RUN)
      .map(s => s.page);
  }

  private calculateReviewPriority(page: WikiPage): number {
    let score = 0;

    // Low confidence = high priority
    if (page.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
      score += 3;
    } else if (page.confidence < 0.7) {
      score += 1;
    }

    // Very short content = might be incomplete
    if (page.content.length < this.MIN_CONTENT_LENGTH) {
      score += 3;  // Highest priority for extremely short
    } else if (page.content.length < this.SHALLOW_CONTENT_LENGTH) {
      // Shallow content (100-500 chars) = needs depth work
      score += 2;
    }

    // Has empty sections
    if (this.hasEmptySections(page.content)) {
      score += 2;
    }

    // No source citations
    if (!this.hasSourceCitations(page.content)) {
      score += 1;
    }

    // No code examples (critical for actionability)
    if (!this.hasCodeExamples(page.content)) {
      score += 2;
    }

    return score;
  }

  private runQuickChecks(pages: WikiPage[]): QualityIssue[] {
    const issues: QualityIssue[] = [];

    for (const page of pages) {
      // Check for empty sections
      if (this.hasEmptySections(page.content)) {
        issues.push({
          pagePath: page.path,
          type: 'empty_section',
          description: `Page "${page.title}" has empty sections that should be filled or removed`,
          severity: 'medium',
        });
      }

      // Check for very short content
      if (page.content.length < this.MIN_CONTENT_LENGTH) {
        issues.push({
          pagePath: page.path,
          type: 'too_short',
          description: `Page "${page.title}" has very little content (${page.content.length} chars)`,
          severity: 'high',
        });
      } else if (page.content.length < this.SHALLOW_CONTENT_LENGTH) {
        // Check for shallow content (100-500 chars) - needs depth
        issues.push({
          pagePath: page.path,
          type: 'shallow',
          description: `Page "${page.title}" is shallow (${page.content.length} chars) and needs more depth`,
          severity: 'medium',
        });
      }

      // Check for missing source citations in non-overview pages
      if (!page.path.includes('overview') && !this.hasSourceCitations(page.content)) {
        issues.push({
          pagePath: page.path,
          type: 'no_citations',
          description: `Page "${page.title}" has no source citations (commit refs or file paths)`,
          severity: 'low',
        });
      }

      // Check for missing code examples in non-overview pages
      if (!page.path.includes('overview') && !this.hasCodeExamples(page.content)) {
        issues.push({
          pagePath: page.path,
          type: 'no_examples',
          description: `Page "${page.title}" has no code examples - this reduces actionability`,
          severity: 'medium',
        });
      }

      // Check for low confidence
      if (page.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
        issues.push({
          pagePath: page.path,
          type: 'low_confidence',
          description: `Page "${page.title}" has low confidence (${(page.confidence * 100).toFixed(0)}%) and needs verification`,
          severity: 'medium',
        });
      }
    }

    return issues;
  }

  private hasEmptySections(content: string): boolean {
    // Look for section headers followed immediately by another header or end
    const emptySection = /^##+ .+\n\n(?=##|$)/gm;
    return emptySection.test(content);
  }

  private hasSourceCitations(content: string): boolean {
    // Look for commit refs, file paths, or explicit citations
    const hasCommitRef = /commit [a-f0-9]{7,}/i.test(content);
    const hasFilePath = /`[^`]+\.(ts|js|md|json|tsx|jsx)`/.test(content);
    const hasCitation = /\*(?:Source|From|Updated from|Captured from)/.test(content);

    return hasCommitRef || hasFilePath || hasCitation;
  }

  private hasCodeExamples(content: string): boolean {
    // Look for fenced code blocks (```language or just ```)
    return /```[\s\S]*?```/.test(content);
  }

  private buildPrompt(pages: WikiPage[], quickIssues: QualityIssue[]): string {
    return `Review these wiki pages for content quality issues.

## Pages to Review

${pages.map(p => `### ${p.path}
**Title:** ${p.title}
**Confidence:** ${(p.confidence * 100).toFixed(0)}%
**Content:**
${p.content.slice(0, 1500)}
${p.content.length > 1500 ? '... (truncated)' : ''}
---`).join('\n\n')}

## Already Identified Issues

${quickIssues.length > 0 ? quickIssues.map(i => `- [${i.severity}] ${i.pagePath}: ${i.description}`).join('\n') : 'None'}

## Your Task

Review each page for:
1. **Clarity**: Is the content clear and well-written?
2. **Accuracy**: Does the content seem accurate based on what's described?
3. **Completeness**: Are there missing pieces that should be added?
4. **Usefulness**: Would a developer find this helpful?
5. **Depth**: Does the page explain HOW things work, or just WHAT exists?
6. **Improvements**: What specific changes would improve each page?

FLAG pages that:
- Describe something without explaining its mechanism
- Lack usage examples or configuration details
- Are too abstract to be actionable

## Required Output Format

ISSUES:
- severity: high | page: docs/auth | Description of the issue

IMPROVEMENTS:
- page: docs/auth | Specific improvement suggestion

CONFIDENCE: [0-1]
`;
  }

  private parseResponse(response: string): QualityAnalysis {
    const ctx = createParseContext('quality', response);

    // Parse issues - pipe-separated format
    const issuePatterns: ItemPattern<QualityIssue>[] = [
      {
        // New format: - severity: high | page: docs/auth | Description
        pattern: /^-\s*severity:\s*(\w+)\s*\|\s*page:\s*([^|]+)\s*\|\s*(.+)$/i,
        mapper: (m) => ({
          pagePath: m[2]!.trim(),
          type: 'content_quality',
          description: m[3]!.trim(),
          severity: m[1]!.toLowerCase() as 'high' | 'medium' | 'low',
        }),
      },
    ];

    const issues = parseListItemsWithFallback(
      ctx,
      'ISSUES',
      /ISSUES:\s*([\s\S]*?)(?=IMPROVEMENTS:|CONFIDENCE:|$)/i,
      issuePatterns
    );

    // Parse improvements - pipe-separated format
    const improvementPatterns: ItemPattern<{ pagePath: string; suggestion: string }>[] = [
      {
        // New format: - page: docs/auth | Suggestion
        pattern: /^-\s*page:\s*([^|]+)\s*\|\s*(.+)$/i,
        mapper: (m) => ({
          pagePath: m[1]!.trim(),
          suggestion: m[2]!.trim(),
        }),
      },
    ];

    const improvements = parseListItemsWithFallback(
      ctx,
      'IMPROVEMENTS',
      /IMPROVEMENTS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      improvementPatterns
    );

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      issues,
      improvements,
      confidence,
    };
  }

  private async generateUpdates(
    pages: WikiPage[],
    analysis: QualityAnalysis,
    context: AgentContext
  ): Promise<{ updates: WikiPageUpdate[], additionalCost: number }> {
    const updates: WikiPageUpdate[] = [];
    let additionalCost = 0;
    const pageMap = new Map(pages.map(p => [p.path, p]));

    // Group improvements by page
    const improvementsByPage = new Map<string, string[]>();
    for (const improvement of analysis.improvements) {
      const existing = improvementsByPage.get(improvement.pagePath) || [];
      existing.push(improvement.suggestion);
      improvementsByPage.set(improvement.pagePath, existing);
    }

    // Generate actual improved content for each page via LLM
    for (const [pagePath, suggestions] of improvementsByPage) {
      const page = pageMap.get(pagePath);
      if (!page) continue;

      // Build prompt for content improvement
      const improvementPrompt = this.buildImprovementPrompt(page, suggestions);

      const completion = await context.llm.complete({
        system: IMPROVEMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: improvementPrompt }],
        maxTokens: 2000,
        temperature: 0.3,
      });

      additionalCost += completion.costUsd;

      // Parse the improved content from response
      const improvedContent = this.parseImprovedContent(completion.content);

      if (improvedContent) {
        updates.push({
          type: 'update',
          path: pagePath,
          content: improvedContent,
          sourceCommitId: page.sourceCommits[0] ?? '',
          agentRunId: '',
          confidenceDelta: 0.1,  // Confidence boost for actual content improvement
        });
      }
    }

    return { updates, additionalCost };
  }

  private buildImprovementPrompt(page: WikiPage, suggestions: string[]): string {
    return `Improve this wiki page based on the suggested improvements.

## Current Page: ${page.path}

**Title:** ${page.title}

**Current Content:**
${page.content}

## Suggested Improvements

${suggestions.map(s => `- ${s}`).join('\n')}

## Your Task

Write the COMPLETE improved page content that addresses the suggestions. Focus on:
1. Adding depth - explain HOW things work, not just WHAT they are
2. Including specific details like method names, configuration options, or code examples
3. Explaining mechanisms, not just listing features
4. Preserving all existing valuable content while enhancing it

## Required Output Format

IMPROVED_CONTENT:
[The complete improved page content - this will REPLACE the current page]

CONFIDENCE: [0-1]`;
  }

  private parseImprovedContent(response: string): string | null {
    // Try to extract IMPROVED_CONTENT section
    const contentMatch = response.match(/IMPROVED_CONTENT:\s*([\s\S]*?)(?=\nCONFIDENCE:|$)/i);
    if (contentMatch && contentMatch[1]) {
      const content = contentMatch[1].trim();
      // Validate content is not empty or just whitespace
      if (content.length > 20) {
        return content;
      }
    }
    return null;
  }
}

interface QualityIssue {
  pagePath: string;
  type: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

interface QualityAnalysis {
  issues: QualityIssue[];
  improvements: Array<{
    pagePath: string;
    suggestion: string;
  }>;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a Quality Agent for CodeWiki. Your job is to review wiki content for quality issues.

Think like a technical editor reviewing documentation. Good wiki content:
- Is clear and concise
- Has proper structure (headings, lists, code blocks)
- Cites sources (commit refs, file paths)
- Avoids vague or unclear language
- Provides actionable information

## Depth Check (Critical)

For each page, verify it answers these questions:
1. **What is it?** - Does the page explain the purpose clearly?
2. **How does it work?** - Does it describe mechanisms, not just existence?
3. **How do I use it?** - Are there examples, configuration details, or API signatures?
4. **What can go wrong?** - Are edge cases, limitations, or failure modes mentioned?

Pages that only describe WHAT something is without explaining HOW it works should be flagged as "needs depth".

Example of SHALLOW content (flag this):
> "The WorkQueue manages pending tasks for the executor."

Example of SUBSTANTIVE content (this is good):
> "The WorkQueue manages pending tasks using a Redis-backed priority queue. Tasks are claimed via WorkQueueRepository.claimBatch(), which uses atomic operations to prevent duplicate processing. If a task fails, it's re-queued with exponential backoff up to 3 retries."

When reviewing:
- Be specific about issues found
- Suggest concrete improvements
- Prioritize depth issues over style issues
- Flag pages that describe but don't explain

Focus on content quality, not structure (that's another agent's job).`;

const IMPROVEMENT_SYSTEM_PROMPT = `You are a Content Improvement Agent for CodeWiki. Your job is to expand and improve wiki page content.

When improving content:
1. **Add depth** - Explain HOW things work, not just WHAT they are
2. **Be specific** - Include method names, configuration options, code examples
3. **Explain mechanisms** - Describe the underlying implementation details
4. **Keep it practical** - Focus on information developers actually need
5. **Preserve existing value** - Keep all useful existing content, enhance rather than remove

Write in a clear, technical style. Use markdown formatting appropriately.

Output the COMPLETE improved page content - it will replace the existing page.`;
