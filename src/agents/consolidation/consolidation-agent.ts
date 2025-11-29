import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import type { Finding, FindingGroup } from '../../domain/finding.js';

/**
 * Consolidation Agent - Self-healing wiki maintenance.
 *
 * This agent addresses findings detected by meta agents:
 * - Merges duplicate pages (LLM decides what to keep)
 * - Deletes redundant pages
 * - Updates/fixes links pointing to deleted pages
 * - Standardizes terminology across pages
 *
 * The agent works on FindingGroups provided by the orchestrator,
 * using LLM to make intelligent decisions about consolidation.
 */
export class ConsolidationAgent implements Agent {
  readonly type: AgentType = 'consolidation';

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('ConsolidationAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get open findings grouped for consolidation
    const findingGroups = await context.repos.findings.groupOpenFindings(context.wikiId);

    if (findingGroups.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No findings to consolidate',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Process the highest priority finding group
    const group = findingGroups[0]!;

    // Mark findings as in progress
    for (const finding of group.findings) {
      await context.repos.findings.markInProgress(finding.id, '');
    }

    try {
      const result = await this.processGroup(group, context);

      // Mark findings as addressed
      for (const finding of group.findings) {
        await context.repos.findings.markAddressed(finding.id, result.agentRunId ?? '');
      }

      return result;
    } catch (error) {
      // Reset findings to open on error
      for (const finding of group.findings) {
        await context.repos.findings.save({
          ...finding,
          status: 'open',
          addressedByAgentRunId: null,
        });
      }
      throw error;
    }
  }

  /**
   * Process a group of related findings.
   */
  private async processGroup(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult & { agentRunId?: string }> {
    switch (group.type) {
      case 'duplicate_title':
      case 'similar_content':
        return this.handleDuplicates(group, context);

      case 'broken_link':
        return this.handleBrokenLinks(group, context);

      case 'terminology':
        return this.handleTerminology(group, context);

      case 'orphaned_page':
        return this.handleOrphanedPages(group, context);

      case 'category_mismatch':
        return this.handleCategoryMismatch(group, context);

      case 'contradiction':
        return this.handleContradiction(group, context);

      default:
        return {
          result: createAgentResult({
            summary: `Unsupported finding type: ${group.type}`,
            findings: [],
            confidence: 0.5,
          }),
          updates: [],
          costUsd: 0,
        };
    }
  }

  /**
   * Handle duplicate pages by merging or deleting.
   */
  private async handleDuplicates(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const pages = await this.loadPages(group.affectedPaths, context);

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages to consolidate',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    const prompt = this.buildDuplicatePrompt(pages, group.findings);

    const completion = await context.llm.complete({
      system: CONSOLIDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.3,
    });

    const decision = this.parseDuplicateDecision(completion.content);
    const updates = await this.generateDuplicateUpdates(decision, pages, context);

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

  /**
   * Handle broken links by suggesting fixes or removals.
   */
  private async handleBrokenLinks(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const pages = await this.loadPages(group.affectedPaths, context);
    const allPages = await context.repos.wikiPages.findByWiki(context.wikiId);
    const validPaths = new Set(allPages.map(p => p.path));

    const updates: WikiPageUpdate[] = [];
    const fixedLinks: string[] = [];

    for (const page of pages) {
      let updatedContent = page.content;
      let modified = false;

      for (const finding of group.findings) {
        const brokenPath = finding.metadata?.brokenLinkPath;
        if (!brokenPath) continue;

        // Try to find a similar valid path
        const suggestion = this.findSimilarPath(brokenPath, validPaths);

        if (suggestion) {
          // Replace the broken link with the suggested one
          const linkRegex = new RegExp(
            `\\[([^\\]]+)\\]\\(${this.escapeRegExp(brokenPath)}(\\.md)?\\)`,
            'g'
          );
          const newContent = updatedContent.replace(linkRegex, `[$1](${suggestion}.md)`);
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            modified = true;
            fixedLinks.push(`${brokenPath} → ${suggestion}`);
          }
        } else {
          // Remove the link, keep the text
          const linkRegex = new RegExp(
            `\\[([^\\]]+)\\]\\(${this.escapeRegExp(brokenPath)}(\\.md)?\\)`,
            'g'
          );
          const newContent = updatedContent.replace(linkRegex, '$1');
          if (newContent !== updatedContent) {
            updatedContent = newContent;
            modified = true;
            fixedLinks.push(`${brokenPath} (removed)`);
          }
        }
      }

      if (modified) {
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

    return {
      result: createAgentResult({
        summary: `Fixed ${fixedLinks.length} broken link(s): ${fixedLinks.join(', ')}`,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: `Fixed broken links in ${updates.length} page(s)`,
            relatedPaths: group.affectedPaths,
            importance: 'medium',
          }),
        ],
        confidence: 0.8,
      }),
      updates,
      costUsd: 0,
    };
  }

  /**
   * Handle terminology inconsistencies.
   */
  private async handleTerminology(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const pages = await this.loadPages(group.affectedPaths, context);

    if (pages.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No pages to update',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Extract terminology from findings
    const termSets: string[][] = [];
    for (const finding of group.findings) {
      if (finding.metadata?.terms) {
        termSets.push(finding.metadata.terms);
      }
    }

    if (termSets.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No terminology to standardize',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    const prompt = this.buildTerminologyPrompt(pages, termSets);

    const completion = await context.llm.complete({
      system: TERMINOLOGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.2,
    });

    const decision = this.parseTerminologyDecision(completion.content);
    const updates = this.generateTerminologyUpdates(decision, pages);

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

  /**
   * Handle orphaned pages by adding links or suggesting deletion.
   */
  private async handleOrphanedPages(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult> {
    // For orphaned pages, we'll add them to related pages in the same category
    const orphanedPages = await this.loadPages(group.affectedPaths, context);
    const allPages = await context.repos.wikiPages.findByWiki(context.wikiId);

    const updates: WikiPageUpdate[] = [];

    for (const orphan of orphanedPages) {
      const category = orphan.path.split('/')[0] ?? '';

      // Find overview page for this category
      const overviewPage = allPages.find(p =>
        p.path === `${category}/overview` || p.path === `${category}/index`
      );

      if (overviewPage && !overviewPage.content.includes(`](${orphan.path}`)) {
        // Add link to orphan in the overview page
        const linkedContent = this.addLinkToPage(overviewPage.content, orphan);
        updates.push({
          type: 'update',
          path: overviewPage.path,
          content: linkedContent,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.05,
        });
      }
    }

    return {
      result: createAgentResult({
        summary: `Linked ${updates.length} orphaned page(s) to their category overviews`,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: `Added links to orphaned pages`,
            relatedPaths: group.affectedPaths,
            importance: 'low',
          }),
        ],
        confidence: 0.7,
      }),
      updates,
      costUsd: 0,
    };
  }

  /**
   * Handle category mismatches (pages in wrong category).
   */
  private async handleCategoryMismatch(
    group: FindingGroup,
    _context: AgentContext
  ): Promise<AgentRunResult> {
    // Category mismatch requires more careful handling - just report for now
    return {
      result: createAgentResult({
        summary: `Found ${group.findings.length} page(s) that may be in the wrong category`,
        findings: group.findings.map(f => createFinding({
          type: 'CONSOLIDATION',
          description: f.description,
          relatedPaths: f.affectedPaths,
          importance: 'low',
        })),
        confidence: 0.6,
      }),
      updates: [],
      costUsd: 0,
    };
  }

  /**
   * Handle contradictions between pages.
   */
  private async handleContradiction(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const pages = await this.loadPages(group.affectedPaths, context);

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages to analyze contradiction',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    const prompt = this.buildContradictionPrompt(pages, group.findings);

    const completion = await context.llm.complete({
      system: CONTRADICTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const decision = this.parseContradictionDecision(completion.content);
    const updates = this.generateContradictionUpdates(decision, pages);

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

  // ========== Helper Methods ==========

  private async loadPages(paths: string[], context: AgentContext): Promise<WikiPage[]> {
    const pages: WikiPage[] = [];
    for (const path of paths) {
      const page = await context.repos.wikiPages.findByPath(context.wikiId, path);
      if (page) {
        pages.push(page);
      }
    }
    return pages;
  }

  private findSimilarPath(brokenPath: string, validPaths: Set<string>): string | null {
    const brokenParts = brokenPath.toLowerCase().split('/');
    const brokenName = brokenParts[brokenParts.length - 1] ?? '';

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const validPath of validPaths) {
      const validParts = validPath.toLowerCase().split('/');
      const validName = validParts[validParts.length - 1] ?? '';

      // Check if the names are similar
      if (validName === brokenName) {
        return validPath; // Exact name match
      }

      // Check for partial match
      if (validName.includes(brokenName) || brokenName.includes(validName)) {
        const score = Math.max(validName.length, brokenName.length);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = validPath;
        }
      }
    }

    return bestMatch;
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private addLinkToPage(content: string, targetPage: WikiPage): string {
    // Add link in a "Related" section if it exists, otherwise at the end
    const relatedMatch = content.match(/^## Related\s*\n/m);
    if (relatedMatch) {
      const insertPos = relatedMatch.index! + relatedMatch[0].length;
      const linkLine = `- [${targetPage.title}](${targetPage.path}.md)\n`;
      return content.slice(0, insertPos) + linkLine + content.slice(insertPos);
    }

    // Add a Related section at the end
    return `${content.trimEnd()}\n\n## Related\n\n- [${targetPage.title}](${targetPage.path}.md)\n`;
  }

  // ========== Prompt Builders ==========

  private buildDuplicatePrompt(pages: WikiPage[], findings: Finding[]): string {
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

  private buildTerminologyPrompt(pages: WikiPage[], termSets: string[][]): string {
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

  private buildContradictionPrompt(pages: WikiPage[], findings: Finding[]): string {
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

  // ========== Response Parsers ==========

  private parseDuplicateDecision(response: string): DuplicateDecision {
    const decision: DuplicateDecision = {
      action: 'keep-separate',
      primaryPage: '',
      mergedContent: '',
      deletePages: [],
      summary: 'Could not parse consolidation decision',
      confidence: 0.5,
    };

    const decisionMatch = response.match(/DECISION:\s*(merge|keep-separate)/i);
    if (decisionMatch) {
      decision.action = decisionMatch[1]!.toLowerCase() as 'merge' | 'keep-separate';
    }

    const reasonMatch = response.match(/REASON:\s*(.+?)(?=PRIMARY_PAGE:|$)/is);
    if (reasonMatch) {
      decision.summary = reasonMatch[1]!.trim();
    }

    const primaryMatch = response.match(/PRIMARY_PAGE:\s*(.+?)(?=MERGED_CONTENT:|DELETE_PAGES:|$)/is);
    if (primaryMatch) {
      decision.primaryPage = primaryMatch[1]!.trim();
    }

    const contentMatch = response.match(/MERGED_CONTENT:\s*([\s\S]*?)(?=DELETE_PAGES:|CONFIDENCE:|$)/i);
    if (contentMatch) {
      decision.mergedContent = contentMatch[1]!.trim();
    }

    const deleteMatch = response.match(/DELETE_PAGES:\s*(.+?)(?=CONFIDENCE:|$)/is);
    if (deleteMatch) {
      decision.deletePages = deleteMatch[1]!.split(',').map(p => p.trim()).filter(Boolean);
    }

    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      decision.confidence = parseFloat(confidenceMatch[1]!);
    }

    return decision;
  }

  private parseTerminologyDecision(response: string): TerminologyDecision {
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

  private parseContradictionDecision(response: string): ContradictionDecision {
    const decision: ContradictionDecision = {
      resolution: '',
      updates: new Map(),
      summary: 'Contradiction resolution',
      confidence: 0.6,
    };

    const resolutionMatch = response.match(/RESOLUTION:\s*(.+?)(?=UPDATES:|$)/is);
    if (resolutionMatch) {
      decision.resolution = resolutionMatch[1]!.trim();
    }

    // Parse updated content sections
    const contentMatches = response.matchAll(/---\[([^\]]+)\]---\s*([\s\S]*?)(?=---\[|SUMMARY:|CONFIDENCE:|$)/g);
    for (const match of contentMatches) {
      decision.updates.set(match[1]!.trim(), match[2]!.trim());
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

  // ========== Update Generators ==========

  private async generateDuplicateUpdates(
    decision: DuplicateDecision,
    pages: WikiPage[],
    _context: AgentContext
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

  private generateTerminologyUpdates(
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
        const regex = new RegExp(`\\b${this.escapeRegExp(replacement.oldTerm)}\\b`, 'gi');
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

  private generateContradictionUpdates(
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

// ========== Types ==========

interface DuplicateDecision {
  action: 'merge' | 'keep-separate';
  primaryPage: string;
  mergedContent: string;
  deletePages: string[];
  summary: string;
  confidence: number;
}

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

interface ContradictionDecision {
  resolution: string;
  updates: Map<string, string>;
  summary: string;
  confidence: number;
}

// ========== System Prompts ==========

const CONSOLIDATION_SYSTEM_PROMPT = `You are a wiki consolidation agent. Your job is to intelligently merge duplicate or overlapping wiki pages.

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
