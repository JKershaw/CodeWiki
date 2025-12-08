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
  parseStringList,
  parseBlocks,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Narrative Agent - Detects meta-documents and captures project storytelling.
 *
 * OPTIMIZATION: Pre-fetches affected file contents and includes them directly in
 * the prompt, reducing tool calls. Falls back to tool-based approach only if
 * context would exceed limits.
 *
 * This agent looks for planning files, ADRs (Architecture Decision Records),
 * idea docs, changelogs, and other narrative content that explains the "why"
 * behind the codebase.
 */
export class NarrativeAgent implements Agent {
  readonly type: AgentType = 'narrative';

  private readonly MAX_FILE_SIZE = 20000;
  private readonly MAX_TOTAL_SIZE = 50000;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`NarrativeAgent cannot handle target type: ${target.type}`);
    }
    const commitId = target.commitId;

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

    return this.runWithTools(commit, diff, context);
  }

  private async runWithPrefetch(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult | null> {
    const fetchedFiles = await fetchAffectedFileContents(
      context,
      commit.diffSummary.affectedFiles,
      this.MAX_FILE_SIZE,
      this.MAX_TOTAL_SIZE
    );

    const filesWithContent = fetchedFiles.filter(f => f.content !== null);
    if (filesWithContent.length === 0) {
      return null;
    }

    const fileContext = formatFetchedFilesForContext(fetchedFiles, '## Full File Contents');
    const prompt = this.buildPrefetchPrompt(commit, diff, fileContext);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3,
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

  private async runWithTools(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(commit, diff);
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
      maxToolRounds: 3,
      maxTokens: 2000,
      temperature: 0.3,
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

  private buildPrompt(commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } }, diff: string): string {
    const truncatedDiff = diff.length > 10000 ? diff.slice(0, 10000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for narrative and meta-documentation content.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Available Tools

You have access to tools to explore the source code:
- **read_file**: Read the full content of documentation files
- **search_files**: Find related planning or decision documents
- **list_directory**: Explore docs/ or other documentation directories

**Use these tools to**:
- Read the complete document being referenced, not just the diff
- Find related ADRs or planning documents for context
- Verify cross-references to other documentation
- Understand how this narrative fits with existing documentation

Look for:
1. Planning documents (PLAN.md, roadmap, project plans)
2. Architecture Decision Records (ADRs)
3. Design documents or RFCs
4. Changelogs or release notes
5. Philosophy or principles documents
6. Onboarding or getting-started guides
7. Important README updates that explain "why"
8. Commit messages that tell a story about major decisions

Format your response as:

SUMMARY:
[Brief description of narrative content found, or "No significant narrative content"]

NARRATIVE_TYPE:
[One of: planning, adr, design, changelog, philosophy, guide, readme, decision, none]

PAGE_TITLE:
[Short, descriptive title for this content - 3-6 words like "Web Interface Design" or "Multi-Agent Architecture"]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

KEY_DECISIONS:
- [Decision description with context]

WIKI_UPDATES:
For each additional wiki page that should be created or updated, provide FULL article content.
Write each page as a complete, standalone article (2-4 paragraphs minimum).

=== [PAGE_PATH] [ACTION:create/update] ===
[Write the FULL markdown content for this wiki page here.
Include:
- What decision was made or what concept is being documented
- The reasoning and context behind it
- Implications for developers working in this codebase
- Any alternatives that were considered

Do NOT just write a brief description - write a complete article.]
=== END ===

(Repeat for each page)

CONFIDENCE: [0-1 value]
`;
  }

  private buildPrefetchPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    fileContext: string
  ): string {
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for narrative and meta-documentation content.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

${fileContext}

## Analysis Instructions

The full contents of affected files are provided above. Use them to:
- Identify planning documents, ADRs, design docs, changelogs
- Extract key decisions and their rationale
- Understand the "why" behind the codebase

Look for:
1. Planning documents (PLAN.md, roadmap)
2. Architecture Decision Records (ADRs)
3. Design documents or RFCs
4. Changelogs or release notes
5. Philosophy or principles documents
6. Important README updates that explain "why"

Format your response as:

SUMMARY:
[Brief description of narrative content found]

NARRATIVE_TYPE:
[One of: planning, adr, design, changelog, philosophy, guide, readme, decision, none]

PAGE_TITLE:
[Short, descriptive title - 3-6 words]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

KEY_DECISIONS:
- [Decision description with context]

WIKI_UPDATES:
=== [PAGE_PATH] [ACTION:create/update] ===
[Full markdown content]
=== END ===

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('narrative', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=NARRATIVE_TYPE:|PAGE_TITLE:|FINDINGS:|$)/i) ?? '';

    // Parse narrative type
    const narrativeType = parseChoice(
      ctx,
      'NARRATIVE_TYPE',
      /NARRATIVE_TYPE:\s*(\w+)/i,
      ['planning', 'adr', 'design', 'changelog', 'philosophy', 'guide', 'readme', 'decision', 'none'] as const,
      { defaultValue: 'none' }
    ) ?? 'none';

    // Parse page title
    const pageTitle = parseSection(ctx, 'PAGE_TITLE', /PAGE_TITLE:\s*(.+?)(?=\n|FINDINGS:|KEY_DECISIONS:|$)/i) ?? '';

    // Parse findings
    const findingPatterns: ItemPattern<ParsedAnalysis['findings'][0]>[] = [
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
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
      /FINDINGS:\s*([\s\S]*?)(?=KEY_DECISIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Parse key decisions as string list
    const keyDecisions = parseStringList(
      ctx,
      'KEY_DECISIONS',
      /KEY_DECISIONS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i
    );

    // Parse wiki updates using block format
    const wikiUpdates = parseBlocks<ParsedAnalysis['wikiUpdates'][0]>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      /===\s*\[([^\]]+)\]\s*\[(create|update)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi,
      (m) => {
        const content = m[3]!.trim();
        if (content && content.length > 0) {
          return {
            path: m[1]!.trim(),
            action: m[2]!.toLowerCase() as 'create' | 'update',
            content,
          };
        }
        return null;
      }
    );

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      summary,
      narrativeType,
      pageTitle,
      findings,
      keyDecisions,
      wikiUpdates,
      confidence,
    };
  }

  private generateUpdates(
    commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
    analysis: ParsedAnalysis
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    // Skip if no narrative content
    if (analysis.narrativeType === 'none' && analysis.keyDecisions.length === 0) {
      return updates;
    }

    // Create a page for significant narrative content
    if (analysis.narrativeType !== 'none') {
      const categoryMap: Record<NarrativeType, string> = {
        planning: 'planning',
        adr: 'decisions',
        design: 'architecture',
        changelog: 'history',
        philosophy: 'philosophy',
        guide: 'guides',
        readme: 'overview',
        decision: 'decisions',
        none: 'misc',
      };

      const category = categoryMap[analysis.narrativeType];
      // Use page title for path if available, otherwise fall back to summary
      const title = analysis.pageTitle || analysis.summary.slice(0, 50);
      const pagePath = `${category}/${slugify(title)}`;

      const content = `# ${title}

${analysis.summary}

## Key Points

${analysis.findings.map(f => `- **${f.type}**: ${f.description}`).join('\n')}

${analysis.keyDecisions.length > 0 ? `## Decisions Made

${analysis.keyDecisions.map(d => `- ${d}`).join('\n')}` : ''}

## Source Files

${commit.diffSummary.affectedFiles.map(f => `- \`${f}\``).join('\n')}

---
*Captured from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'create',
        path: pagePath,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.3,
      });
    }

    // Add any wiki updates suggested by the LLM
    for (const wikiUpdate of analysis.wikiUpdates) {
      // Use the full content provided by the LLM
      // Add a source footer if not already present
      let content = wikiUpdate.content;
      if (!content.includes('*Updated from commit') && !content.includes('*Source:')) {
        content = `${content}

---
*Updated from commit ${commit.sha.slice(0, 8)}*`;
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
        confidenceDelta: 0.25,
      });
    }

    return updates;
  }
}

