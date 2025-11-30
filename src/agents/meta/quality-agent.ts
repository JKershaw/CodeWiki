import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';

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
  private readonly MIN_CONTENT_LENGTH = 100;
  private readonly LOW_CONFIDENCE_THRESHOLD = 0.5;
  private readonly MAX_PAGES_PER_RUN = 10;

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('QualityAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
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
    const updates = this.generateUpdates(pagesToReview, analysis);

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
      costUsd: completion.costUsd,
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

    // Short content = might be incomplete
    if (page.content.length < this.MIN_CONTENT_LENGTH) {
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
5. **Improvements**: What specific changes would improve each page?

## Required Output Format

ISSUES:
- [SEVERITY:high/medium/low] | [page-path] | Description of the issue

IMPROVEMENTS:
- [page-path] | Specific improvement suggestion

CONFIDENCE: [0-1]
`;
  }

  private parseResponse(response: string): QualityAnalysis {
    const analysis: QualityAnalysis = {
      issues: [],
      improvements: [],
      confidence: 0.7,
    };

    // Parse issues
    const issuesMatch = response.match(/ISSUES:\s*([\s\S]*?)(?=IMPROVEMENTS:|CONFIDENCE:|$)/i);
    if (issuesMatch) {
      const lines = issuesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[SEVERITY:(\w+)\]\s*\|\s*\[([^\]]+)\]\s*\|\s*(.+)$/i);
        if (match) {
          analysis.issues.push({
            pagePath: match[2]!.trim(),
            type: 'content_quality',
            description: match[3]!.trim(),
            severity: match[1]!.toLowerCase() as 'high' | 'medium' | 'low',
          });
        }
      }
    }

    // Parse improvements
    const improvementsMatch = response.match(/IMPROVEMENTS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (improvementsMatch) {
      const lines = improvementsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\|\s*(.+)$/i);
        if (match) {
          analysis.improvements.push({
            pagePath: match[1]!.trim(),
            suggestion: match[2]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
  }

  private generateUpdates(
    _pages: WikiPage[],
    _analysis: QualityAnalysis
  ): WikiPageUpdate[] {
    // Quality agent reports issues but doesn't auto-fix
    // Future: could generate merge updates with improved content
    return [];
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

When reviewing:
- Be specific about issues found
- Suggest concrete improvements
- Prioritize high-impact changes
- Consider the reader's needs (developers looking for context)

Focus on content quality, not structure (that's another agent's job).`;
