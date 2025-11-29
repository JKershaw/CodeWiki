import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType } from '../../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';

/**
 * Decision structure for terminology standardization.
 */
interface TerminologyDecision {
  canonicalTerms: Map<string, string>;
  replacements: Array<{
    pagePath: string;
    oldTerm: string;
    newTerm: string;
  }>;
  summary: string;
  confidence: number;
}

/**
 * Handler for terminology inconsistency findings.
 * Uses LLM to determine canonical terms and standardize usage across pages.
 */
export class TerminologyHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['terminology'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const pages = await HandlerUtils.loadPages(group.affectedPaths, context);

    if (pages.length === 0) {
      return HandlerUtils.createEmptyResult('No pages to update');
    }

    // Extract terminology from findings
    const termSets: string[][] = [];
    for (const finding of group.findings) {
      if (finding.metadata?.terms) {
        termSets.push(finding.metadata.terms);
      }
    }

    if (termSets.length === 0) {
      return HandlerUtils.createEmptyResult('No terminology to standardize');
    }

    const prompt = this.buildPrompt(pages, termSets);

    const completion = await context.llm.complete({
      system: TERMINOLOGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.2,
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
            importance: 'medium',
          }),
        ],
        confidence: decision.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(pages: WikiPage[], termSets: string[][]): string {
    return `Standardize terminology across these wiki pages.

## Inconsistent Terms Found
${termSets.map(terms => `- Terms: ${terms.join(', ')}`).join('\n')}

## Pages to Update

${pages.map(p => `### ${p.title} (${p.path})

${p.content}

---
`).join('\n')}

## Your Task

For each set of inconsistent terms:
1. Choose the canonical term to use
2. Identify all occurrences in each page
3. Decide which should be replaced

Respond in this format:

CANONICAL_TERMS:
- [preferred-term]: replaces [term1, term2, term3]

REPLACEMENTS:
- [page-path]: [old-term] → [new-term] (context: [brief context])

SUMMARY: [Brief description of changes]
CONFIDENCE: [0-1]
`;
  }

  private parseDecision(response: string): TerminologyDecision {
    const decision: TerminologyDecision = {
      canonicalTerms: new Map(),
      replacements: [],
      summary: 'Terminology standardization',
      confidence: 0.7,
    };

    const canonicalMatch = response.match(/CANONICAL_TERMS:\s*([\s\S]*?)(?=REPLACEMENTS:|SUMMARY:|$)/i);
    if (canonicalMatch) {
      const lines = canonicalMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*replaces\s*\[([^\]]+)\]/i);
        if (match) {
          const canonical = match[1]!.trim();
          const replaced = match[2]!.split(',').map(t => t.trim());
          for (const term of replaced) {
            decision.canonicalTerms.set(term.toLowerCase(), canonical);
          }
        }
      }
    }

    const replacementsMatch = response.match(/REPLACEMENTS:\s*([\s\S]*?)(?=SUMMARY:|CONFIDENCE:|$)/i);
    if (replacementsMatch) {
      const lines = replacementsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*\[?([^\]→]+)\]?\s*→\s*\[?([^\]]+)\]?/);
        if (match) {
          decision.replacements.push({
            pagePath: match[1]!.trim(),
            oldTerm: match[2]!.trim(),
            newTerm: match[3]!.trim(),
          });
        }
      }
    }

    const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=CONFIDENCE:|$)/is);
    if (summaryMatch) {
      decision.summary = summaryMatch[1]!.trim();
    }

    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      decision.confidence = parseFloat(confidenceMatch[1]!);
    }

    return decision;
  }

  private generateUpdates(
    decision: TerminologyDecision,
    pages: WikiPage[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    for (const page of pages) {
      const pageReplacements = decision.replacements.filter(r => r.pagePath === page.path);
      if (pageReplacements.length === 0) continue;

      let updatedContent = page.content;
      for (const replacement of pageReplacements) {
        // Replace the old term with the new one (case-insensitive, word boundaries)
        const regex = new RegExp(`\\b${HandlerUtils.escapeRegExp(replacement.oldTerm)}\\b`, 'gi');
        updatedContent = updatedContent.replace(regex, replacement.newTerm);
      }

      if (updatedContent !== page.content) {
        updates.push({
          type: 'update',
          path: page.path,
          content: updatedContent,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.1,
        });
      }
    }

    return updates;
  }
}

const TERMINOLOGY_SYSTEM_PROMPT = `You are a wiki terminology standardization agent. Your job is to identify and fix inconsistent terminology across wiki pages.

When choosing canonical terms:
- Prefer the most commonly used term
- Prefer the most precise/technical term
- Prefer terms that are consistent with code identifiers
- Consider industry standards

Be careful to:
- Only replace when the terms truly mean the same thing
- Preserve intentional variations (e.g., when discussing history)
- Not replace terms in code blocks
- Maintain readability`;