type NarrativeType = 'planning' | 'adr' | 'design' | 'changelog' | 'philosophy' | 'guide' | 'readme' | 'decision' | 'none';

interface ParsedAnalysis {
  summary: string;
  narrativeType: NarrativeType;
  pageTitle: string;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  keyDecisions: string[];
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update';
    content: string;
  }>;
  confidence: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pathToTitle(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SYSTEM_PROMPT = `You are a technical writer extracting project knowledge from meta-documentation.

CRITICAL: Write as encyclopedia articles, NOT commit summaries.

## CRITICAL: Verify Before Documenting

You have access to tools (read_file, search_files, list_directory) to explore documentation. USE THEM:

1. **Read the complete document** rather than relying only on the diff
2. **Find related documents** to understand how this narrative fits with existing documentation
3. **Verify cross-references** by checking that linked documents exist
4. **Search for existing coverage** to avoid duplicating existing documentation

If you reference claims from a document, read the full document first to ensure accurate representation.

BAD: "This commit adds a planning document that describes..."
GOOD: "The project follows a CQRS architecture pattern, chosen because..."

Your specialty is identifying and extracting knowledge from:
- Planning documents (project vision, roadmaps)
- Architecture Decision Records (ADRs)
- Design documents and RFCs
- Philosophy and principles documents
- Important README content

When you find such content:
1. Extract the key decisions and their rationale
2. Write it as standalone documentation (not about the commit)
3. Give it a descriptive title like "CQRS Architecture Decision" not "Commit abc123"
4. Focus on WHAT the decision/plan IS, not that it was committed

Your confidence should reflect:
- 0.9+: Clear narrative document with explicit decisions/rationale
- 0.7-0.9: Good context, clear intent
- 0.5-0.7: Implied decisions from code changes
- <0.5: No significant narrative content`;

const SYSTEM_PROMPT_PREFETCH = `You are a technical writer extracting project knowledge from meta-documentation.

The full contents of affected files are provided in the prompt - you do not need to use any tools.

CRITICAL: Write as encyclopedia articles, NOT commit summaries.

BAD: "This commit adds a planning document that describes..."
GOOD: "The project follows a CQRS architecture pattern, chosen because..."

## Analysis Focus

Your specialty is identifying and extracting knowledge from:
- Planning documents (project vision, roadmaps)
- Architecture Decision Records (ADRs)
- Design documents and RFCs
- Philosophy and principles documents
- Important README content

When you find such content:
1. Extract the key decisions and their rationale
2. Write it as standalone documentation
3. Give it a descriptive title like "CQRS Architecture Decision"
4. Focus on WHAT the decision/plan IS

## Confidence Scoring

- 0.9+: Clear narrative document with explicit decisions/rationale
- 0.7-0.9: Good context, clear intent
- 0.5-0.7: Implied decisions from code changes
- <0.5: No significant narrative content`;
