/**
 * Helper functions for agents to access repository data.
 *
 * These helpers provide a unified interface that works with both:
 * - Local repositories (via GitService)
 * - GitHub repositories (via RepositoryService)
 */

import type { AgentContext } from './base-agent.js';
import type { ToolContext, ToolDefinition } from '../services/llm/tools.js';
import { codebaseTools } from '../services/llm/codebase-tools.js';

/**
 * Get the diff for a commit, using the best available service.
 *
 * Prefers RepositoryService (works with both GitHub and local repos)
 * but falls back to GitService for backwards compatibility.
 */
export async function getCommitDiff(context: AgentContext, sha: string): Promise<string> {
  // Prefer repoService if available (works with both GitHub and local repos)
  if (context.repoService && context.repo) {
    return context.repoService.getCommitDiff(context.repo, sha);
  }

  // Fall back to git service for backwards compatibility
  return context.git.getCommitDiff(context.repoId, sha);
}

/**
 * Check if the repository is a local filesystem repository.
 *
 * Returns true if we can use filesystem-based tools.
 * Returns false if repo is undefined or is a GitHub repo.
 */
export function isLocalRepo(context: AgentContext): boolean {
  // Must have a repo object and it must explicitly be marked as not a GitHub repo
  return context.repo?.isGitHubRepo === false;
}

/**
 * Get the local filesystem path for a repository.
 *
 * Returns undefined for GitHub repositories or when repo info is not available.
 */
export function getLocalRepoPath(context: AgentContext): string | undefined {
  // Must have repo info and it must be a local repo (not GitHub)
  if (!context.repo || context.repo.isGitHubRepo) {
    return undefined;
  }

  // For local repos, get the path from git service
  try {
    return context.git.getRepoPath(context.repoId);
  } catch {
    return undefined;
  }
}

/**
 * Create a tool executor for codebase exploration.
 *
 * For local repos: Uses filesystem-based tools
 * For GitHub repos: Creates API-based tools using RepositoryService
 */
export function createCodebaseToolExecutor(context: AgentContext): {
  tools: ToolDefinition[];
  executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
} | null {
  const repoPath = getLocalRepoPath(context);

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

  // GitHub repo - create API-based tools
  if (context.repoService && context.repo) {
    return createApiCodebaseTools(context);
  }

  // No tools available
  return null;
}

/**
 * Create API-based codebase tools for GitHub repositories.
 */
function createApiCodebaseTools(context: AgentContext): {
  tools: ToolDefinition[];
  executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
} {
  const { repoService, repo } = context;

  if (!repoService || !repo) {
    throw new Error('RepositoryService and repo required for API-based tools');
  }

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
          return await repoService.getFileContent(repo, path);
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
          const entries = await repoService.listDirectory(repo, path);
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
          const allFiles = await repoService.getFileTree(repo);
          // Simple glob matching (supports **, *, and ?)
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
        // API tools don't need a toolContext, they use the repoService directly
        const result = await tool.execute(call.input, { repoPath: '', maxFileSize: 100000 });
        return { id: call.id, result };
      }));
      return results;
    },
  };
}

/**
 * Simple glob pattern matching for file paths.
 */
function filterByGlob(files: string[], pattern: string): string[] {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return files.filter(file => regex.test(file));
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
      let content: string;

      if (context.repoService && context.repo) {
        // Use repository service (works for both GitHub and local)
        content = await context.repoService.getFileContent(context.repo, filePath);
      } else {
        // Fall back to local file reading via git service
        const repoPath = context.git.getRepoPath(context.repoId);
        const fs = await import('fs/promises');
        const path = await import('path');
        const fullPath = path.join(repoPath, filePath);
        content = await fs.readFile(fullPath, 'utf-8');
      }

      // Check if file is too large
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
      // File might be deleted in this commit, or inaccessible
      results.push({
        path: filePath,
        content: null,
        error: error instanceof Error ? error.message : 'Failed to read file',
      });
    }
  }

  return results;
}

/**
 * Check if a file path is likely a source code file worth reading.
 */
function isSourceCodeFile(filePath: string): boolean {
  // Skip common non-source files
  const skipPatterns = [
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.min\.(js|css)$/,
    /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i,
    /\.(pdf|doc|docx|xls|xlsx)$/i,
    /\.(zip|tar|gz|rar)$/i,
    /node_modules\//,
    /dist\//,
    /build\//,
    /\.git\//,
  ];

  return !skipPatterns.some(pattern => pattern.test(filePath));
}

/**
 * Format fetched file contents for inclusion in a prompt.
 */
export function formatFileContentsForPrompt(files: FetchedFileContent[]): string {
  const sections: string[] = [];

  for (const file of files) {
    if (file.content) {
      const truncatedNote = file.truncated ? ' (truncated)' : '';
      sections.push(`### ${file.path}${truncatedNote}\n\n\`\`\`\n${file.content}\n\`\`\``);
    } else if (file.error) {
      sections.push(`### ${file.path}\n\n*${file.error}*`);
    }
  }

  if (sections.length === 0) {
    return '*No source files available*';
  }

  return sections.join('\n\n');
}
