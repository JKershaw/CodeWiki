import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';

/**
 * Code Change Agent - Standard analysis of what changed in a commit.
 *
 * This is the basic analysis agent that looks at commits and generates
 * wiki content describing what changed and why.
 */
export class CodeChangeAgent implements Agent {
  readonly type: AgentType = 'code-change';

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit from the repository
    const commit = await context.repos.commits.findById(commitId);
    if (!commit) {
      throw new Error(`Commit not found: ${commitId}`);
    }

    // Get the diff for this commit
    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);

    // Build the prompt for the LLM
    const prompt = this.buildPrompt(commit, diff);

    // Get LLM analysis
    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3,
    });

    // Parse the LLM response
    const analysis = this.parseResponse(completion.content);

    // Generate wiki updates based on the analysis
    const updates = this.generateUpdates(commit, analysis, context.repoId);

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

  private buildPrompt(commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } }, diff: string): string {
    const truncatedDiff = diff.length > 10000 ? diff.slice(0, 10000) + '\n... (diff truncated)' : diff;

    return `Analyze this git commit and provide structured documentation for a wiki.

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

Please analyze this commit and provide:
1. A concise summary of what changed and why
2. Key findings (patterns, architectural decisions, potential issues)
3. Suggested wiki pages that should be created or updated
4. Confidence level in your analysis (0-1)

Format your response as follows:

SUMMARY:
[Your summary here]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths comma-separated]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update/merge] [Brief description of content]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      findings: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (findingsMatch) {
      const findingLines = findingsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of findingLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.findings.push({
            type: match[1]!.trim(),
            importance: (match[2]!.toLowerCase() as 'low' | 'medium' | 'high'),
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse wiki updates
    const updatesMatch = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesMatch) {
      const updateLines = updatesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of updateLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(\w+)\]\s*(.+)$/i);
        if (match) {
          analysis.wikiUpdates.push({
            path: match[1]!.trim(),
            action: match[2]!.toLowerCase() as 'create' | 'update' | 'merge',
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
    analysis: ParsedAnalysis,
    repoId: string
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    // Always create/update a page for the commit itself
    const commitPagePath = `commits/${commit.sha.slice(0, 8)}`;
    const commitPageContent = `# Commit ${commit.sha.slice(0, 8)}

${commit.message}

## Summary

${analysis.summary}

## Findings

${analysis.findings.map(f => `- **${f.type}** (${f.importance}): ${f.description}`).join('\n')}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- \`${f}\``).join('\n')}
`;

    updates.push({
      type: 'create',
      path: commitPagePath,
      content: commitPageContent,
      sourceCommitId: commit.sha,
      agentRunId: '', // Will be set by the executor
      confidenceDelta: 0.1,
    });

    // Generate updates for suggested wiki pages
    for (const wikiUpdate of analysis.wikiUpdates) {
      // Skip commit page as we already handle it
      if (wikiUpdate.path.startsWith('commits/')) continue;

      updates.push({
        type: wikiUpdate.action,
        path: wikiUpdate.path,
        content: `# ${pathToTitle(wikiUpdate.path)}

${wikiUpdate.description}

---
*Updated based on commit ${commit.sha.slice(0, 8)}*
`,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: wikiUpdate.action === 'create' ? 0.3 : 0.1,
      });
    }

    return updates;
  }
}

interface ParsedAnalysis {
  summary: string;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update' | 'merge';
    description: string;
  }>;
  confidence: number;
}

/**
 * Convert a path like "architecture/cqrs" to a title like "CQRS".
 */
function pathToTitle(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SYSTEM_PROMPT = `You are a code analysis agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to analyze commits and extract meaningful documentation that captures:
- What changed and why
- Architectural decisions and patterns
- Potential issues or technical debt
- Connections to other parts of the codebase

Be concise but thorough. Focus on the "why" behind changes, not just the "what".

When suggesting wiki pages:
- Use lowercase paths with hyphens (e.g., "architecture/cqrs-pattern")
- Group related content (e.g., "components/auth", "guides/testing")
- Prefer updating existing pages over creating new ones for small changes

Your confidence should reflect:
- 0.9+: Clear commit message, obvious changes, well-documented code
- 0.7-0.9: Reasonable inference from code and message
- 0.5-0.7: Some ambiguity, might need verification
- <0.5: Significant uncertainty, needs human review`;
