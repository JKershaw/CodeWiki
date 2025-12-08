import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor } from '../agent-helpers.js';
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
 * This agent looks for code smells, TODO/FIXME comments, SOLID principle violations,
 * complexity issues, and other indicators of technical debt. It provides specific
 * remediation recommendations and tracks debt over time.
 */
export class TechnicalDebtAgent implements Agent {
  readonly type: AgentType = 'technical-debt';

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
      temperature: 0.2, // Lower temperature for analytical precision
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
- Read the full file (not just the diff) to understand the context around technical debt
- Verify if TODO/FIXME comments are still relevant
- Check if similar patterns exist elsewhere (indicating systemic debt)
- Understand dependencies and coupling between modules

Analyze for:

1. **Code Smells**: God classes, long methods (>50 lines), feature envy, data clumps
2. **TODO/FIXME/HACK Comments**: Track with context about what needs to be done
3. **Complexity Issues**: Deeply nested conditionals, high cyclomatic complexity, complex boolean expressions
4. **SOLID Violations**:
   - Single Responsibility: Classes doing too much
   - Open/Closed: Code that requires modification for extension
   - Liskov Substitution: Improper inheritance
   - Interface Segregation: Fat interfaces
   - Dependency Inversion: Concrete dependencies
5. **Dead Code**: Unreachable code, unused variables, commented-out code
6. **Duplication**: Copy-paste code, similar logic patterns
7. **Naming Issues**: Unclear names, inconsistent conventions, magic numbers/strings
8. **Error Handling**: Swallowed exceptions, missing error handling, overly broad catches
9. **Performance Concerns**: N+1 queries, inefficient algorithms, unnecessary allocations
10. **Testing Gaps**: Missing tests for complex logic, untestable code

Format your response as:

SUMMARY:
[Brief assessment of technical debt in this commit - is it adding, reducing, or neutral?]

DEBT_TREND:
[One of: adding_debt, reducing_debt, neutral, mixed]

FINDINGS:
- [CATEGORY] [SEVERITY:critical/high/medium/low] [Description] [Affected paths]

TODO_ITEMS:
- [FILE:line] [TODO/FIXME/HACK] [Description of what needs to be done]

SOLID_VIOLATIONS:
- [PRINCIPLE] [Description] [Affected paths]

REMEDIATION:
- [Priority:high/medium/low] [Specific actionable recommendation]

HOTSPOTS:
- [File path] [Reason it's a hotspot - e.g., "frequently modified, high complexity"]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('technical-debt', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=DEBT_TREND:|FINDINGS:|$)/i) ?? '';

    // Parse debt trend using parseChoice for underscore/hyphen normalization
    const debtTrend = parseChoice(
      ctx,
      'DEBT_TREND',
      /DEBT_TREND:\s*([\w-]+)/i,
      ['adding_debt', 'reducing_debt', 'neutral', 'mixed'] as const,
      { defaultValue: 'neutral' }
    ) ?? 'neutral';

    // Define finding patterns with fallbacks
    const findingPatterns: ItemPattern<ParsedAnalysis['findings'][0]>[] = [
      // Format: - [CATEGORY] [SEVERITY:level] Description [paths]
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[2]!),
          description: m[3]!.trim(),
          paths: m[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
        }),
      },
      // Format: - [CATEGORY] (severity) Description
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\((\w+)\)\s*(.+)$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[2]!),
          description: m[3]!.trim(),
          paths: [],
        }),
      },
      // Format: - **CATEGORY** (severity): Description
      {
        pattern: /^-\s*\*\*([^*]+)\*\*\s*\((\w+)\)[:\s]*(.+)$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[2]!),
          description: m[3]!.trim(),
          paths: [],
        }),
      },
      // Format: - CATEGORY: Description (severity)
      {
        pattern: /^-\s*([^:]+):\s*(.+?)\s*\((\w+)\)\s*$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[3]!),
          description: m[2]!.trim(),
          paths: [],
        }),
      },
      // Fallback: extract meaningful content
      {
        pattern: /^-\s*(.{10,})$/,
        mapper: (m) => {
          const content = m[1]!;
          const severityMatch = content.match(/\b(critical|high|medium|low)\b/i);
          const categoryMatch = content.match(/\[([^\]]+)\]|\*\*([^*]+)\*\*/);
          const category = categoryMatch ? (categoryMatch[1] || categoryMatch[2])!.trim() : 'General';
          const description = content
            .replace(/\[([^\]]+)\]/g, '')
            .replace(/\*\*([^*]+)\*\*/g, '')
            .replace(/\b(critical|high|medium|low)\b/gi, '')
            .replace(/SEVERITY:/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (description.length > 5) {
            return {
              type: category,
              importance: mapSeverity(severityMatch?.[1] ?? 'medium'),
              description,
              paths: [],
            };
          }
          return null;
        },
      },
    ];

    const findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=TODO_ITEMS:|SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Define TODO item patterns with fallbacks
    const todoPatterns: ItemPattern<ParsedAnalysis['todoItems'][0]>[] = [
      // Format: - [FILE:line] [TODO/FIXME/HACK] Description
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[(TODO|FIXME|HACK)\]\s*(.+)$/i,
        mapper: (m) => ({
          location: m[1]!.trim(),
          type: m[2]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK',
          description: m[3]!.trim(),
        }),
      },
      // Format: - **TODO/FIXME/HACK** at location: Description
      {
        pattern: /^-\s*\*\*(TODO|FIXME|HACK)\*\*\s*(?:at\s+)?([^:]+):\s*(.+)$/i,
        mapper: (m) => ({
          location: m[2]!.trim(),
          type: m[1]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK',
          description: m[3]!.trim(),
        }),
      },
      // Format: - TODO/FIXME/HACK: Description (location)
      {
        pattern: /^-\s*(TODO|FIXME|HACK)[:\s]+(.+?)\s*\(([^)]+)\)\s*$/i,
        mapper: (m) => ({
          location: m[3]!.trim(),
          type: m[1]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK',
          description: m[2]!.trim(),
        }),
      },
      // Fallback: just look for TODO/FIXME/HACK anywhere
      {
        pattern: /^-\s*.*\b(TODO|FIXME|HACK)\b.*$/i,
        mapper: (m) => {
          const todoType = m[1]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK';
          const description = m[0]!.replace(/^-\s*/, '').replace(/\b(TODO|FIXME|HACK)\b/i, '').trim();
          return {
            location: 'unknown',
            type: todoType,
            description: description || `${todoType} item detected`,
          };
        },
      },
    ];

    const todoItems = parseListItemsWithFallback(
      ctx,
      'TODO_ITEMS',
      /TODO_ITEMS:\s*([\s\S]*?)(?=SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      todoPatterns
    );

    // Define SOLID violation patterns
    const solidPatterns: ItemPattern<ParsedAnalysis['solidViolations'][0]>[] = [
      // Format: - [PRINCIPLE] Description [paths]
      {
        pattern: /^-\s*\[([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
        mapper: (m) => ({
          principle: m[1]!.trim(),
          description: m[2]!.trim(),
          paths: m[3]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
        }),
      },
      // Format: - **Principle**: Description
      {
        pattern: /^-\s*\*\*([^*]+)\*\*[:\s]+(.+)$/i,
        mapper: (m) => ({
          principle: m[1]!.trim(),
          description: m[2]!.trim(),
          paths: [],
        }),
      },
      // Fallback: look for SOLID principle keywords
      {
        pattern: /^-\s*(.+)$/,
        mapper: (m) => {
          const line = m[1]!;
          const principleKeywords = ['Single Responsibility', 'Open/Closed', 'Open-Closed', 'Liskov', 'Interface Segregation', 'Dependency Inversion', 'SRP', 'OCP', 'LSP', 'ISP', 'DIP'];
          for (const keyword of principleKeywords) {
            if (line.toLowerCase().includes(keyword.toLowerCase())) {
              return {
                principle: keyword,
                description: line.trim(),
                paths: [],
              };
            }
          }
          return null;
        },
      },
    ];

    const solidViolations = parseListItemsWithFallback(
      ctx,
      'SOLID_VIOLATIONS',
      /SOLID_VIOLATIONS:\s*([\s\S]*?)(?=REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      solidPatterns
    );

    // Define remediation patterns
    const remediationPatterns: ItemPattern<ParsedAnalysis['remediations'][0]>[] = [
      // Format: - [Priority:level] Recommendation
      {
        pattern: /^-\s*\[Priority:(\w+)\]\s*(.+)$/i,
        mapper: (m) => ({
          priority: mapPriority(m[1]!),
          recommendation: m[2]!.trim(),
        }),
      },
      // Format: - **Priority**: Recommendation or - (priority) Recommendation
      {
        pattern: /^-\s*(?:\*\*(\w+)\*\*|\((\w+)\))[:\s]+(.+)$/i,
        mapper: (m) => ({
          priority: mapPriority((m[1] || m[2])!),
          recommendation: m[3]!.trim(),
        }),
      },
      // Fallback: extract priority from content or default to medium
      {
        pattern: /^-\s*(.{10,})$/,
        mapper: (m) => {
          const content = m[1]!;
          const priorityMatch = content.match(/\b(high|medium|low)\b/i);
          const recommendation = content.replace(/\b(high|medium|low)\b/gi, '').trim();
          if (recommendation.length > 5) {
            return {
              priority: mapPriority(priorityMatch?.[1] ?? 'medium'),
              recommendation,
            };
          }
          return null;
        },
      },
    ];

    const remediations = parseListItemsWithFallback(
      ctx,
      'REMEDIATION',
      /REMEDIATION:\s*([\s\S]*?)(?=HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      remediationPatterns
    );

    // Define hotspot patterns
    const hotspotPatterns: ItemPattern<ParsedAnalysis['hotspots'][0]>[] = [
      // Format: - [path] Reason
      {
        pattern: /^-\s*\[([^\]]+)\]\s*(.+)$/,
        mapper: (m) => ({
          path: m[1]!.trim(),
          reason: m[2]!.trim(),
        }),
      },
      // Format: - `path`: Reason or - **path**: Reason
      {
        pattern: /^-\s*(?:`([^`]+)`|\*\*([^*]+)\*\*)[:\s]+(.+)$/,
        mapper: (m) => ({
          path: (m[1] || m[2])!.trim(),
          reason: m[3]!.trim(),
        }),
      },
      // Format: - path - Reason
      {
        pattern: /^-\s*([^\s-]+(?:\.[^\s]+)?)\s*[-–:]\s*(.+)$/,
        mapper: (m) => ({
          path: m[1]!.trim(),
          reason: m[2]!.trim(),
        }),
      },
    ];

    const hotspots = parseListItemsWithFallback(
      ctx,
      'HOTSPOTS',
      /HOTSPOTS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i,
      hotspotPatterns
    );

    // Define wiki update patterns
    const wikiUpdatePatterns: ItemPattern<ParsedAnalysis['wikiUpdates'][0]>[] = [
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i,
        mapper: (m) => ({
          path: m[1]!.trim(),
          action: m[2]!.toLowerCase() as 'create' | 'update',
          description: m[3]!.trim(),
        }),
      },
    ];

    const wikiUpdates = parseListItemsWithFallback(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      wikiUpdatePatterns
    );

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

const SYSTEM_PROMPT = `You are a technical debt analysis agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to identify and document technical debt in code changes. This helps developers understand where the problems are, not just what exists. You provide the "local's guide" to the codebase - the warnings and context that help AI coding agents and humans work more effectively.

## CRITICAL: Verify Before Documenting

You have access to tools (read_file, search_files, list_directory) to explore the source code. USE THEM:

1. **Read the full file** before citing line counts or complexity metrics - diffs don't show full context
2. **Search for similar patterns** before claiming something is unique or systemic debt
3. **Verify TODO/FIXME context** by reading surrounding code to understand priority and relevance
4. **Check dependencies** between modules before claiming coupling issues

If you cannot verify a claim with tools, note it as "apparent" or "potential" rather than definitive.

## What to Look For

### Code Smells
- **God Classes/Modules**: Files doing too many things (>300 lines is a signal)
- **Long Methods**: Functions over 50 lines, especially with deep nesting
- **Feature Envy**: Code that uses another class's data more than its own
- **Data Clumps**: Groups of data that travel together but aren't encapsulated
- **Primitive Obsession**: Overuse of primitives instead of small objects
- **Switch Statements**: Repeated switch/if chains that could be polymorphism
- **Speculative Generality**: Unused abstraction "just in case"

### TODO/FIXME/HACK Tracking
Track these with context:
- What specifically needs to be done?
- Why was it deferred?
- Any related issues or constraints?
- Rough priority/urgency if evident

### SOLID Principle Violations
- **S**: Single Responsibility - One reason to change
- **O**: Open/Closed - Open for extension, closed for modification
- **L**: Liskov Substitution - Subtypes must be substitutable
- **I**: Interface Segregation - Many specific interfaces > one general
- **D**: Dependency Inversion - Depend on abstractions, not concretions

### Other Indicators
- Commented-out code (should be deleted or documented why kept)
- Magic numbers/strings without explanation
- Missing error handling or overly broad exception catches
- Tight coupling between modules
- Circular dependencies
- Missing or outdated documentation for complex logic

## Debt Trends

Classify the commit's overall impact:
- **adding_debt**: Net increase in technical debt
- **reducing_debt**: Refactoring, cleanup, debt paydown
- **neutral**: No significant debt impact
- **mixed**: Some debt added, some reduced

## Confidence Scoring

- **0.9+**: Clear debt indicators with high certainty
- **0.7-0.9**: Likely debt but may need context to confirm
- **0.5-0.7**: Potential debt, situational
- **<0.5**: Minor or uncertain issues

## Output Guidelines

1. Be specific - "Long method" is less useful than "Method xyz() is 120 lines with 5 levels of nesting"
2. Provide actionable remediation - What specifically should be done?
3. Prioritize findings - Not all debt is equally important
4. Consider context - A TODO in test code is less critical than in core business logic
5. Track hotspots - Files that accumulate debt deserve special attention

Your analysis helps developers know "this module has significant technical debt, tread carefully" - that's as valuable as knowing what the module does.`;
