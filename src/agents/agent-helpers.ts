/**
 * Helper functions for agents to access repository data.
 *
 * These helpers use UnifiedRepoAccess to provide a clean interface that works with both:
 * - Local repositories (via filesystem)
 * - GitHub repositories (via API)
 */

import { minimatch } from 'minimatch';
import type { AgentContext } from './base-agent.js';
import type { ToolContext, ToolDefinition } from '../services/llm/tools.js';
import { codebaseTools } from '../services/llm/codebase-tools.js';

/**
 * Get the diff for a commit.
 *
 * @throws Error if repoAccess is not available
 */
export async function getCommitDiff(context: AgentContext, sha: string): Promise<string> {
  if (!context.repoAccess) {
    throw new Error('repoAccess is required to get commit diff');
  }
  return context.repoAccess.getCommitDiff(sha);
}

/**
 * Check if the repository is a local filesystem repository.
 *
 * Returns true if we can use filesystem-based tools.
 */
export function isLocalRepo(context: AgentContext): boolean {
  if (!context.repoAccess) {
    throw new Error('repoAccess is required to check if repo is local');
  }
  return context.repoAccess.isLocal();
}

/**
 * Get the local filesystem path for a repository.
 *
 * Returns undefined for GitHub repositories.
 */
export function getLocalRepoPath(context: AgentContext): string | undefined {
  if (!context.repoAccess) {
    throw new Error('repoAccess is required to get local repo path');
  }
  return context.repoAccess.getLocalPath();
}

/**
 * Create a tool executor for codebase exploration.
 *
 * For local repos: uses filesystem-based tools
 * For GitHub repos: uses API-based tools via UnifiedRepoAccess
 */
export function createCodebaseToolExecutor(context: AgentContext): {
  tools: ToolDefinition[];
  executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
} | null {
  if (!context.repoAccess) {
    return null;
  }

  const repoPath = context.repoAccess.getLocalPath();

  if (repoPath) {
    // Local repo - use filesystem-based tools
    const toolContext: ToolContext = { repoPath, maxFileSize: 50000 };

    return {
      tools: codebaseTools,
      executeTools: async (calls) => {
        const results = await Promise.all(calls.map(async (call) => {
          const tool = codebaseTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          const result = await tool.execute(call.input, toolContext);
          return { id: call.id, result };
        }));
        return results;
      },
    };
  }

  // GitHub repo - use unified API tools
  return createUnifiedApiTools(context.repoAccess);
}

/**
 * Create API-based codebase tools using UnifiedRepoAccess.
 */
