import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType, Finding } from '../../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';
import { createParseContext, parseSection, parseConfidence } from '../../parsing/index.js';

/**
 * Decision structure for contradiction resolution.
 */
interface ContradictionDecision {
  resolution: string;
  updates: Map<string, string>;
  summary: string;
  confidence: number;
}

/**
 * Handler for contradiction findings between wiki pages.
 * Uses LLM to analyze contradictions and determine correct information.
 */
export class ContradictionHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['contradiction'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const pages = await HandlerUtils.loadPages(group.affectedPaths, context);

    if (pages.length < 2) {
      return HandlerUtils.createEmptyResult('Not enough pages to analyze contradiction');
    }

    const prompt = this.buildPrompt(pages, group.findings);

    const completion = await context.llm.complete({
      system: CONTRADICTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const decision = this.parseDecision(completion.content);
    const updates = this.generateUpdates(decision, pages);

    return {
      result: createAgentResult({
        summary: decision.summary,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: decision.summary,
            relatedPaths: group.affectedPaths,
            importance: 'high',
          }),
        ],
        confidence: decision.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(pages: WikiPage[], findings: Finding[]): string {
    return `Resolve contradictions between these wiki pages.

## Contradictions Found
${findings.map(f => `- ${f.description}`).join('\n')}

## Pages

${pages.map(p => `### ${p.title} (${p.path})

${p.content}

---
`).join('\n')}

## Your Task

Analyze the contradictions and determine:
1. Which information is correct (based on context, recency, etc.)
2. How to update pages to be consistent
3. Whether to add clarifying notes

Respond in this format:

RESOLUTION: [Brief explanation of the correct information]
UPDATES:
- [page-path]: [Description of what to change]
UPDATED_CONTENT:
---[page-path]---
[Complete updated content for this page]

SUMMARY: [Brief description of resolution]
CONFIDENCE: [0-1]
`;
  }

  private parseDecision(response: string): ContradictionDecision {
    const ctx = createParseContext('contradiction-handler', response);

    // Parse resolution
    const resolution = parseSection(ctx, 'RESOLUTION', /RESOLUTION:\s*(.+?)(?=UPDATES:|UPDATED_CONTENT:|$)/is) ?? '';

    // Parse updated content sections - uses custom block format
    const updates = new Map<string, string>();
    const contentMatches = response.matchAll(/---\[([^\]]+)\]---\s*([\s\S]*?)(?=---\[|SUMMARY:|CONFIDENCE:|$)/g);
    for (const match of contentMatches) {
      updates.set(match[1]!.trim(), match[2]!.trim());
    }

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*(.+?)(?=CONFIDENCE:|$)/is) ?? 'Contradiction resolution';

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.6 });

    return {
      resolution,
      updates,
      summary,
      confidence,
    };
  }

  private generateUpdates(
    decision: ContradictionDecision,
    pages: WikiPage[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    for (const [path, content] of decision.updates) {
      const page = pages.find(p => p.path === path);
      if (page && content && content !== page.content) {
        updates.push({
          type: 'update',
          path,
          content,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.15,
        });
      }
    }

    return updates;
  }
}

const CONTRADICTION_SYSTEM_PROMPT = `You are a wiki contradiction resolution agent. Your job is to identify and fix contradictory information across wiki pages.

When resolving contradictions:
- Look for the most recent or authoritative source
- Consider which information aligns with the codebase
- Check for context that might explain apparent contradictions
- Prefer specific information over general statements

Your resolution should:
- Correct the inaccurate information
- Preserve the writing style of each page
- Add clarifying context where helpful
- Not introduce new contradictions`;
