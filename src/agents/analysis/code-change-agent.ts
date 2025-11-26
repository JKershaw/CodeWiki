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

    return `Analyze this git commit and write a wiki article about the changes.

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

Write documentation as a wiki article that a developer would find useful. Focus on:
1. What capability or change was introduced (not "this commit adds...")
2. Why it matters and how it fits into the system
3. Key technical details and design decisions
4. Any patterns, conventions, or gotchas

Format your response as follows:

PAGE_TITLE:
[Descriptive title like "Multi-Agent Processing Pipeline" or "CQRS Architecture Implementation" - NOT "Commit abc123"]

SUMMARY:
[2-3 paragraph article written in encyclopedia style. Do NOT start with "This commit..." - write as if explaining the feature/change to someone who doesn't know it came from a commit. Focus on WHAT exists and WHY, not on the commit itself.]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths comma-separated]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update/merge] [Brief description of content]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      pageTitle: '',
      summary: '',
      findings: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse page title
    const titleMatch = response.match(/PAGE_TITLE:\s*(.+?)(?=\n|SUMMARY:|$)/i);
    if (titleMatch) {
      analysis.pageTitle = titleMatch[1]!.trim();
    }

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

    // Use descriptive title from LLM, fall back to commit message summary
    const pageTitle = analysis.pageTitle || extractTitleFromMessage(commit.message);
    const commitPagePath = `commits/${commit.sha.slice(0, 8)}`;

    // Build findings section only if there are findings
    const findingsSection = analysis.findings.length > 0
      ? `## Key Findings

${analysis.findings.map(f => `- **${f.type}** (${f.importance}): ${f.description}`).join('\n')}`
      : '';

    const commitPageContent = `# ${pageTitle}

${analysis.summary}

${findingsSection}

## Source

- **Commit:** ${commit.sha.slice(0, 8)}
- **Files:** ${commit.diffSummary.affectedFiles.map(f => `\`${f}\``).join(', ')}
`;

    updates.push({
      type: 'create',
      path: commitPagePath,
      title: pageTitle,  // Store title separately for wiki page
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
  pageTitle: string;
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

/**
 * Extract a title from a commit message.
 * Takes the first line and cleans it up.
 */
function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  // Remove common prefixes like "feat:", "fix:", etc.
  const cleaned = firstLine.replace(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([^)]+\))?:\s*/i, '');
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const SYSTEM_PROMPT = `You are a technical writer creating wiki documentation from code changes.

CRITICAL: Write as encyclopedia articles, NOT commit summaries.

BAD: "This commit adds a new authentication system..."
GOOD: "The authentication system provides secure user login using OAuth 2.0..."

Your documentation should:
- Describe WHAT EXISTS, not what was committed
- Explain WHY the system works this way
- Help developers understand and use the code
- Read like Wikipedia, not a changelog

Give each page a descriptive title that captures the topic (e.g., "Multi-Agent Processing Pipeline", "OAuth Authentication Flow"), NOT "Commit abc123".

When suggesting wiki pages:
- Use lowercase paths with hyphens (e.g., "architecture/cqrs-pattern")
- Group related content (e.g., "components/auth", "guides/testing")
- Prefer updating existing pages over creating new ones for small changes

Your confidence should reflect:
- 0.9+: Clear implementation, well-documented code
- 0.7-0.9: Reasonable inference from code
- 0.5-0.7: Some ambiguity, might need verification
- <0.5: Significant uncertainty, needs review`;