function createUnifiedApiTools(repoAccess: NonNullable<AgentContext['repoAccess']>): {
  tools: ToolDefinition[];
  executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
} {
  const apiTools: ToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read the contents of a file from the repository.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from repository root',
          },
        },
        required: ['path'],
      },
      execute: async (input) => {
        const path = input['path'] as string;
        try {
          return await repoAccess.getFileContent(path);
        } catch (error) {
          return `Error reading "${path}": ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'list_directory',
      description: 'List contents of a directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to repo root',
          },
        },
        required: ['path'],
      },
      execute: async (input) => {
        const path = input['path'] as string;
        try {
          const entries = await repoAccess.listDirectory(path);
          return entries.map(e => `${e.name}${e.type === 'dir' ? '/' : ''}`).join('\n');
        } catch (error) {
          return `Error listing "${path}": ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'search_files',
      description: 'Search for files matching a pattern. Returns file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "**/*.ts")',
          },
        },
        required: ['pattern'],
      },
      execute: async (input) => {
        const pattern = input['pattern'] as string;
        try {
          const allFiles = await repoAccess.getFileTree();
          const matches = filterByGlob(allFiles, pattern);
          if (matches.length === 0) {
            return `No files found matching "${pattern}"`;
          }
          return matches.join('\n');
        } catch (error) {
          return `Error searching for "${pattern}": ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];

  return {
    tools: apiTools,
    executeTools: async (calls) => {
      const results = await Promise.all(calls.map(async (call) => {
        const tool = apiTools.find(t => t.name === call.name);
        if (!tool) {
          return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
        }
        const result = await tool.execute(call.input, { repoPath: '', maxFileSize: 100000 });
        return { id: call.id, result };
      }));
      return results;
    },
  };
}

/**
 * Filter files by glob pattern using minimatch.
 */
function filterByGlob(files: string[], pattern: string): string[] {
  return files.filter(file => minimatch(file, pattern));
}

/**
 * Result of fetching file contents.
 */
export interface FetchedFileContent {
  path: string;
  content: string | null;
  error?: string;
  truncated?: boolean;
}

/**
 * Fetch the full contents of affected files from a commit.
 *
 * This gives the LLM complete context about the files being changed,
 * not just the diff. Files that are deleted or too large are handled gracefully.
 *
 * @param context - Agent context with repo access
 * @param affectedFiles - List of file paths from the commit
 * @param maxFileSize - Maximum size per file (default 30000 chars)
 * @param maxTotalSize - Maximum total size for all files (default 100000 chars)
 * @returns Array of file contents with metadata
 */
export async function fetchAffectedFileContents(
  context: AgentContext,
  affectedFiles: string[],
  maxFileSize: number = 30000,
  maxTotalSize: number = 100000
): Promise<FetchedFileContent[]> {
  if (!context.repoAccess) {
    throw new Error('repoAccess is required to fetch file contents');
  }

  const results: FetchedFileContent[] = [];
  let totalSize = 0;

  // Filter to source code files (skip binaries, lock files, etc.)
  const sourceFiles = affectedFiles.filter(f => isSourceCodeFile(f));

  for (const filePath of sourceFiles) {
    if (totalSize >= maxTotalSize) {
      results.push({
        path: filePath,
        content: null,
        error: 'Skipped: total size limit reached',
      });
      continue;
    }

    try {
      const content = await context.repoAccess.getFileContent(filePath);

      // Handle large files
      if (content.length > maxFileSize) {
        results.push({
          path: filePath,
          content: content.slice(0, maxFileSize),
          truncated: true,
        });
        totalSize += maxFileSize;
      } else {
        results.push({
          path: filePath,
          content,
        });
        totalSize += content.length;
      }
    } catch (error) {
      // File might be deleted, binary, or inaccessible
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
 * Check if a file path looks like source code.
 * Excludes binary files, lock files, and generated files.
 */
function isSourceCodeFile(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase();

  // Source code extensions
  const sourceExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'rb', 'java', 'kt', 'scala',
    'go', 'rs', 'c', 'cpp', 'h', 'hpp',
    'cs', 'fs', 'vb',
    'php', 'swift', 'm', 'mm',
    'sql', 'sh', 'bash', 'zsh',
    'yaml', 'yml', 'json', 'xml', 'toml',
    'md', 'txt', 'rst',
    'html', 'css', 'scss', 'sass', 'less',
    'vue', 'svelte',
    'dockerfile', 'makefile',
  ]);

  // Explicitly excluded patterns
  const excludedPatterns = [
    /^package-lock\.json$/,
    /^yarn\.lock$/,
    /^pnpm-lock\.yaml$/,
    /\.min\.(js|css)$/,
    /\.bundle\.(js|css)$/,
    /\.map$/,
    /\.d\.ts$/,  // TypeScript declaration files
    /node_modules\//,
    /dist\//,
    /build\//,
    /\.git\//,
  ];

  // Check exclusions first
  for (const pattern of excludedPatterns) {
    if (pattern.test(path)) {
      return false;
    }
  }

  // Check if extension is a known source type
  if (extension && sourceExtensions.has(extension)) {
    return true;
  }

  // Special filenames without extensions
  const filename = path.split('/').pop()?.toLowerCase();
  const specialFiles = new Set(['dockerfile', 'makefile', 'readme', 'license', 'changelog']);
  if (filename && specialFiles.has(filename)) {
    return true;
  }

  return false;
}

/**
 * Format fetched file contents for LLM context.
 *
 * Creates a readable format with file paths as headers and content in code blocks.
 */
export function formatFetchedFilesForContext(
  files: FetchedFileContent[],
  prefix: string = '## Source Files'
): string {
  const sections: string[] = [prefix, ''];

  for (const file of files) {
    if (file.content !== null) {
      const truncatedNote = file.truncated ? ' (truncated)' : '';
      sections.push(`### ${file.path}${truncatedNote}`);
      sections.push('```');
      sections.push(file.content);
      sections.push('```');
      sections.push('');
    } else if (file.error) {
      sections.push(`### ${file.path}`);
      sections.push(`*${file.error}*`);
      sections.push('');
    }
  }

  if (sections.length === 2) {
    return '*No source files available*';
  }

  return sections.join('\n');
}
