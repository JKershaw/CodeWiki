import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import {
  getCommitDiff,
  createCodebaseToolExecutor,
} from '../agent-helpers.js';

/**
 * Code Change Agent - Standard analysis of what changed in a commit.
 *
 * This is the basic analysis agent that looks at commits and generates
 * wiki content describing what changed and why.
 */
export class CodeChangeAgent implements Agent {
  readonly type: AgentType = 'code-change';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`CodeChangeAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnCommitImpl(target.commitId, context);
  }

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    return this.runOnCommitImpl(commitId, context);
  }

  private async runOnCommitImpl(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    // Get the diff for this commit (uses repoService if available, falls back to git)
    const diff = await getCommitDiff(context, commit.sha);

    // Build the prompt for the LLM
    // Note: We intentionally do NOT pre-fetch file contents. The LLM must use
    // tools (read_file) to access full file contents. This ensures proper
    // verification and avoids bloating the prompt with potentially large files.
    const prompt = this.buildPrompt(commit, diff);

    // Set up codebase exploration tools (works with both local and GitHub repos)
    const toolExecutor = createCodebaseToolExecutor(context);

    // Get LLM analysis with tool use for deeper understanding
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
      maxTokens: 3000,
      temperature: 0.3,
    });

    // Parse the LLM response
    const analysis = this.parseResponse(completion.content);

    // Generate wiki updates based on the analysis
    const updates = this.generateUpdates(commit, analysis, context.repoId);

    // Include tool usage in findings
    const toolUsageFinding = completion.toolCalls.length > 0
      ? [createFinding({
          type: 'TOOL_USE',
          description: `Read ${completion.toolCalls.filter(c => c.name === 'read_file').length} source files for full context`,
          relatedPaths: completion.toolCalls
            .filter(c => c.name === 'read_file')
            .map(c => c.input['path'] as string)
            .filter(Boolean),
          importance: 'low',
        })]
      : [];

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: [
          ...analysis.findings.map(f => createFinding({
            type: f.type,
            description: f.description,
            relatedPaths: f.paths,
            importance: f.importance,
          })),
          ...toolUsageFinding,
        ],
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: extractToolMetrics(completion),
    };
  }

  private buildPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string
  ): string {
    const truncatedDiff = diff.length > 10000 ? diff.slice(0, 10000) + '\n... (diff truncated)' : diff;

    return `Analyze this git commit and write wiki articles about the changes.

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

## IMPORTANT: Use Tools to Read Full File Contents

The diff above shows only the changed lines. To write accurate documentation, you MUST:
1. Use \`read_file\` to read the COMPLETE contents of affected files
2. Understand the full context, not just the changed lines
3. Verify your documentation against the actual source code

Write documentation as wiki articles that a developer would find useful. Focus on:
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
For each additional wiki page that should be created or updated, provide FULL article content.
Write each page as a complete, standalone article (2-4 paragraphs minimum).

=== [PAGE_PATH] [ACTION:create/update/merge] ===
[Write the FULL markdown content for this wiki page here.
Include:
- A clear explanation of what this component/concept is
- How it works (mechanism, key functions, data flow)
- Usage examples or patterns if applicable
- Any important caveats or edge cases

Do NOT just write a brief description - write a complete article.]
=== END ===

(Repeat for each page)

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

    // Parse wiki updates - new format with full content blocks
    const updatesSection = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesSection) {
      // Match blocks like: === [path] [action] ===\n[content]\n=== END ===
      const blockRegex = /===\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(updatesSection[1]!)) !== null) {
        const path = blockMatch[1]!.trim();
        const action = blockMatch[2]!.toLowerCase() as 'create' | 'update' | 'merge';
        const content = blockMatch[3]!.trim();

        if (content && content.length > 0) {
          analysis.wikiUpdates.push({
            path,
            action,
            content,
          });
        }
      }

      // Fallback: also try to parse old format for backward compatibility
      if (analysis.wikiUpdates.length === 0) {
        const updateLines = updatesSection[1]!.trim().split('\n').filter(l => l.startsWith('-'));
        for (const line of updateLines) {
          const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*(.+)$/i);
          if (match) {
            analysis.wikiUpdates.push({
              path: match[1]!.trim(),
              action: match[2]!.toLowerCase() as 'create' | 'update' | 'merge',
              content: match[3]!.trim(), // Use description as content for legacy format
            });
          }
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
    _repoId: string
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

      // Use the full content provided by the LLM
      // Add a source footer if not already present
      let content = wikiUpdate.content;
      if (!content.includes('*Updated based on commit') && !content.includes('*Source:')) {
        content = `${content}

---
*Updated based on commit ${commit.sha.slice(0, 8)}*`;
      }

      // Extract title from content if it starts with a heading, otherwise generate from path
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1]!.trim() : pathToTitle(wikiUpdate.path);

      updates.push({
        type: wikiUpdate.action,
        path: wikiUpdate.path,
        title,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: wikiUpdate.action === 'create' ? 0.3 : 0.15,
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
    content: string;
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

You have access to tools to explore the actual source code beyond just the diff:
- read_file: Read the FULL contents of any file (not just the changed lines)
- search_files: Find related files by glob pattern (e.g., find test files)
- list_directory: Understand project structure

WORKFLOW - Use tools to understand context:
1. If the diff shows changes to a file, use read_file to see the COMPLETE file
2. Search for related test files (e.g., "**/*.test.ts", "**/*-test.ts", "**/*.spec.ts")
3. Read imports/dependencies to understand how the changed code fits in
4. Only then write your analysis with full context

TEST-BASED USAGE EXAMPLES - Extract real code examples from tests:
When documenting a component, function, or module, use search_files to find related test files and extract real usage examples from them. Test code demonstrates how the component is actually meant to be used with verified, working API calls.

Why this matters:
- Tests are verified working code - they pass CI and reflect actual usage patterns
- Test examples show correct API signatures, avoiding invented or incorrect examples
- Tests often cover edge cases and configuration options developers need to know about

How to find and use test examples:
1. Use search_files with patterns like "**/*.test.ts", "**/*-test.ts", "**/*.spec.ts"
2. Look for tests related to the changed files (e.g., if analyzing "auth.ts", search for "auth.test.ts")
3. Read the test file to find describe/it blocks showing how the component is called
4. Include relevant test snippets as usage examples in your documentation
5. Prioritize examples from tests over inventing your own - real test code is more trustworthy

CRITICAL: Write as encyclopedia articles, NOT commit summaries.

BAD: "This commit adds a new authentication system..."
GOOD: "The authentication system provides secure user login using OAuth 2.0..."

Your documentation should:
- Describe WHAT EXISTS, not what was committed
- Explain WHY the system works this way (use tools to find out!)
- Help developers understand and use the code
- Read like Wikipedia, not a changelog

## Required Content Depth

Every wiki page you create should address:

1. **Purpose**: What problem does this solve? Why does it exist?
2. **Mechanism**: HOW does it work? Describe the control flow, key functions, and interactions.
3. **Usage**: How would a developer use or configure this? Include examples from tests if you found them.
4. **Boundaries**: What are the limitations, edge cases, or failure modes?

If you cannot determine any of these from the code, state what's unclear rather than omitting the section.

Give each page a descriptive title that captures the topic (e.g., "Multi-Agent Processing Pipeline", "OAuth Authentication Flow"), NOT "Commit abc123".

When suggesting wiki pages:
- Use lowercase paths with hyphens (e.g., "architecture/cqrs-pattern")
- Group related content (e.g., "components/auth", "guides/testing")
- Prefer updating existing pages over creating new ones for small changes

Your confidence should reflect:
- 0.9+: Clear implementation, well-documented code, verified with source
- 0.7-0.9: Reasonable inference from code and context
- 0.5-0.7: Some ambiguity, might need verification
- <0.5: Significant uncertainty, needs review`;
