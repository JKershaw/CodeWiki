import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isPathTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import {
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';
import { sortByPathRelevance } from '../../utils/path-relevance.js';
import {
  createParseContext,
  parseSection,
  parseListItemsWithFallback,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Codebase Explorer Agent - Documents undocumented parts of the codebase.
 *
 * Unlike analysis agents that run on commits, this agent runs on a specific
 * directory or file path. It explores the code structure and creates wiki
 * documentation for parts of the codebase that haven't been touched by commits.
 *
 * This agent addresses the "coverage plateau" problem where commit-driven
 * analysis never documents stable, foundational code that hasn't changed.
 */
export class CodebaseExplorerAgent implements Agent {
  readonly type: AgentType = 'codebase-explorer';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isPathTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isPathTarget(target)) {
      throw new Error(`CodebaseExplorerAgent cannot handle target type: ${target.type}`);
    }
    const targetPath = target.path;

    // Check existing wiki pages to avoid duplication
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const existingPages = pagesResult.data || [];
    const existingPagePaths = existingPages.map(p => p.path);
    const existingContent = existingPages.map(p => p.content.toLowerCase()).join('\n');

    // Build the prompt for the LLM
    const prompt = this.buildPrompt(targetPath, existingPagePaths, existingContent);

    // Set up codebase exploration tools (works with both local and GitHub repos)
    const toolExecutor = createCodebaseToolExecutor(context);

    // Get LLM analysis with tool use for deep exploration
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 10, // Allow more exploration for directories
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Parse the LLM response
    const analysis = this.parseResponse(completion.content);

    // Extract verified paths from tool calls
    const verifiedPaths = extractVerifiedPaths(completion.toolCalls);

    // Validate and filter paths in findings to prevent hallucinated paths
    const validatedFindings = validateFindingPaths(analysis.findings, verifiedPaths);

    // Generate wiki updates based on the analysis
    const updates = this.generateUpdates(targetPath, analysis, existingPagePaths);

    // Include tool usage in findings
    const filesRead = completion.toolCalls
      .filter(c => c.name === 'read_file')
      .map(c => c.input['path'] as string)
      .filter(Boolean);

    const toolUsageFinding = completion.toolCalls.length > 0
      ? [createFinding({
          type: 'EXPLORATION',
          description: `Explored ${filesRead.length} source files in ${targetPath}`,
          relatedPaths: filesRead,
          importance: 'low',
        })]
      : [];

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: [
          ...validatedFindings.map(f => createFinding({
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
    targetPath: string,
    existingPagePaths: string[],
    _existingContent: string
  ): string {
    // Sort existing pages by relevance to target path, so the most related pages are shown first
    // This ensures we don't miss related pages when truncating to 20
    const sortedPaths = sortByPathRelevance(existingPagePaths, targetPath);
    const existingPagesInfo = sortedPaths.length > 0
      ? `\n\n## Existing Wiki Pages (avoid duplication)\n${sortedPaths.slice(0, 20).map(p => `- ${p}`).join('\n')}`
      : '';

    return `## Your Task

Document the code in: ${targetPath}

## Step 1: EXPLORE (Required - Do This First)

Start by calling these tools to explore the directory:

\`\`\`
list_directory(path: "${targetPath}")
\`\`\`

Then read the key files you find:

\`\`\`
read_file(path: "<file you discovered>")
\`\`\`

## Step 2: DOCUMENT (Only After Tool Calls)

After you have used list_directory and read_file, document what you found.
Focus on:
- Purpose and functionality of the code
- Key interfaces, types, and classes
- How this code fits into the larger system
- Usage patterns (especially from tests if you find any)
${existingPagesInfo}

Avoid duplicating existing wiki pages listed above.

## Output Format (Only After Exploration)

SUMMARY:
[2-3 paragraph overview based on the files you read]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

WIKI_PAGES:
---PAGE---
PATH: [category/page-name]
TITLE: [Descriptive title]
CONTENT:
[Markdown content with code examples from the files you read]
---END_PAGE---

CONFIDENCE: [0-1 value based on how many files you read]

Remember: Call list_directory and read_file BEFORE writing any output above.
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('codebase-explorer', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i) ?? '';

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
      /FINDINGS:\s*([\s\S]*?)(?=WIKI_PAGES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Parse wiki pages - uses custom ---PAGE--- block format
    const wikiPages: ParsedAnalysis['wikiPages'] = [];
    const pagesSection = parseSection(ctx, 'WIKI_PAGES', /WIKI_PAGES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (pagesSection) {
      const pageBlocks = pagesSection.split('---PAGE---').filter(b => b.trim());

      for (const block of pageBlocks) {
        const cleanBlock = block.replace(/---END_PAGE---/g, '').trim();
        if (!cleanBlock) continue;

        const pathMatch = cleanBlock.match(/PATH:\s*(.+?)(?:\n|$)/i);
        const titleMatch = cleanBlock.match(/TITLE:\s*(.+?)(?:\n|$)/i);
        const contentMatch = cleanBlock.match(/CONTENT:\s*([\s\S]*?)$/i);

        if (pathMatch && contentMatch) {
          wikiPages.push({
            path: pathMatch[1]!.trim(),
            title: titleMatch?.[1]?.trim() ?? pathToTitle(pathMatch[1]!.trim()),
            content: contentMatch[1]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      summary,
      findings,
      wikiPages,
      confidence,
    };
  }

  private generateUpdates(
    targetPath: string,
    analysis: ParsedAnalysis,
    existingPagePaths: string[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];
    const existingPathsSet = new Set(existingPagePaths.map(p => p.toLowerCase()));

    for (const page of analysis.wikiPages) {
      // Skip if a similar page already exists
      if (existingPathsSet.has(page.path.toLowerCase())) {
        console.log(`Skipping wiki page ${page.path} - similar page already exists`);
        continue;
      }

      // Add source attribution to the content
      const contentWithAttribution = `${page.content}

---
*Documentation generated by codebase-explorer from \`${targetPath}\`*
`;

      updates.push({
        type: 'create',
        path: page.path,
        title: page.title,
        content: contentWithAttribution,
        // sourceCommitId omitted - this is exploration-based, not commit-based
        agentRunId: '', // Will be set by the executor
        confidenceDelta: 0.3, // New content from exploration
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
  wikiPages: Array<{
    path: string;
    title: string;
    content: string;
  }>;
  confidence: number;
}

/**
 * Convert a path like "services/llm-service" to a title like "LLM Service".
 */
function pathToTitle(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract verified paths from tool calls.
 *
 * This collects all paths that were actually accessed via tools,
 * which we can use to validate that claimed paths in findings exist.
 */
function extractVerifiedPaths(
  toolCalls: Array<{ name: string; input: Record<string, unknown>; output?: string }>
): Set<string> {
  const verified = new Set<string>();

  for (const call of toolCalls) {
    if (call.name === 'read_file') {
      const path = call.input['path'] as string;
      if (path) {
        verified.add(path);
        // Also add parent directories as verified
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          verified.add(parts.slice(0, i).join('/'));
        }
      }
    } else if (call.name === 'list_directory') {
      const path = call.input['path'] as string;
      if (path) {
        verified.add(path);
        // Parse the output to get listed files/directories
        if (call.output) {
          const entries = call.output.split('\n').filter(Boolean);
          for (const entry of entries) {
            const entryPath = path === '.' || path === ''
              ? entry.replace(/\/$/, '')
              : `${path}/${entry.replace(/\/$/, '')}`;
            verified.add(entryPath);
          }
        }
      }
    } else if (call.name === 'search_files') {
      // Parse search results to get found file paths
      if (call.output && !call.output.startsWith('No files found') && !call.output.startsWith('Error')) {
        const foundPaths = call.output.split('\n').filter(Boolean);
        for (const foundPath of foundPaths) {
          verified.add(foundPath);
        }
      }
    }
  }

  return verified;
}

/**
 * Validate paths in findings against verified paths from tool calls.
 *
 * This prevents hallucinated file paths from entering the wiki data.
 * Paths that weren't verified via tool calls are removed with a warning.
 */
function validateFindingPaths(
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>,
  verifiedPaths: Set<string>
): Array<{
  type: string;
  importance: 'low' | 'medium' | 'high';
  description: string;
  paths: string[];
}> {
  return findings.map(finding => {
    const validatedPaths = finding.paths.filter(path => {
      // Normalize path for comparison
      const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '');

      // Check if this exact path or a parent was verified
      if (verifiedPaths.has(normalizedPath)) {
        return true;
      }

      // Check if any verified path starts with this path (for directories)
      for (const verified of verifiedPaths) {
        if (verified.startsWith(normalizedPath + '/') || normalizedPath.startsWith(verified + '/')) {
          return true;
        }
      }

      // Path was not verified via tool calls - likely hallucinated
      console.warn(
        `[codebase-explorer] Removing unverified path from finding: ${path} ` +
        `(verified ${verifiedPaths.size} paths via tools)`
      );
      return false;
    });

    return {
      ...finding,
      paths: validatedPaths,
    };
  });
}

const SYSTEM_PROMPT = `You MUST use tools before generating any documentation. Your FIRST response MUST be a tool call, NOT text.

## MANDATORY TOOL USAGE - READ THIS FIRST

You are REQUIRED to make AT LEAST 2 tool calls before writing any documentation:
1. FIRST: Call \`list_directory\` to see what files exist
2. THEN: Call \`read_file\` to read the actual source code

NEVER output SUMMARY, FINDINGS, or WIKI_PAGES without first making these tool calls.
If you skip tools and guess based on directory names, you WILL hallucinate incorrect content.

## Available Tools

- \`list_directory\`: See what files exist in a directory - ALWAYS call this first
- \`read_file\`: Read the full contents of a source file - REQUIRED before documenting
- \`search_files\`: Find files by glob pattern (e.g., find test files)

## Required Workflow

Your response pattern MUST be:
1. Call \`list_directory\` on the target path (REQUIRED)
2. Call \`read_file\` on key files you discover (REQUIRED - at least 1 file)
3. Optionally call \`search_files\` for test files
4. ONLY AFTER tool calls: Output your documentation in the requested format

## Why Tools Are Mandatory

Without reading actual source code, you will:
- Invent file names that don't exist
- Describe frameworks not used in this codebase
- Document APIs that don't match the implementation
- Use wrong class/function/variable names

## Documentation Style (ONLY after tool calls)

Once you have read the actual code:
- Write encyclopedia-style documentation based on what you READ
- Use EXACT names from the source code
- Include code examples FROM THE ACTUAL FILES you read
- Explain what the code does and why it exists

Wiki page guidelines:
- Use lowercase paths with hyphens (e.g., "services/llm-service")
- Each page should be 200-500 words minimum
- Only reference file paths you verified via tool calls

Confidence scoring:
- 0.9+: Read all key files, comprehensive documentation
- 0.7-0.9: Read most files but some unexplored
- 0.5-0.7: Limited file reads, may need more exploration
- <0.5: Insufficient tool use, documentation may be inaccurate`;
