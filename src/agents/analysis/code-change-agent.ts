import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import {
  getCommitDiff,
  createCodebaseToolExecutor,
  fetchAffectedFileContents,
  formatFileContentsForPrompt,
} from '../agent-helpers.js';

/**
 * Code Change Agent - Concept-focused analysis of code changes.
 *
 * This agent analyzes commits and updates CONCEPT pages (not commit pages).
 * Instead of creating a page per commit, it identifies which concepts are
 * affected and enriches those concept pages with information from the commit.
 *
 * This prevents wiki fragmentation where hundreds of commit pages make
 * information hard to find. Instead, information accumulates on concept
 * pages like "architecture/cqrs" or "components/auth-service".
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

    // Pre-fetch full contents of affected files for richer context
    const fileContents = await fetchAffectedFileContents(
      context,
      commit.diffSummary.affectedFiles
    );
    const formattedFileContents = formatFileContentsForPrompt(fileContents);

    // Build the prompt for the LLM
    const prompt = this.buildPrompt(commit, diff, formattedFileContents);

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
    };
  }

  private buildPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    fileContents: string
  ): string {
    const truncatedDiff = diff.length > 10000 ? diff.slice(0, 10000) + '\n... (diff truncated)' : diff;

    return `Analyze this code change and update the relevant CONCEPT wiki pages.

## Code Change Context

**Message:** ${commit.message}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Full File Contents

These are the complete source files (not just diffs) so you can understand the full context:

${fileContents}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Your Task

Identify what CONCEPTS this change affects and create/update wiki pages for those concepts.

**CRITICAL: Do NOT create a "commit page" or changelog entry.** Instead:
1. Identify the component, pattern, or feature being modified
2. Create or update a CONCEPT page (e.g., "architecture/cqrs", "components/auth-service")
3. Write the page as if explaining the concept to someone who doesn't know about commits

**Good paths:** architecture/event-sourcing, components/user-auth, patterns/repository, services/email-sender
**Bad paths:** commits/abc123, changes/2024-01-15, updates/fix-auth-bug

## Response Format

CONCEPT:
[What concept/component/feature does this change affect? 1-2 sentences.]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths comma-separated]

WIKI_PAGES:
For each concept page that should be created or updated, provide FULL article content.

=== [CONCEPT_PATH] [ACTION:create/update/merge] ===
[Write the FULL markdown content for this concept page.

Start with: # [Concept Title]

Include these sections:
## Overview
What is this? Why does it exist? (2-3 paragraphs)

## How It Works
Technical details, control flow, key functions (2-4 paragraphs)

## Usage
How to use/configure this. Code examples from tests if available.

## Related
Links to related concepts: [[other-concept]]

Do NOT mention commits, dates, or changelogs. Write as encyclopedia content.]
=== END ===

(Include 1-3 concept pages. Most changes affect 1-2 concepts.)

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      concept: '',
      summary: '',
      findings: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse concept description
    const conceptMatch = response.match(/CONCEPT:\s*(.+?)(?=\n|FINDINGS:|$)/is);
    if (conceptMatch) {
      analysis.concept = conceptMatch[1]!.trim();
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=WIKI_PAGES:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
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

    // Parse wiki pages (concept pages) - supports both WIKI_PAGES and WIKI_UPDATES
    const pagesSection = response.match(/WIKI_(?:PAGES|UPDATES):\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (pagesSection) {
      // Match blocks like: === [path] [action] ===\n[content]\n=== END ===
      const blockRegex = /===\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(pagesSection[1]!)) !== null) {
        const path = blockMatch[1]!.trim();
        const action = blockMatch[2]!.toLowerCase() as 'create' | 'update' | 'merge';
        const content = blockMatch[3]!.trim();

        // Skip commit pages - enforce concept-only output
        if (path.startsWith('commits/') || path.startsWith('changes/') || path.startsWith('updates/')) {
          continue;
        }

        if (content && content.length > 0) {
          analysis.wikiUpdates.push({
            path,
            action,
            content,
          });
        }
      }
    }

    // Use concept as summary if no explicit summary
    if (!analysis.summary && analysis.concept) {
      analysis.summary = analysis.concept;
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

    // Generate updates for concept pages ONLY (no commit pages)
    for (const wikiUpdate of analysis.wikiUpdates) {
      // Double-check: skip any commit-style pages that slipped through
      if (wikiUpdate.path.startsWith('commits/') ||
          wikiUpdate.path.startsWith('changes/') ||
          wikiUpdate.path.startsWith('updates/')) {
        continue;
      }

      // Use the full content provided by the LLM
      const content = wikiUpdate.content;

      // Extract title from content if it starts with a heading, otherwise generate from path
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1]!.trim() : pathToTitle(wikiUpdate.path);

      updates.push({
        type: wikiUpdate.action,
        path: wikiUpdate.path,
        title,
        content,
        sourceCommitId: commit.sha,  // Track provenance without creating commit page
        agentRunId: '',
        confidenceDelta: wikiUpdate.action === 'create' ? 0.4 : 0.2,
      });
    }

    // If no concept pages were generated, create a fallback based on file paths
    if (updates.length === 0 && analysis.summary) {
      const fallbackPath = this.inferConceptPath(commit.diffSummary.affectedFiles);
      const fallbackTitle = pathToTitle(fallbackPath);

      updates.push({
        type: 'update',  // Prefer update to accumulate on existing pages
        path: fallbackPath,
        title: fallbackTitle,
        content: `# ${fallbackTitle}\n\n${analysis.summary}`,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.15,
      });
    }

    return updates;
  }

  /**
   * Infer a concept page path from affected file paths.
   * This provides a fallback when the LLM doesn't output explicit concept pages.
   */
  private inferConceptPath(affectedFiles: string[]): string {
    if (affectedFiles.length === 0) {
      return 'components/general';
    }

    // Find common directory prefix
    const dirs = affectedFiles
      .map(f => f.split('/').slice(0, -1))  // Remove filename
      .filter(parts => parts.length > 0);

    if (dirs.length === 0) {
      return 'components/root';
    }

    // Get the most common first directory
    const firstDirs = dirs.map(d => d[0]).filter(Boolean);
    const dirCounts = new Map<string, number>();
    for (const dir of firstDirs) {
      dirCounts.set(dir!, (dirCounts.get(dir!) || 0) + 1);
    }

    let maxDir = 'src';
    let maxCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > maxCount) {
        maxDir = dir;
        maxCount = count;
      }
    }

    // Map common source directories to wiki categories
    const categoryMap: Record<string, string> = {
      'src': 'components',
      'lib': 'components',
      'packages': 'packages',
      'services': 'services',
      'agents': 'agents',
      'domain': 'domain',
      'tests': 'testing',
      'docs': 'documentation',
    };

    const category = categoryMap[maxDir] || 'components';

    // Get second-level directory if available
    const secondDirs = dirs
      .filter(d => d[0] === maxDir && d.length > 1)
      .map(d => d[1]);

    if (secondDirs.length > 0) {
      const secondCounts = new Map<string, number>();
      for (const dir of secondDirs) {
        secondCounts.set(dir!, (secondCounts.get(dir!) || 0) + 1);
      }

      let maxSecond = '';
      let maxSecondCount = 0;
      for (const [dir, count] of secondCounts) {
        if (count > maxSecondCount) {
          maxSecond = dir;
          maxSecondCount = count;
        }
      }

      if (maxSecond) {
        return `${category}/${maxSecond}`;
      }
    }

    return `${category}/${maxDir}`;
  }
}

