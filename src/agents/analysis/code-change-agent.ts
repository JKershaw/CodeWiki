import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import {
  getCommitDiff,
  createCodebaseToolExecutor,
  fetchAffectedFileContents,
  formatFetchedFilesForContext,
} from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseListItemsWithFallback,
  parseBlocks,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Code Change Agent - Standard analysis of what changed in a commit.
 *
 * OPTIMIZATION: Pre-fetches affected file contents and includes them
 * directly in the prompt, reducing tool calls. Falls back to tool-based
 * approach only if context would exceed limits.
 *
 * This is the basic analysis agent that looks at commits and generates
 * wiki content describing what changed and why.
 */
export class CodeChangeAgent implements Agent {
  readonly type: AgentType = 'code-change';

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
      throw new Error(`CodeChangeAgent cannot handle target type: ${target.type}`);
    }
    const commitId = target.commitId;

    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    // Get the diff for this commit (uses repoService if available, falls back to git)
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
      maxTokens: 3000,
      temperature: 0.3,
    });

    const analysis = this.parseResponse(completion.content);
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

PAGE_TITLE: [Descriptive title like "Multi-Agent Processing Pipeline" - NOT "Commit abc123"]

SUMMARY:
[2-3 paragraph article written in encyclopedia style. Do NOT start with "This commit..." - write as if explaining the feature/change to someone who doesn't know it came from a commit. Focus on WHAT exists and WHY, not on the commit itself.]

FINDINGS:
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_UPDATES:
=== path: category/page-name | action: create ===
[Write the FULL markdown content for this wiki page here.
Include:
- A clear explanation of what this component/concept is
- How it works (mechanism, key functions, data flow)
- Usage examples or patterns if applicable
- Any important caveats or edge cases

Do NOT just write a brief description - write a complete article.]
=== END ===

CONFIDENCE: [0-1 value]

## Example

PAGE_TITLE: Multi-Agent Processing Pipeline

SUMMARY:
The multi-agent architecture distributes code analysis across specialized agents, each focused on a specific aspect of the codebase. This design enables parallel processing and allows each agent to develop deep expertise in its domain.

The pipeline coordinates agent execution, manages their outputs, and synthesizes results into cohesive wiki documentation. Each agent produces structured findings that are aggregated and deduplicated before wiki pages are generated.

FINDINGS:
- type: Architecture | importance: high | description: Multi-agent coordination with parallel execution | paths: src/pipeline/coordinator.ts, src/agents/base-agent.ts

WIKI_UPDATES:
=== path: architecture/multi-agent-pipeline | action: create ===
# Multi-Agent Processing Pipeline

The processing pipeline coordinates multiple specialized agents to analyze code changes.

## How It Works

1. **Work Distribution**: The coordinator receives commits and assigns them to relevant agents
2. **Parallel Execution**: Agents run concurrently, each analyzing their specialty
3. **Result Aggregation**: Findings are merged and deduplicated
4. **Wiki Generation**: Aggregated results become wiki pages

## Key Components

- \`Coordinator\`: Manages agent lifecycle and work distribution
- \`BaseAgent\`: Abstract base class defining the agent interface
- \`AgentResult\`: Structured output format for agent findings

## Usage

Agents are registered with the coordinator at startup and automatically invoked for relevant commits.
=== END ===

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

    return `Analyze this git commit and write wiki articles about the changes.

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
- Understand the complete context beyond just the changed lines
- Write accurate documentation based on the actual source code
- Identify how the changes fit into the overall architecture

Write documentation as wiki articles that a developer would find useful. Focus on:
1. What capability or change was introduced (not "this commit adds...")
2. Why it matters and how it fits into the system
3. Key technical details and design decisions
4. Any patterns, conventions, or gotchas

Format your response as follows:

PAGE_TITLE: [Descriptive title like "Multi-Agent Processing Pipeline" - NOT "Commit abc123"]

SUMMARY:
[2-3 paragraph article written in encyclopedia style. Do NOT start with "This commit..." - write as if explaining the feature/change to someone who doesn't know it came from a commit. Focus on WHAT exists and WHY, not on the commit itself.]

FINDINGS:
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_UPDATES:
=== path: category/page-name | action: create ===
[Write the FULL markdown content for this wiki page here.
Include:
- A clear explanation of what this component/concept is
- How it works (mechanism, key functions, data flow)
- Usage examples or patterns if applicable
- Any important caveats or edge cases

Do NOT just write a brief description - write a complete article.]
=== END ===

CONFIDENCE: [0-1 value]

## Example

PAGE_TITLE: Multi-Agent Processing Pipeline

SUMMARY:
The multi-agent architecture distributes code analysis across specialized agents...

FINDINGS:
- type: Architecture | importance: high | description: Multi-agent coordination | paths: src/pipeline/coordinator.ts

WIKI_UPDATES:
=== path: architecture/multi-agent-pipeline | action: create ===
# Multi-Agent Processing Pipeline

The processing pipeline coordinates multiple specialized agents...
=== END ===

CONFIDENCE: 0.85
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('code-change', response);

    // Parse page title
    const pageTitle = parseSection(ctx, 'PAGE_TITLE', /PAGE_TITLE:\s*(.+?)(?=\n|SUMMARY:|$)/i) ?? '';

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i) ?? '';

    // Define finding patterns - pipe-separated format
    const findingPatterns: ItemPattern<ParsedAnalysis['findings'][0]>[] = [
      {
        // New format: - type: X | importance: Y | description: Z | paths: A, B
        pattern: /^-\s*type:\s*([^|]+)\s*\|\s*importance:\s*(\w+)\s*\|\s*description:\s*([^|]+?)(?:\s*\|\s*paths:\s*(.+))?$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: m[2]!.toLowerCase() as 'low' | 'medium' | 'high',
          description: m[3]!.trim(),
          paths: m[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
        }),
      },
    ];

    const findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Parse wiki updates using block format: === path: X | action: Y ===
    const wikiUpdates = parseBlocks<ParsedAnalysis['wikiUpdates'][0]>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      /===\s*path:\s*([^|=]+)\s*\|\s*action:\s*(create|update|merge)\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi,
      (m) => {
        const content = m[3]!.trim();
        if (content && content.length > 0) {
          return {
            path: m[1]!.trim(),
            action: m[2]!.toLowerCase() as 'create' | 'update' | 'merge',
            content,
          };
        }
        return null;
      }
    );

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      pageTitle,
      summary,
      findings,
      wikiUpdates,
      confidence,
    };
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
 * Handles merge commits, conventional commits, and regular messages.
 */
