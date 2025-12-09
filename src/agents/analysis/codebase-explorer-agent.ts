import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isPathTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import {
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import { createCodebaseToolExecutor, formatFetchedFilesForContext, type FetchedFileContent } from '../agent-helpers.js';
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

  // Size limits for pre-fetch approach
  private readonly MAX_FILE_SIZE = 20000;
  private readonly MAX_TOTAL_SIZE = 80000;
  private readonly MAX_FILES_TO_PREFETCH = 10;

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

    // Try pre-fetch approach first for simpler, more reliable execution
    if (context.repoAccess) {
      const prefetchResult = await this.runWithPrefetch(targetPath, existingPagePaths, context);
      if (prefetchResult) {
        return prefetchResult;
      }
    }

    // Fall back to tool-based exploration if pre-fetch failed or is unavailable
    return this.runWithTools(targetPath, existingPagePaths, context);
  }

  /**
   * Run with pre-fetched directory listing and file contents.
   * Returns null if pre-fetch is not suitable (too many files, etc.).
   */
  private async runWithPrefetch(
    targetPath: string,
    existingPagePaths: string[],
    context: AgentContext
  ): Promise<AgentRunResult | null> {
    if (!context.repoAccess) {
      return null;
    }

    try {
      // Pre-list the directory structure
      const dirListing = await this.listDirectoryTree(targetPath, context);
      if (!dirListing || dirListing.files.length === 0) {
        return null; // No files found, fall back to tools
      }

      // If too many files, fall back to tools for selective exploration
      if (dirListing.files.length > this.MAX_FILES_TO_PREFETCH * 2) {
        console.log(`[codebase-explorer] Too many files (${dirListing.files.length}), using tool-based approach`);
        return null;
      }

      // Select key files to pre-read (prioritize implementations over index files)
      const keyFiles = this.selectKeyFiles(dirListing.files);

      // Pre-fetch file contents
      const fileContents = await this.prefetchFiles(keyFiles, context);
      const totalSize = fileContents.reduce((sum, f) => sum + (f.content?.length || 0), 0);

      // If context is too large, fall back to tools
      if (totalSize > this.MAX_TOTAL_SIZE) {
        console.log(`[codebase-explorer] Context too large (${totalSize}), using tool-based approach`);
        return null;
      }

      // Build the pre-fetch prompt with directory structure and file contents
      const prompt = this.buildPrefetchPrompt(targetPath, dirListing, fileContents, existingPagePaths);

      // Single LLM call with all context
      const completion = await context.llm.complete({
        system: SYSTEM_PROMPT_PREFETCH,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4000,
        temperature: 0.3,
      });

      // Parse the response
      const analysis = this.parseResponse(completion.content);

      // All paths are verified since we pre-fetched them
      const verifiedPaths = new Set(keyFiles);
      dirListing.files.forEach(f => verifiedPaths.add(f));
      const validatedFindings = validateFindingPaths(analysis.findings, verifiedPaths);

      // Generate wiki updates
      const updates = this.generateUpdates(targetPath, analysis, existingPagePaths);

      // Create exploration finding
      const filesRead = fileContents.filter(f => f.content !== null).map(f => f.path);
      const explorationFinding = createFinding({
        type: 'EXPLORATION',
        description: `Pre-fetched and documented ${filesRead.length} source files in ${targetPath}`,
        relatedPaths: filesRead,
        importance: 'low',
      });

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
            explorationFinding,
          ],
          confidence: analysis.confidence,
        }),
        updates,
        costUsd: completion.costUsd,
        toolMetrics: { toolCallCount: 0, toolsUsed: {}, filesRead: filesRead }, // No tool calls in pre-fetch mode
      };
    } catch (error) {
      console.warn(`[codebase-explorer] Pre-fetch failed: ${error}, falling back to tools`);
      return null;
    }
  }

  /**
   * Run with tool-based exploration (fallback).
   */
  private async runWithTools(
    targetPath: string,
    existingPagePaths: string[],
    context: AgentContext
  ): Promise<AgentRunResult> {
    const existingContent = ''; // Not used in tool mode prompt

    // Build the prompt for the LLM
    const prompt = this.buildPrompt(targetPath, existingPagePaths, existingContent);

    // Set up codebase exploration tools
    const toolExecutor = createCodebaseToolExecutor(context);

    // Get LLM analysis with tool use
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 5, // Reduced from 10 - should be enough with better guidance
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Parse the LLM response
    const analysis = this.parseResponse(completion.content);

    // Extract verified paths from tool calls
    const verifiedPaths = extractVerifiedPaths(completion.toolCalls);

    // Validate and filter paths in findings
    const validatedFindings = validateFindingPaths(analysis.findings, verifiedPaths);

    // Generate wiki updates
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

  /**
   * List directory tree structure.
   */
  private async listDirectoryTree(
    targetPath: string,
    context: AgentContext
  ): Promise<{ tree: string; files: string[] } | null> {
    if (!context.repoAccess) {
      return null;
    }

    try {
      const entries = await context.repoAccess.listDirectory(targetPath);
      const files: string[] = [];
      const treeLines: string[] = [];

      for (const entry of entries) {
        const fullPath = targetPath === '.' ? entry.name : `${targetPath}/${entry.name}`;
        if (entry.type === 'dir') {
          treeLines.push(`${entry.name}/`);
          // Recursively list subdirectories (one level deep)
          try {
            const subEntries = await context.repoAccess.listDirectory(fullPath);
            for (const subEntry of subEntries) {
              const subPath = `${fullPath}/${subEntry.name}`;
              if (subEntry.type === 'dir') {
                treeLines.push(`  ${subEntry.name}/`);
              } else {
                treeLines.push(`  ${subEntry.name}`);
                if (this.isSourceFile(subEntry.name)) {
                  files.push(subPath);
                }
              }
            }
          } catch {
            // Ignore subdirectory listing errors
          }
        } else {
          treeLines.push(entry.name);
          if (this.isSourceFile(entry.name)) {
            files.push(fullPath);
          }
        }
      }

      return {
        tree: treeLines.join('\n'),
        files,
      };
    } catch (error) {
      console.warn(`[codebase-explorer] Failed to list directory ${targetPath}: ${error}`);
      return null;
    }
  }

  /**
   * Check if a filename looks like source code.
   */
  private isSourceFile(filename: string): boolean {
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
    const skipPatterns = ['.test.', '.spec.', '.d.ts', 'index.ts', 'index.js'];

    // Skip test and declaration files
    if (skipPatterns.some(p => filename.includes(p))) {
      return false;
    }

    return sourceExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Select key files to pre-read, prioritizing implementations over index files.
   */
  private selectKeyFiles(files: string[]): string[] {
    // Sort to prioritize implementation files
    const sorted = [...files].sort((a, b) => {
      const aName = a.split('/').pop() || '';
      const bName = b.split('/').pop() || '';

      // Deprioritize index files
      const aIsIndex = aName.startsWith('index.');
      const bIsIndex = bName.startsWith('index.');
      if (aIsIndex && !bIsIndex) return 1;
      if (!aIsIndex && bIsIndex) return -1;

      // Prioritize by name length (shorter = more likely core file)
      return aName.length - bName.length;
    });

    return sorted.slice(0, this.MAX_FILES_TO_PREFETCH);
  }

  /**
   * Pre-fetch file contents.
   */
  private async prefetchFiles(
    files: string[],
    context: AgentContext
  ): Promise<FetchedFileContent[]> {
    if (!context.repoAccess) {
      return [];
    }

    const results: FetchedFileContent[] = [];
    let totalSize = 0;

    for (const filePath of files) {
      if (totalSize >= this.MAX_TOTAL_SIZE) {
        break;
      }

      try {
        const content = await context.repoAccess.getFileContent(filePath);
        if (content.length > this.MAX_FILE_SIZE) {
          results.push({
            path: filePath,
            content: content.slice(0, this.MAX_FILE_SIZE),
            truncated: true,
          });
          totalSize += this.MAX_FILE_SIZE;
        } else {
          results.push({ path: filePath, content });
          totalSize += content.length;
        }
      } catch (error) {
        results.push({
          path: filePath,
          content: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Build prompt for pre-fetch approach with all context included.
   */
  private buildPrefetchPrompt(
    targetPath: string,
    dirListing: { tree: string; files: string[] },
    fileContents: FetchedFileContent[],
    existingPagePaths: string[]
  ): string {
    const sortedPaths = sortByPathRelevance(existingPagePaths, targetPath);
    const existingPagesInfo = sortedPaths.length > 0
      ? `\n## Existing Wiki Pages (avoid duplication)\n${sortedPaths.slice(0, 15).map(p => `- ${p}`).join('\n')}`
      : '';

    const filesContext = formatFetchedFilesForContext(fileContents, '## Source Files');

    return `## Document: ${targetPath}

## Directory Structure
\`\`\`
${dirListing.tree}
\`\`\`

${filesContext}
${existingPagesInfo}

Based on the directory structure and source files above, create comprehensive documentation.

## Output Format

SUMMARY:
[2-3 paragraph overview of this code module]

FINDINGS:
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_PAGES:
=== path: category/page-name | title: Descriptive Title ===
[Markdown content with code examples from the files above]
=== END ===

CONFIDENCE: [0.8-1.0 since you have full file contents]
`;
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
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_PAGES:
=== path: category/page-name | title: Descriptive Title ===
[Markdown content with code examples from the files you read]
=== END ===

CONFIDENCE: [0-1 value based on how many files you read]

Remember: Call list_directory and read_file BEFORE writing any output above.
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('codebase-explorer', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i) ?? '';

    // Parse findings - pipe-separated format
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
      /FINDINGS:\s*([\s\S]*?)(?=WIKI_PAGES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Parse wiki pages - uses === path: X | title: Y === format
    const wikiPages: ParsedAnalysis['wikiPages'] = [];
    const pagesSection = parseSection(ctx, 'WIKI_PAGES', /WIKI_PAGES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (pagesSection) {
      const pageMatches = pagesSection.matchAll(/===\s*path:\s*([^|=]+)\s*(?:\|\s*title:\s*([^=]+))?\s*===\s*([\s\S]*?)===\s*END\s*===/gi);

      for (const match of pageMatches) {
        const path = match[1]!.trim();
        const title = match[2]?.trim() ?? pathToTitle(path);
        const content = match[3]!.trim();

        if (path && content) {
          wikiPages.push({ path, title, content });
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

/**
 * Simplified system prompt for pre-fetch mode.
 * No tool instructions needed since all context is provided upfront.
 */
const SYSTEM_PROMPT_PREFETCH = `You are a documentation writer for source code.

## Your Task
Create comprehensive documentation for the code provided. The directory structure and file contents have been pre-loaded for you.

## Documentation Guidelines
- Write encyclopedia-style documentation based on the actual code
- Use EXACT class, function, and variable names from the source
- Include code examples from the provided files
- Explain purpose, patterns, and how components work together
- Focus on what makes this code unique, not generic descriptions

## Wiki Page Guidelines
- Use lowercase paths with hyphens (e.g., "services/user-service")
- Each page should be 200-500 words minimum
- Only reference file paths shown in the directory structure

## Output Format
Respond with SUMMARY, FINDINGS, WIKI_PAGES, and CONFIDENCE sections as specified in the prompt.`;
