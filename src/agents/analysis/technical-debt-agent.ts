import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';

/**
 * Technical Debt Agent - Analyzes commits for code quality issues.
 *
 * This agent identifies technical debt indicators including:
 * - Complexity issues (long functions, deep nesting, high cyclomatic complexity)
 * - Code duplication and DRY violations
 * - Technical shortcuts (TODO/FIXME comments, magic numbers)
 * - Maintainability concerns (tight coupling, large parameter lists)
 * - Missing abstractions and code smells
 */
export class TechnicalDebtAgent implements Agent {
  readonly type: AgentType = 'technical-debt';

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    const commit = await context.repos.commits.findById(commitId);
    if (!commit) {
      throw new Error(`Commit not found: ${commitId}`);
    }

    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
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
    };
  }

  private buildPrompt(
    commit: {
      sha: string;
      message: string;
      authorName: string;
      committedAt: Date;
      diffSummary: {
        affectedFiles: string[];
        linesAdded: number;
        linesDeleted: number;
      };
    },
    diff: string
  ): string {
    const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for technical debt and code quality issues.

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
1. **Complexity Issues**: Long functions (>50 LOC), deep nesting (>4 levels), complex conditionals
2. **Code Duplication**: Repeated patterns, copy-paste code, DRY violations
3. **Technical Shortcuts**: TODO/FIXME comments, magic numbers/strings, hardcoded values
4. **Maintainability**: Tight coupling, large parameter lists (>5), missing error handling
5. **Code Smells**: God classes/functions, feature envy, inappropriate intimacy
6. **Missing Abstractions**: Repeated logic that should be extracted
7. **Test Coverage Gaps**: Complex code without corresponding tests
8. **Documentation Debt**: Complex logic without explanatory comments

Format your response as:

SUMMARY:
[Brief assessment of technical debt in this commit - note if debt is being added, removed, or if the commit is debt-neutral]

DEBT_LEVEL:
[One of: critical, high, medium, low, none]

ISSUES:
- [CATEGORY] [SEVERITY:critical/high/medium/low] [Description] [Affected paths]

DEBT_ADDED:
- [New technical debt items introduced]

DEBT_REMOVED:
- [Technical debt that was resolved or refactored away]

RECOMMENDATIONS:
- [Specific, actionable recommendations for improvement]

HOTSPOTS:
- [File paths that are becoming debt hotspots]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      debtLevel: 'none',
      findings: [],
      debtAdded: [],
      debtRemoved: [],
      recommendations: [],
      hotspots: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=DEBT_LEVEL:|ISSUES:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse debt level
    const levelMatch = response.match(/DEBT_LEVEL:\s*(\w+)/i);
    if (levelMatch) {
      analysis.debtLevel = levelMatch[1]!.toLowerCase() as DebtLevel;
    }

    // Parse issues/findings
    const issuesMatch = response.match(/ISSUES:\s*([\s\S]*?)(?=DEBT_ADDED:|DEBT_REMOVED:|RECOMMENDATIONS:|HOTSPOTS:|CONFIDENCE:|$)/i);
    if (issuesMatch) {
      const issueLines = issuesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of issueLines) {
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

    // Parse debt added
    const debtAddedMatch = response.match(/DEBT_ADDED:\s*([\s\S]*?)(?=DEBT_REMOVED:|RECOMMENDATIONS:|HOTSPOTS:|CONFIDENCE:|$)/i);
    if (debtAddedMatch) {
      const lines = debtAddedMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const item = line.replace(/^-\s*/, '').trim();
        if (item && !item.toLowerCase().includes('none') && !item.toLowerCase().includes('n/a')) {
          analysis.debtAdded.push(item);
        }
      }
    }

    // Parse debt removed
    const debtRemovedMatch = response.match(/DEBT_REMOVED:\s*([\s\S]*?)(?=RECOMMENDATIONS:|HOTSPOTS:|CONFIDENCE:|$)/i);
    if (debtRemovedMatch) {
      const lines = debtRemovedMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const item = line.replace(/^-\s*/, '').trim();
        if (item && !item.toLowerCase().includes('none') && !item.toLowerCase().includes('n/a')) {
          analysis.debtRemoved.push(item);
        }
      }
    }

    // Parse recommendations
    const recsMatch = response.match(/RECOMMENDATIONS:\s*([\s\S]*?)(?=HOTSPOTS:|CONFIDENCE:|$)/i);
    if (recsMatch) {
      const lines = recsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const item = line.replace(/^-\s*/, '').trim();
        if (item && !item.toLowerCase().includes('none') && !item.toLowerCase().includes('n/a')) {
          analysis.recommendations.push(item);
        }
      }
    }

    // Parse hotspots
    const hotspotsMatch = response.match(/HOTSPOTS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (hotspotsMatch) {
      const lines = hotspotsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const item = line.replace(/^-\s*/, '').trim();
        if (item && !item.toLowerCase().includes('none') && !item.toLowerCase().includes('n/a')) {
          analysis.hotspots.push(item);
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

    // Only create wiki content for commits with notable technical debt
    if (analysis.debtLevel === 'none' && analysis.findings.length === 0) {
      return updates;
    }

    // Create technical debt report page for significant findings
    if (analysis.debtLevel === 'critical' || analysis.debtLevel === 'high' ||
        analysis.findings.length >= 2) {
      const pagePath = `technical-debt/report-${commit.sha.slice(0, 8)}`;

      const content = `# Technical Debt Report: Commit ${commit.sha.slice(0, 8)}

**Debt Level:** ${analysis.debtLevel.toUpperCase()}
**Commit:** ${commit.message.split('\n')[0]}

## Summary

${analysis.summary}

${analysis.findings.length > 0 ? `## Issues Found

${analysis.findings.map(f => `### ${f.type} (${f.importance})

${f.description}

${f.paths.length > 0 ? `**Affected files:** ${f.paths.map(p => `\`${p}\``).join(', ')}` : ''}`).join('\n\n')}` : ''}

${analysis.debtAdded.length > 0 ? `## Debt Added

${analysis.debtAdded.map(d => `- ${d}`).join('\n')}` : ''}

${analysis.debtRemoved.length > 0 ? `## Debt Removed

${analysis.debtRemoved.map(d => `- ${d}`).join('\n')}` : ''}

${analysis.recommendations.length > 0 ? `## Recommendations

${analysis.recommendations.map(r => `- ${r}`).join('\n')}` : ''}

${analysis.hotspots.length > 0 ? `## Hotspots

These files are accumulating technical debt:

${analysis.hotspots.map(h => `- \`${h}\``).join('\n')}` : ''}

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
        confidenceDelta: analysis.debtLevel === 'critical' ? 0.5 : 0.3,
      });
    }

    // Update technical debt overview/tracker page
    if (analysis.findings.length > 0 || analysis.hotspots.length > 0) {
      const overviewContent = `# Technical Debt Overview

## Recent Changes

### Commit ${commit.sha.slice(0, 8)}

**Level:** ${analysis.debtLevel}

${analysis.summary.slice(0, 200)}${analysis.summary.length > 200 ? '...' : ''}

${analysis.debtAdded.length > 0 ? `**Added:** ${analysis.debtAdded.slice(0, 3).join(', ')}` : ''}
${analysis.debtRemoved.length > 0 ? `**Resolved:** ${analysis.debtRemoved.slice(0, 3).join(', ')}` : ''}

${analysis.hotspots.length > 0 ? `## Current Hotspots

${analysis.hotspots.map(h => `- \`${h}\``).join('\n')}` : ''}

${analysis.recommendations.length > 0 ? `## Priority Recommendations

${analysis.recommendations.slice(0, 5).map(r => `- ${r}`).join('\n')}` : ''}

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'update',
        path: 'technical-debt/overview',
        content: overviewContent,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.1,
      });
    }

    return updates;
  }
}

type DebtLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

interface ParsedAnalysis {
  summary: string;
  debtLevel: DebtLevel;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  debtAdded: string[];
  debtRemoved: string[];
  recommendations: string[];
  hotspots: string[];
  confidence: number;
}

function mapSeverityToImportance(severity: string): 'low' | 'medium' | 'high' {
  if (severity === 'critical' || severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

const SYSTEM_PROMPT = `You are a technical debt analysis agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to identify technical debt and code quality issues in commits. Focus on actionable findings that impact maintainability.

## What to Look For

**Complexity Issues:**
- Functions exceeding 50 lines of code
- Nesting deeper than 4 levels
- Cyclomatic complexity > 10
- Complex boolean expressions
- Switch statements with many cases

**Code Duplication:**
- Copy-pasted code blocks
- Similar patterns that could be abstracted
- Repeated conditionals
- DRY violations

**Technical Shortcuts:**
- TODO, FIXME, HACK, XXX comments
- Magic numbers and strings
- Hardcoded configuration values
- Temporary workarounds made permanent

**Maintainability Concerns:**
- Tight coupling between modules
- Functions with >5 parameters
- Missing or inadequate error handling
- Inconsistent error handling patterns
- Global state mutations

**Code Smells:**
- God classes (>500 LOC or too many responsibilities)
- Feature envy (method uses another class more than its own)
- Long parameter lists
- Data clumps (same data items appearing together)
- Primitive obsession (using primitives instead of small objects)

**Missing Abstractions:**
- Repeated patterns that should be helper functions
- Similar classes that could share a base
- Inline logic that should be extracted

Debt Levels:
- **critical**: Severe maintainability issues, blocking refactoring needed
- **high**: Significant debt that should be addressed soon
- **medium**: Notable issues worth tracking
- **low**: Minor improvements possible
- **none**: Clean code, no significant debt

Be balanced - not every commit adds debt. Also recognize when commits REDUCE debt through refactoring.

Your confidence should reflect:
- 0.9+: Clear, obvious technical debt or clean code
- 0.7-0.9: Likely debt issues with good evidence
- 0.5-0.7: Possible issues, context-dependent
- <0.5: Uncertain, may need more context`;