export function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;

  // Handle "Merge pull request #X from user/branch-name" format
  if (firstLine.startsWith('Merge pull request')) {
    const branchMatch = firstLine.match(/from\s+\S+\/(.+)$/);
    if (branchMatch) {
      const branchName = branchMatch[1]!;
      // Remove common prefixes like "claude/", "feature/", "fix/"
      const cleanedBranch = branchName.replace(/^(claude|feature|fix|bugfix|hotfix|release)[/-]/i, '');
      // Remove trailing session IDs (like -01abc123xyz)
      const withoutSessionId = cleanedBranch.replace(/-[0-9a-zA-Z]{20,}$/, '');
      // Convert branch-name-style to Title Case
      return withoutSessionId
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }
    return 'Merged Changes';
  }

  // Handle "Merge branch 'x' into 'y'" format
  if (firstLine.startsWith('Merge branch')) {
    const branchMatch = firstLine.match(/Merge branch '([^']+)'/);
    if (branchMatch) {
      return branchMatch[1]!
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }
    return 'Merged Changes';
  }

  // Remove common prefixes like "feat:", "fix:", etc.
  const cleaned = firstLine.replace(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([^)]+\))?:\s*/i, '');
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const SYSTEM_PROMPT = `You are a technical writer creating wiki documentation from code changes.

## Tools

Use these to understand context beyond the diff:
- read_file: Read complete file contents
- search_files: Find related files (especially tests)
- list_directory: Understand project structure

## Workflow

1. Use read_file to see complete files, not just diff
2. Search for test files to find usage examples
3. Write documentation based on actual code

## Style

Write encyclopedia articles, not commit summaries.

Good: "The authentication system provides secure user login using OAuth 2.0..."
Bad: "This commit adds a new authentication system..."

## Content

Every wiki page should cover:
1. **Purpose**: What problem this solves
2. **Mechanism**: How it works (control flow, key functions)
3. **Usage**: How developers use it (include test examples)
4. **Boundaries**: Limitations and edge cases

Use lowercase paths with hyphens (e.g., "architecture/cqrs-pattern").

## Confidence

0.9+: Clear implementation. 0.7-0.9: Reasonable inference. 0.5-0.7: Some ambiguity. <0.5: Needs review.`;

/**
 * System prompt for pre-fetch approach (file contents already provided, no tools needed).
 */
const SYSTEM_PROMPT_PREFETCH = `You are a technical writer creating wiki documentation from code changes. Full file contents are provided below.

## Style

Write encyclopedia articles, not commit summaries.

Good: "The authentication system provides secure user login using OAuth 2.0..."
Bad: "This commit adds a new authentication system..."

## Content

Every wiki page should cover:
1. **Purpose**: What problem this solves
2. **Mechanism**: How it works (control flow, key functions)
3. **Usage**: How developers use it
4. **Boundaries**: Limitations and edge cases

Use lowercase paths with hyphens (e.g., "architecture/cqrs-pattern").

## Confidence

0.9+: Clear implementation. 0.7-0.9: Reasonable inference. 0.5-0.7: Some ambiguity. <0.5: Needs review.`;