interface ParsedAnalysis {
  concept: string;  // Description of the concept(s) affected by this change
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

const SYSTEM_PROMPT = `You are a technical writer maintaining a concept-focused wiki from code changes.

## Core Principle: CONCEPT PAGES, NOT COMMIT PAGES

Your job is to update CONCEPT pages (like "architecture/cqrs" or "services/auth") - NOT create commit summaries.
When code changes, identify WHAT CONCEPT it affects and update that concept's wiki page.

**DO NOT** create pages like:
- commits/abc123
- changes/fix-auth-bug
- updates/2024-01-15

**DO** create/update pages like:
- architecture/event-sourcing
- components/user-service
- patterns/repository
- services/email-sender

## Tools Available

You have access to tools to explore the source code:
- read_file: Read the FULL contents of any file
- search_files: Find related files by glob pattern
- list_directory: Understand project structure

## Workflow

1. Read the changed files to understand WHAT concept is being modified
2. Search for related test files to find usage examples
3. Identify the 1-2 concepts this change affects
4. Write/update those concept pages with the new information

## Writing Style

Write as encyclopedia articles:
- BAD: "This commit adds authentication..."
- GOOD: "The authentication system provides secure user login..."

Every concept page should have:
1. **Overview**: What is this? Why does it exist?
2. **How It Works**: Technical details, control flow, key functions
3. **Usage**: Code examples (preferably from tests)
4. **Related**: Links to related concepts

## Key Rules

1. **Accumulate knowledge**: Update existing concept pages rather than creating new ones
2. **No commit references**: Don't mention commits, dates, or changelogs in content
3. **Use real examples**: Extract code examples from test files when available
4. **Be specific**: Write about THIS code, not generic concepts

Your confidence should reflect documentation completeness:
- 0.9+: Clear, complete documentation with examples
- 0.7-0.9: Good coverage but some gaps
- 0.5-0.7: Partial documentation, needs enrichment
- <0.5: Minimal coverage, significant gaps`;
