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
import { extractLinksFromContent } from '../../utils/link-extraction.js';

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
    const priorityFiles = target.priorityFiles;

    // Check existing wiki pages to avoid duplication
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const existingPages = pagesResult.data || [];
    const existingPagePaths = existingPages.map(p => p.path);

    // Try pre-fetch approach first for simpler, more reliable execution
    if (context.repoAccess) {
      const prefetchResult = await this.runWithPrefetch(targetPath, existingPagePaths, context, priorityFiles);
      if (prefetchResult) {
        return prefetchResult;
      }
    }

    // Fall back to tool-based exploration if pre-fetch failed or is unavailable
    return this.runWithTools(targetPath, existingPagePaths, context, priorityFiles);
  }

  /**
   * Run with pre-fetched directory listing and file contents.
   * Returns null if pre-fetch is not suitable (too many files, etc.).
   */
  private async runWithPrefetch(
    targetPath: string,
    existingPagePaths: string[],
    context: AgentContext,
    priorityFiles?: string[]
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

      // Select key files to pre-read (prioritizing low-coverage files if provided)
      const keyFiles = this.selectKeyFiles(dirListing.files, priorityFiles);

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
    context: AgentContext,
    _priorityFiles?: string[]  // Not yet used in tool mode
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
   *
   * Uses getFileTree() to discover ALL files under the target path at any depth,
   * not just 1-2 levels deep. This ensures deeply nested source files are found.
   */
  private async listDirectoryTree(
    targetPath: string,
    context: AgentContext
  ): Promise<{ tree: string; files: string[] } | null> {
    if (!context.repoAccess) {
      return null;
    }

    try {
      // Get ALL files in the repository
      const allFiles = await context.repoAccess.getFileTree();

      // Filter to files under the target path
      const prefix = targetPath === '.' ? '' : targetPath + '/';
      const filesUnderTarget = targetPath === '.'
        ? allFiles
        : allFiles.filter(f => f.startsWith(prefix));

      // Filter to source files only
      const sourceFiles = filesUnderTarget.filter(f => {
        const filename = f.split('/').pop() ?? '';
        return this.isSourceFile(filename);
      });

      if (sourceFiles.length === 0) {
        return null;
      }

      // Build tree representation from file paths
      const tree = this.buildTreeFromPaths(sourceFiles, targetPath);

      return {
        tree,
        files: sourceFiles,
      };
    } catch (error) {
      console.warn(`[codebase-explorer] Failed to get file tree for ${targetPath}: ${error}`);
      return null;
    }
  }

  /**
   * Build a tree representation from a list of file paths.
   */
  private buildTreeFromPaths(files: string[], basePath: string): string {
    const prefix = basePath === '.' ? '' : basePath + '/';
    const treeLines: string[] = [];
    const seenDirs = new Set<string>();

    // Sort files for consistent tree output
    const sortedFiles = [...files].sort();

    for (const filePath of sortedFiles) {
      // Get path relative to base
      const relativePath = basePath === '.'
        ? filePath
        : filePath.slice(prefix.length);

      const parts = relativePath.split('/');

      // Add directory entries (with indentation based on depth)
      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        if (!seenDirs.has(dirPath)) {
          seenDirs.add(dirPath);
          const indent = '  '.repeat(i);
          treeLines.push(`${indent}${parts[i]}/`);
        }
      }

      // Add file entry
      const indent = '  '.repeat(parts.length - 1);
      const filename = parts[parts.length - 1];
      treeLines.push(`${indent}${filename}`);
    }

    return treeLines.join('\n');
  }

  /**
   * Check if a filename looks like source code.
   * Note: Index files ARE included (they define public API and should be documented).
   * They are deprioritized in sortByDefaultPriority but not excluded.
   */
  private isSourceFile(filename: string): boolean {
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
    // Index files removed from skipPatterns - they define public API and should be documented
    const skipPatterns = ['.test.', '.spec.', '.d.ts'];

    // Skip test and declaration files
    if (skipPatterns.some(p => filename.includes(p))) {
      return false;
    }

    return sourceExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Select key files to pre-read.
   * If priorityFiles are provided (low-coverage files), read those first.
   * Otherwise fall back to default heuristics.
   */
  private selectKeyFiles(files: string[], priorityFiles?: string[]): string[] {
    if (priorityFiles && priorityFiles.length > 0) {
      // Use coverage-aware selection: priority files first, then fill with others
      const filesSet = new Set(files);
      const prioritySet = new Set(priorityFiles);

      // Filter priority files to only those that exist in the file list
      const validPriority = priorityFiles.filter(f => filesSet.has(f));

      // Get remaining files sorted by default priority
      const others = files.filter(f => !prioritySet.has(f));
      const othersSorted = this.sortByDefaultPriority(others);

      // Combine: priority first, then others
      return [...validPriority, ...othersSorted].slice(0, this.MAX_FILES_TO_PREFETCH);
    }

    // Fall back to default behavior
    return this.sortByDefaultPriority(files).slice(0, this.MAX_FILES_TO_PREFETCH);
  }

  /**
   * Sort files by default priority: implementations over index files, shorter names first.
   */
  private sortByDefaultPriority(files: string[]): string[] {
    return [...files].sort((a, b) => {
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
      ? `\n## Related Wiki Pages (link to these)\n${sortedPaths.slice(0, 15).map(p => `- ${p}`).join('\n')}\n\nIMPORTANT: Include markdown links to relevant existing pages using [Page Title](path) format.`
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
Do NOT duplicate existing pages, but DO link to them when relevant.

## Output Format

You MUST use this EXACT format with colons after section names:

SUMMARY:
[2-3 paragraph overview of this code module]

FINDINGS:
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_PAGES:
=== path: category/page-name | title: Descriptive Title ===
[Markdown content with code examples from the files above]
=== END ===

CONFIDENCE: 0.85

## Example Output

SUMMARY:
The user-service module provides authentication and user management functionality. It implements JWT-based authentication with bcrypt password hashing.

The service follows a clean separation of concerns with interfaces for testability.

FINDINGS:
- type: Architecture | importance: high | description: Repository pattern for data access | paths: user-repository.ts
- type: Convention | importance: medium | description: All service methods are async | paths: user-service.ts

WIKI_PAGES:
=== path: services/user-service | title: User Service ===
# User Service

The user service handles authentication and user management. For security best practices, see [Security Guidelines](guides/security-best-practices).

## Related
- [Authentication Overview](auth/overview) - How authentication works
=== END ===

CONFIDENCE: 0.9
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
      ? `\n\n## Related Wiki Pages (link to these)\n${sortedPaths.slice(0, 20).map(p => `- ${p}`).join('\n')}\n\nIMPORTANT: Include markdown links to relevant existing pages using [Page Title](path) format.`
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

Do NOT duplicate existing pages, but DO link to them when relevant.

## Output Format (Only After Exploration)

You MUST use this EXACT format with colons after section names:

SUMMARY:
[2-3 paragraph overview based on the files you read]

FINDINGS:
- type: Architecture | importance: high | description: [Text] | paths: file1.ts, file2.ts

WIKI_PAGES:
=== path: category/page-name | title: Title ===
[Content]
=== END ===

CONFIDENCE: 0.85

## Example Output (After Tool Exploration)

After exploring src/services/auth with list_directory and reading auth-service.ts, user-repository.ts:

SUMMARY:
The authentication service provides JWT-based user authentication with bcrypt password hashing. It follows a repository pattern for data access, separating database queries from business logic.

The service exposes three main methods: login(), register(), and validateToken(). All methods are async and handle their own error cases by throwing typed AuthErrors.

FINDINGS:
- type: Architecture | importance: high | description: Repository pattern separates data access from business logic | paths: src/services/auth/user-repository.ts
- type: Convention | importance: medium | description: All public methods are async and throw typed errors | paths: src/services/auth/auth-service.ts

WIKI_PAGES:
=== path: services/authentication | title: Authentication Service ===
# Authentication Service

The authentication service handles user login, registration, and token validation using JWT tokens.

## Key Components

- **AuthService**: Main entry point for authentication operations
- **UserRepository**: Handles database queries for user data

## Usage Example

\`\`\`typescript
const authService = new AuthService(userRepo);
const token = await authService.login(email, password);
\`\`\`
=== END ===

CONFIDENCE: 0.85

Remember: Call list_directory and read_file BEFORE writing any output above.
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('codebase-explorer', response);

    // Parse summary - try colon format first, then markdown heading format
    let summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|##|$)/i);
    if (!summary || summary.length < 20) {
      // Fallback: try markdown heading format (## SUMMARY)
      const mdMatch = response.match(/##\s*SUMMARY\s*\n([\s\S]*?)(?=##\s*FINDINGS|##\s*WIKI|FINDINGS:|WIKI_PAGES:|CONFIDENCE:|$)/i);
      if (mdMatch && mdMatch[1]) {
        summary = mdMatch[1].trim();
      }
    }
    summary = summary ?? '';

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

    // Try colon format first, then markdown heading format
    let findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=WIKI_PAGES:|CONFIDENCE:|##|$)/i,
      findingPatterns
    );
    if (findings.length === 0) {
      // Fallback: try markdown heading format
      findings = parseListItemsWithFallback(
        ctx,
        'FINDINGS (markdown)',
        /##\s*FINDINGS\s*\n([\s\S]*?)(?=##\s*WIKI|WIKI_PAGES:|CONFIDENCE:|$)/i,
        findingPatterns
      );
    }

    // Parse wiki pages - uses === path: X | title: Y === format
    const wikiPages: ParsedAnalysis['wikiPages'] = [];
    // Try colon format first
    let pagesSection = parseSection(ctx, 'WIKI_PAGES', /WIKI_PAGES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (!pagesSection || pagesSection.length < 20) {
      // Fallback: try markdown heading format
      const mdPagesMatch = response.match(/##\s*WIKI_PAGES\s*\n([\s\S]*?)(?=CONFIDENCE:|$)/i);
      if (mdPagesMatch && mdPagesMatch[1]) {
        pagesSection = mdPagesMatch[1].trim();
      }
    }
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

      // Extract links from content for graph tracking
      const links = extractLinksFromContent(contentWithAttribution);

      updates.push({
        type: 'create',
        path: page.path,
        title: page.title,
        content: contentWithAttribution,
        // sourceCommitId omitted - this is exploration-based, not commit-based
        agentRunId: '', // Will be set by the executor
        confidenceDelta: 0.3, // New content from exploration
        links,
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

const SYSTEM_PROMPT = `You are a documentation agent. Read actual source code with tools, then write documentation based on what you read.

## Workflow

1. Call \`list_directory\` on the target path to see files
2. Call \`read_file\` on each important file
3. Write documentation using ONLY information from files you read

## Tools

- \`list_directory\`: List files in a directory
- \`read_file\`: Read source file contents
- \`search_files\`: Find files by pattern

## Documentation Rules

Base ALL documentation on actual code you read. Use exact class names, function names, and patterns from the source files.

Example: If you read a file with \`class UserRepository\`, document UserRepository. If you read a function \`calculateTotal(items)\`, document that exact signature.

Wiki pages: Use lowercase paths with hyphens (e.g., "services/llm-service"). Reference only file paths you verified.

## Cross-Linking

When existing wiki pages are listed, include markdown links to relevant pages in your documentation using [Page Title](path) format. This helps readers navigate related content.

## Confidence

0.9+: Read all key files. 0.7-0.9: Read most files. 0.5-0.7: Limited reads. <0.5: Insufficient data.`;

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
- Include markdown links to related existing wiki pages using [Page Title](path) format

## Output Format
Respond with SUMMARY, FINDINGS, WIKI_PAGES, and CONFIDENCE sections as specified in the prompt.`;
