import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff } from '../agent-helpers.js';

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
    return this.runOnCommit(target.commitId, context);
  }

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    const diff = await getCommitDiff(context, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
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
    const analysis: ParsedAnalysis = {
      summary: '',
      debtTrend: 'neutral',
      findings: [],
      todoItems: [],
      solidViolations: [],
      remediations: [],
      hotspots: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=DEBT_TREND:|FINDINGS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse debt trend
    const trendMatch = response.match(/DEBT_TREND:\s*(\w+)/i);
    if (trendMatch) {
      const trend = trendMatch[1]!.toLowerCase();
      if (['adding_debt', 'reducing_debt', 'neutral', 'mixed'].includes(trend)) {
        analysis.debtTrend = trend as DebtTrend;
      }
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=TODO_ITEMS:|SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (findingsMatch) {
      const findingLines = findingsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of findingLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.findings.push({
            type: match[1]!.trim(),
            importance: mapSeverityToImportance(match[2]!.toLowerCase()),
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse TODO items
    const todoMatch = response.match(/TODO_ITEMS:\s*([\s\S]*?)(?=SOLID_VIOLATIONS:|REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (todoMatch) {
      const todoLines = todoMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of todoLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(TODO|FIXME|HACK)\]\s*(.+)$/i);
        if (match) {
          analysis.todoItems.push({
            location: match[1]!.trim(),
            type: match[2]!.toUpperCase() as 'TODO' | 'FIXME' | 'HACK',
            description: match[3]!.trim(),
          });
        }
      }
    }

    // Parse SOLID violations
    const solidMatch = response.match(/SOLID_VIOLATIONS:\s*([\s\S]*?)(?=REMEDIATION:|HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (solidMatch) {
      const solidLines = solidMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of solidLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.solidViolations.push({
            principle: match[1]!.trim(),
            description: match[2]!.trim(),
            paths: match[3]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse remediations
    const remediationMatch = response.match(/REMEDIATION:\s*([\s\S]*?)(?=HOTSPOTS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (remediationMatch) {
      const remLines = remediationMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of remLines) {
        const match = line.match(/^-\s*\[Priority:(\w+)\]\s*(.+)$/i);
        if (match) {
          analysis.remediations.push({
            priority: match[1]!.toLowerCase() as 'high' | 'medium' | 'low',
            recommendation: match[2]!.trim(),
          });
        }
      }
    }

    // Parse hotspots
    const hotspotMatch = response.match(/HOTSPOTS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (hotspotMatch) {
      const hotspotLines = hotspotMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of hotspotLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*(.+)$/);
        if (match) {
          analysis.hotspots.push({
            path: match[1]!.trim(),
            reason: match[2]!.trim(),
          });
        }
      }
    }

    // Parse wiki updates
    const updatesMatch = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesMatch) {
      const updateLines = updatesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of updateLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i);
        if (match) {
          analysis.wikiUpdates.push({
            path: match[1]!.trim(),
            action: match[2]!.toLowerCase() as 'create' | 'update',
            description: match[3]!.trim(),
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

function mapSeverityToImportance(severity: string): 'low' | 'medium' | 'high' {
  if (severity === 'critical' || severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
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
