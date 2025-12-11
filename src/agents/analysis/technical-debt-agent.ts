import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor, fetchAffectedFileContents, formatFetchedFilesForContext } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseChoice,
  parseListItemsWithFallback,
  parseConfidence,
  mapSeverity,
  mapPriority,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Technical Debt Analysis Agent - Identifies and tracks technical debt in commits.
 *
 * OPTIMIZATION: Pre-fetches affected file contents and includes them directly in
 * the prompt, reducing tool calls. Falls back to tool-based approach only if
 * context would exceed limits.
 *
 * This agent looks for code smells, TODO/FIXME comments, SOLID principle violations,
 * complexity issues, and other indicators of technical debt. It provides specific
 * remediation recommendations and tracks debt over time.
 */
export class TechnicalDebtAgent implements Agent {
  readonly type: AgentType = 'technical-debt';

  // Max file size for pre-fetch
  private readonly MAX_FILE_SIZE = 20000;
  // Max total context for pre-fetched files
  private readonly MAX_TOTAL_SIZE = 60000;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`TechnicalDebtAgent cannot handle target type: ${target.type}`);
    }
    const commitId = target.commitId;

    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    const diff = await getCommitDiff(context, commit.sha);

    // Try pre-fetch approach first
    if (context.repoAccess && commit.diffSummary.affectedFiles.length > 0) {
      const prefetchResult = await this.runWithPrefetch(commit, diff, context);
      if (prefetchResult) {
        return prefetchResult;
      }
    }

    // Fall back to tool-based approach
    return this.runWithTools(commit, diff, context);
  }

  /**
   * Optimized run using pre-fetched file contents.
   */
  private async runWithPrefetch(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult | null> {
    // Pre-fetch affected files
    const fetchedFiles = await fetchAffectedFileContents(
      context,
      commit.diffSummary.affectedFiles,
      this.MAX_FILE_SIZE,
      this.MAX_TOTAL_SIZE
    );

    // Check if we got any content
    const filesWithContent = fetchedFiles.filter(f => f.content !== null);
    if (filesWithContent.length === 0) {
      return null; // Fall back to tools
    }

    // Build prompt with pre-fetched content
    const fileContext = formatFetchedFilesForContext(fetchedFiles, '## Full File Contents');
    const prompt = this.buildPrefetchPrompt(commit, diff, fileContext);

    // Use single LLM call
    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2500,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(commit, analysis);

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: analysis.findings.map(f => createFinding({
          type: f.type,
          description: f.description,
          relatedPaths: f.paths,
          importance: f.importance,
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: { toolCallCount: 0, toolsUsed: {}, filesRead: commit.diffSummary.affectedFiles },
    };
  }

  /**
   * Tool-based run for complex cases or fallback.
   */
  private async runWithTools(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(commit, diff);

    // Set up codebase exploration tools for verification
    const toolExecutor = createCodebaseToolExecutor(context);

    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 5,
      maxTokens: 2500,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(commit, analysis);

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: analysis.findings.map(f => createFinding({
          type: f.type,
          description: f.description,
          relatedPaths: f.paths,
          importance: f.importance,
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: extractToolMetrics(completion),
    };
  }

  private buildPrompt(commit: {
    sha: string;
    message: string;
    authorName: string;
    committedAt: Date;
    diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number }
  }, diff: string): string {
    const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for technical debt indicators.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Available Tools

You have access to tools to explore the source code:
- **read_file**: Read source files to verify the full context around code changes
- **search_files**: Find files by pattern to locate related code
- **list_directory**: Explore project structure

**Use these tools to**:
- Read the full file (not just the diff) to understand context
- Verify if TODO/FIXME comments are still relevant
- Check if similar patterns exist elsewhere

Analyze for:

1. **Code Smells**: God classes, long methods (>50 lines), feature envy
2. **TODO/FIXME/HACK Comments**: Track with context
3. **Complexity Issues**: Deeply nested conditionals, high cyclomatic complexity
4. **SOLID Violations**: SRP, OCP, LSP, ISP, DIP
5. **Dead Code**: Unreachable code, unused variables
6. **Duplication**: Copy-paste code
7. **Naming Issues**: Unclear names, magic numbers
8. **Error Handling**: Missing error handling, overly broad catches

Format your response as:

SUMMARY:
[Brief assessment of technical debt - adding, reducing, or neutral]

DEBT_TREND: [adding_debt/reducing_debt/neutral/mixed]

FINDINGS:
- category: [category] | severity: [critical/high/medium/low] | description: [what's wrong] | paths: [file1.ts]

TODO_ITEMS:
- location: [file:line] | type: [TODO/FIXME/HACK] | description: [what needs doing]

SOLID_VIOLATIONS:
- principle: [SRP/OCP/LSP/ISP/DIP] | description: [violation] | paths: [files]

REMEDIATION:
- priority: [high/medium/low] | recommendation: [specific action]

HOTSPOTS:
- path: [file path] | reason: [why it's a hotspot]

CONFIDENCE: [0-1]

Example:

SUMMARY:
This commit adds debt via a 150-line method with complex conditionals.

DEBT_TREND: adding_debt

FINDINGS:
- category: Long Method | severity: high | description: processOrder() is 150 lines | paths: src/orders.ts

TODO_ITEMS:
- location: src/orders.ts:45 | type: FIXME | description: Race condition

REMEDIATION:
- priority: high | recommendation: Extract payment logic into PaymentService

CONFIDENCE: 0.85
`;
  }

  /**
   * Build prompt with pre-fetched file contents (optimized approach).
   */
  private buildPrefetchPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    fileContext: string
  ): string {
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for technical debt indicators.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

${fileContext}

## Analysis Instructions

The full contents of affected files are provided above. Use them to:
- Understand the complete file context, not just the changed lines
- Verify if TODO/FIXME comments are still relevant
- Check for code smells, complexity issues, and SOLID violations
- Identify hotspots and patterns that indicate technical debt

Analyze for:

1. **Code Smells**: God classes, long methods (>50 lines), feature envy
2. **TODO/FIXME/HACK Comments**: Track with context
3. **Complexity Issues**: Deeply nested conditionals
4. **SOLID Violations**: SRP, OCP, LSP, ISP, DIP
5. **Dead Code**: Unreachable code, unused variables
6. **Duplication**: Copy-paste code
7. **Naming Issues**: Unclear names, magic numbers
8. **Error Handling**: Missing error handling

Format your response as:

SUMMARY:
[Brief assessment of technical debt - adding, reducing, or neutral]

DEBT_TREND: [adding_debt/reducing_debt/neutral/mixed]

FINDINGS:
- category: [category] | severity: [critical/high/medium/low] | description: [what's wrong] | paths: [file1.ts]

TODO_ITEMS:
- location: [file:line] | type: [TODO/FIXME/HACK] | description: [what needs doing]

SOLID_VIOLATIONS:
- principle: [SRP/OCP/LSP/ISP/DIP] | description: [violation] | paths: [files]

REMEDIATION:
- priority: [high/medium/low] | recommendation: [specific action]

HOTSPOTS:
- path: [file path] | reason: [why it's a hotspot]

CONFIDENCE: [0-1]

Example:

SUMMARY:
This commit adds debt via a 150-line method.

DEBT_TREND: adding_debt

FINDINGS:
- category: Long Method | severity: high | description: processOrder() is 150 lines | paths: src/orders.ts

CONFIDENCE: 0.85
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('technical-debt', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=DEBT_TREND:|FINDINGS:|$)/i) ?? '';

    // Parse debt trend
    const debtTrend = parseChoice(
      ctx,
      'DEBT_TREND',
      /DEBT_TREND:\s*([\w-]+)/i,
      ['adding_debt', 'reducing_debt', 'neutral', 'mixed'] as const,
      { defaultValue: 'neutral' }
    ) ?? 'neutral';

    // Simplified format: - category: [cat] | severity: [sev] | description: [desc] | paths: [paths]
    const findingPatterns: ItemPattern<ParsedAnalysis['findings'][0]>[] = [
      {
        pattern: /^-\s*category:\s*([^|]+)\s*\|\s*severity:\s*(\w+)\s*\|\s*description:\s*([^|]+)\s*\|\s*paths:\s*(.+)$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[2]!),
          description: m[3]!.trim(),
          paths: m[4]!.split(',').map(p => p.trim()).filter(p => p),
        }),
      },
    ];

    const findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=TODO_ITEMS:|SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Simplified format: - location: [file:line] | type: [TODO/FIXME/HACK] | description: [desc]
    const todoPatterns: ItemPattern<ParsedAnalysis['todoItems'][0]>[] = [
      {
        pattern: /^-\s*location:\s*([^|]+)\s*\|\s*type:\s*(TODO|FIXME|HACK)\s*\|\s*description:\s*(.+)$/i,
        mapper: (m) => ({
          location: m[1]!.trim(),
          type: m[2]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK',
          description: m[3]!.trim(),
        }),
      },
    ];

    const todoItems = parseListItemsWithFallback(
      ctx,
      'TODO_ITEMS',
      /TODO_ITEMS:\s*([\s\S]*?)(?=SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|CONFIDENCE:|$)/i,
      todoPatterns
    );

    // Simplified format: - principle: [PRINCIPLE] | description: [desc] | paths: [paths]
    const solidPatterns: ItemPattern<ParsedAnalysis['solidViolations'][0]>[] = [
      {
        pattern: /^-\s*principle:\s*([^|]+)\s*\|\s*description:\s*([^|]+)\s*\|\s*paths:\s*(.+)$/i,
        mapper: (m) => ({
          principle: m[1]!.trim(),
          description: m[2]!.trim(),
          paths: m[3]!.split(',').map(p => p.trim()).filter(p => p),
        }),
      },
    ];

    const solidViolations = parseListItemsWithFallback(
      ctx,
      'SOLID_VIOLATIONS',
      /SOLID_VIOLATIONS:\s*([\s\S]*?)(?=REMEDIATION:|HOTSPOTS:|CONFIDENCE:|$)/i,
      solidPatterns
    );

    // Simplified format: - priority: [level] | recommendation: [action]
    const remediationPatterns: ItemPattern<ParsedAnalysis['remediations'][0]>[] = [
      {
        pattern: /^-\s*priority:\s*(\w+)\s*\|\s*recommendation:\s*(.+)$/i,
        mapper: (m) => ({
          priority: mapPriority(m[1]!),
          recommendation: m[2]!.trim(),
        }),
      },
    ];

    const remediations = parseListItemsWithFallback(
      ctx,
      'REMEDIATION',
      /REMEDIATION:\s*([\s\S]*?)(?=HOTSPOTS:|CONFIDENCE:|$)/i,
      remediationPatterns
    );

    // Simplified format: - path: [file] | reason: [why]
    const hotspotPatterns: ItemPattern<ParsedAnalysis['hotspots'][0]>[] = [
      {
        pattern: /^-\s*path:\s*([^|]+)\s*\|\s*reason:\s*(.+)$/i,
        mapper: (m) => ({
          path: m[1]!.trim(),
          reason: m[2]!.trim(),
        }),
      },
    ];

    const hotspots = parseListItemsWithFallback(
      ctx,
      'HOTSPOTS',
      /HOTSPOTS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      hotspotPatterns
    );

    // Wiki updates are generated programmatically, not from LLM output
    const wikiUpdates: ParsedAnalysis['wikiUpdates'] = [];

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      summary,
      debtTrend,
      findings,
      todoItems,
      solidViolations,
      remediations,
      hotspots,
      wikiUpdates,
      confidence,
    };
  }

  private generateUpdates(
    commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
    analysis: ParsedAnalysis
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    // Only create wiki content for commits with significant debt findings
    const hasSignificantFindings =
      analysis.debtTrend === 'adding_debt' ||
      analysis.findings.length > 0 ||
      analysis.todoItems.length > 0 ||
      analysis.solidViolations.length > 0;

    if (!hasSignificantFindings) {
      return updates;
    }

    // Create detailed debt report for significant findings
    if (analysis.findings.length > 0 || analysis.solidViolations.length > 0) {
      const pagePath = `technical-debt/reports/${commit.sha.slice(0, 8)}`;

      const content = `# Technical Debt Report: Commit ${commit.sha.slice(0, 8)}

**Debt Trend:** ${formatDebtTrend(analysis.debtTrend)}

## Summary

${analysis.summary}

${analysis.findings.length > 0 ? `## Findings

${analysis.findings.map(f => `### ${f.type} (${f.importance})

${f.description}

${f.paths.length > 0 ? `**Affected files:** ${f.paths.map(p => `\`${p}\``).join(', ')}` : ''}`).join('\n\n')}` : ''}

${analysis.todoItems.length > 0 ? `## TODO/FIXME/HACK Items

${analysis.todoItems.map(t => `- **${t.type}** at \`${t.location}\`: ${t.description}`).join('\n')}` : ''}

${analysis.solidViolations.length > 0 ? `## SOLID Principle Violations

${analysis.solidViolations.map(v => `### ${v.principle}

${v.description}

${v.paths.length > 0 ? `**Affected files:** ${v.paths.map(p => `\`${p}\``).join(', ')}` : ''}`).join('\n\n')}` : ''}

${analysis.remediations.length > 0 ? `## Remediation Recommendations

${analysis.remediations.map(r => `- **[${r.priority.toUpperCase()}]** ${r.recommendation}`).join('\n')}` : ''}

${analysis.hotspots.length > 0 ? `## Hotspots

These files may need extra attention:

${analysis.hotspots.map(h => `- \`${h.path}\`: ${h.reason}`).join('\n')}` : ''}

## Files Reviewed

${commit.diffSummary.affectedFiles.map(f => `- \`${f}\``).join('\n')}

---
*Technical debt analysis from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'create',
        path: pagePath,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: analysis.debtTrend === 'adding_debt' ? 0.4 : 0.3,
      });
    }

    // Update the technical debt overview page
    const hasHighPriorityItems =
      analysis.findings.some(f => f.importance === 'high') ||
      analysis.remediations.some(r => r.priority === 'high');

    if (hasHighPriorityItems || analysis.todoItems.length > 0) {
      const overviewContent = `# Technical Debt Overview

## Current Status

This page tracks known technical debt in the codebase.

## Recent Analysis

### Commit ${commit.sha.slice(0, 8)}

**Trend:** ${formatDebtTrend(analysis.debtTrend)}

${analysis.summary.slice(0, 200)}${analysis.summary.length > 200 ? '...' : ''}

${analysis.findings.filter(f => f.importance === 'high').length > 0 ? `**High-priority issues found:** ${analysis.findings.filter(f => f.importance === 'high').length}` : ''}

${analysis.todoItems.length > 0 ? `**TODO/FIXME items:** ${analysis.todoItems.length}` : ''}

[See full report](./reports/${commit.sha.slice(0, 8)})

${analysis.remediations.filter(r => r.priority === 'high').length > 0 ? `## Priority Recommendations

${analysis.remediations.filter(r => r.priority === 'high').map(r => `- ${r.recommendation}`).join('\n')}` : ''}

## How to Use This Information

When working on code flagged for technical debt:
1. **Tread carefully** - These areas are more prone to issues
2. **Consider refactoring** - If touching this code anyway, consider addressing debt
3. **Don't make it worse** - Avoid adding more debt in flagged areas
4. **Track progress** - Use TODO comments with context for deferred work

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'update',
        path: 'technical-debt/overview',
        content: overviewContent,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.15,
      });
    }

    // Create/update TODO tracking page if there are TODO items
    if (analysis.todoItems.length > 0) {
      const todoContent = `# TODO/FIXME Tracker

This page tracks TODO, FIXME, and HACK comments found in the codebase.

## Active Items

### From Commit ${commit.sha.slice(0, 8)}

${analysis.todoItems.map(t => `#### ${t.type}: ${t.description}

- **Location:** \`${t.location}\`
- **Type:** ${t.type}
- **Found in:** commit ${commit.sha.slice(0, 8)}
`).join('\n')}

## Item Types

- **TODO**: Feature or improvement to be implemented
- **FIXME**: Known bug or issue that needs fixing
- **HACK**: Workaround that should be properly solved

## Guidelines

When adding TODO comments:
1. Include context about *why* it's deferred
2. Add a rough priority or timeline if known
3. Reference any related issues or tickets
4. Include your name/date for tracking

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'update',
        path: 'technical-debt/todos',
        content: todoContent,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.2,
      });
    }

    // Create hotspots page if there are hotspots
    if (analysis.hotspots.length > 0) {
      const hotspotsContent = `# Technical Debt Hotspots

These areas of the codebase have accumulated technical debt and may need extra attention when working nearby.

## Current Hotspots

${analysis.hotspots.map(h => `### \`${h.path}\`

**Reason:** ${h.reason}

**Recommendation:** Tread carefully when modifying. Consider refactoring if making significant changes.
`).join('\n')}

## What Makes a Hotspot?

Areas become hotspots due to:
- High cyclomatic complexity
- Frequent modifications with increasing complexity
- Multiple SOLID principle violations
- Accumulated TODO/FIXME comments
- Poor test coverage combined with complexity

## Working with Hotspots

1. **Understand before changing** - Read surrounding code thoroughly
2. **Add tests first** - Ensure safety net before refactoring
3. **Small changes** - Prefer incremental improvements
4. **Document decisions** - Leave context for future developers

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'update',
        path: 'technical-debt/hotspots',
        content: hotspotsContent,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.25,
      });
    }

    return updates;
  }
}

type DebtTrend = 'adding_debt' | 'reducing_debt' | 'neutral' | 'mixed';

interface ParsedAnalysis {
  summary: string;
  debtTrend: DebtTrend;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  todoItems: Array<{
    location: string;
    type: 'TODO' | 'FIXME' | 'HACK';
    description: string;
  }>;
  solidViolations: Array<{
    principle: string;
    description: string;
    paths: string[];
  }>;
  remediations: Array<{
    priority: 'high' | 'medium' | 'low';
    recommendation: string;
  }>;
  hotspots: Array<{
    path: string;
    reason: string;
  }>;
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update';
    description: string;
  }>;
  confidence: number;
}


function formatDebtTrend(trend: DebtTrend): string {
  switch (trend) {
    case 'adding_debt':
      return 'Adding Debt';
    case 'reducing_debt':
      return 'Reducing Debt';
    case 'mixed':
      return 'Mixed (some added, some reduced)';
    case 'neutral':
    default:
      return 'Neutral';
  }
}

const SYSTEM_PROMPT = `You are a technical debt analysis agent for CodeWiki.

Your job: Identify technical debt in code changes and provide actionable remediation.

## Tools

Use read_file, search_files, and list_directory to verify claims. Read full files before citing metrics.

## What to Find

**Code Smells**: Long methods (>50 lines), god classes (>300 lines), deep nesting, feature envy, duplicate code
**TODOs/FIXMEs**: Track with location and context
**SOLID Violations**: SRP, OCP, LSP, ISP, DIP breaches
**Other Issues**: Magic numbers, missing error handling, tight coupling

## Debt Trend

Classify each commit: adding_debt, reducing_debt, neutral, or mixed

## Confidence

0.9+: Clear issues. 0.7-0.9: Likely debt. 0.5-0.7: Potential issues. <0.5: Minor/uncertain.

## Guidelines

Be specific: "processOrder() is 120 lines with 5 nesting levels" beats "long method".
Provide remediation: What action should be taken?
Prioritize: Core logic issues matter more than test code issues.`;

/**
 * System prompt for pre-fetch approach (file contents already provided, no tools needed).
 */
const SYSTEM_PROMPT_PREFETCH = `You are a technical debt analysis agent for CodeWiki.

Your job: Identify technical debt in code changes. Full file contents are provided below.

## What to Find

**Code Smells**: Long methods (>50 lines), god classes (>300 lines), deep nesting, feature envy
**TODOs/FIXMEs**: Track with location and context
**SOLID Violations**: SRP, OCP, LSP, ISP, DIP breaches
**Other Issues**: Magic numbers, missing error handling, tight coupling

## Debt Trend

Classify each commit: adding_debt, reducing_debt, neutral, or mixed

## Confidence

0.9+: Clear issues. 0.7-0.9: Likely debt. 0.5-0.7: Potential issues. <0.5: Minor/uncertain.

## Guidelines

Be specific: "processOrder() is 120 lines" beats "long method".
Provide remediation: What action should be taken?`;
