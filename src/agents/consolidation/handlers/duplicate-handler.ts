import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType, Finding } from '../../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';
import {
  createParseContext,
  parseSection,
  parseChoice,
  parseConfidence,
} from '../../parsing/index.js';

/**
 * Decision structure for duplicate page handling.
 */
interface DuplicateDecision {
  action: 'merge' | 'keep-separate';
  primaryPage: string;
  mergedContent: string;
  deletePages: string[];
  summary: string;
  confidence: number;
}

/**
 * Handler for duplicate page findings (duplicate_title, similar_content).
 * Uses LLM to make intelligent decisions about merging or keeping pages separate.
 */
export class DuplicateHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['duplicate_title', 'similar_content'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const pages = await HandlerUtils.loadPages(group.affectedPaths, context);

    if (pages.length < 2) {
      return HandlerUtils.createEmptyResult('Not enough pages to consolidate');
    }

    const prompt = this.buildPrompt(pages, group.findings);

    const completion = await context.llm.complete({
      system: DUPLICATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.3,
    });

    const decision = this.parseDecision(completion.content);
    const updates = await this.generateUpdates(decision, pages);

    return {
      result: createAgentResult({
        summary: decision.summary,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: decision.summary,
            relatedPaths: group.affectedPaths,
            importance: 'medium',
          }),
        ],
        confidence: decision.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(pages: WikiPage[], findings: Finding[]): string {
    return `Analyze these potentially duplicate pages and decide how to consolidate them.

## Findings
${findings.map(f => `- ${f.description}`).join('\n')}

## Pages

${pages.map(p => `### ${p.title} (${p.path})
Confidence: ${(p.confidence * 100).toFixed(0)}%
Updated: ${p.updatedAt.toISOString()}

${p.content}

---
`).join('\n')}

## Your Task

Decide how to consolidate these pages:
1. Which page should be the "primary" page (keep and enhance)?
2. What content from secondary pages should be merged into the primary?
3. Which pages should be deleted after merging?
4. What links need to be updated?

Respond in this format:

DECISION: [merge|keep-separate]
REASON: [Why you made this decision]
PRIMARY_PAGE: [path of the page to keep]
MERGED_CONTENT:
[The complete merged content for the primary page]
DELETE_PAGES: [comma-separated paths to delete]
CONFIDENCE: [0-1]
`;
  }

  private parseDecision(response: string): DuplicateDecision {
    const ctx = createParseContext('duplicate-handler', response);

    // Parse decision action
    const action = parseChoice(
      ctx,
      'DECISION',
      /DECISION:\s*(merge|keep-separate)/i,
      ['merge', 'keep-separate'] as const,
      { defaultValue: 'keep-separate' }
    ) ?? 'keep-separate';

    // Parse reason/summary
    const summary = parseSection(ctx, 'REASON', /REASON:\s*(.+?)(?=PRIMARY_PAGE:|$)/is)
      ?? 'Could not parse consolidation decision';

    // Parse primary page
    const primaryPage = parseSection(ctx, 'PRIMARY_PAGE', /PRIMARY_PAGE:\s*(.+?)(?=MERGED_CONTENT:|DELETE_PAGES:|$)/is) ?? '';

    // Parse merged content
    const mergedContent = parseSection(ctx, 'MERGED_CONTENT', /MERGED_CONTENT:\s*([\s\S]*?)(?=DELETE_PAGES:|CONFIDENCE:|$)/i) ?? '';

    // Parse delete pages
    const deletePagesRaw = parseSection(ctx, 'DELETE_PAGES', /DELETE_PAGES:\s*(.+?)(?=CONFIDENCE:|$)/is) ?? '';
    const deletePages = deletePagesRaw.split(',').map(p => p.trim()).filter(Boolean);

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      action,
      primaryPage,
      mergedContent,
      deletePages,
      summary,
      confidence,
    };
  }

  private async generateUpdates(
    decision: DuplicateDecision,
    pages: WikiPage[]
  ): Promise<WikiPageUpdate[]> {
    const updates: WikiPageUpdate[] = [];

    if (decision.action === 'keep-separate' || !decision.primaryPage) {
      return updates;
    }

    // Update the primary page with merged content
    const primaryPage = pages.find(p => p.path === decision.primaryPage);
    if (primaryPage && decision.mergedContent) {
      updates.push({
        type: 'update',
        path: decision.primaryPage,
        content: decision.mergedContent,
        sourceCommitId: '',
        agentRunId: '',
        confidenceDelta: 0.2,
      });
    }

    // Delete secondary pages
    for (const deletePath of decision.deletePages) {
      if (deletePath !== decision.primaryPage) {
        updates.push({
          type: 'delete',
          path: deletePath,
          content: '',
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0,
          redirectTo: decision.primaryPage,
        });
      }
    }

    return updates;
  }
}

const DUPLICATE_SYSTEM_PROMPT = `You are a wiki consolidation agent. Your job is to intelligently merge duplicate or overlapping wiki pages.

When deciding to merge:
- Prefer the page with more comprehensive content
- Prefer the page with higher confidence
- Prefer the more recently updated page
- Preserve all unique information from both pages
- Create a coherent narrative, not just concatenated content

When to keep pages separate:
- If they cover genuinely different aspects of a topic
- If merging would create a page that's too long or unfocused
- If the pages are in different categories for good reasons

Your merged content should:
- Have a clear title and structure
- Include all important information from both sources
- Remove redundancy
- Maintain consistent terminology
- Include appropriate links`;
