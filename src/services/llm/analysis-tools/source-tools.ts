/**
 * Source code exploration tools for the Self-Improvement Agent.
 *
 * These tools allow exploring the actual source code repository to understand
 * what code exists that wiki-building agents should be documenting.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import fg from 'fast-glob';
import type { AnalysisToolDefinition } from './types.js';
import { loadIgnorePatterns } from '../../cwignore.js';

const DEFAULT_MAX_FILE_SIZE = 100_000; // 100KB

/**
 * Validate that a path is within the repository root.
 */
export function validateSourcePath(requestedPath: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, requestedPath);
  const repoResolved = resolve(repoRoot);

  if (!resolved.startsWith(repoResolved)) {
    throw new Error(`Path "${requestedPath}" is outside repository`);
  }
  return resolved;
}

/**
 * Tool to read a source file from the repository.
 */
export const readSourceFileTool: AnalysisToolDefinition = {
  name: 'read_source_file',
  description:
    'Read the contents of a source file from the repository. Use this to understand what the source code ' +
    'actually contains, to identify what information wiki-building agents should be extracting.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from repository root (e.g., "README.md", "src/index.ts")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const path = input['path'] as string;
    try {
      const fullPath = validateSourcePath(path, context.repoPath);
      const stats = await stat(fullPath);

      if (stats.size > DEFAULT_MAX_FILE_SIZE) {
        return `Error: File "${path}" is too large (${stats.size} bytes, limit is ${DEFAULT_MAX_FILE_SIZE})`;
      }

      const content = await readFile(fullPath, 'utf-8');
      return `## File: ${path}\n\n\`\`\`\n${content}\n\`\`\``;
    } catch (error) {
      if (error instanceof Error) {
        // Provide cleaner error messages for common cases
        if (error.message.includes('ENOENT')) {
          return `Error: File "${path}" not found in repository`;
        }
        if (error.message.includes('EACCES')) {
          return `Error: Permission denied reading "${path}"`;
        }
        return `Error reading "${path}": ${error.message}`;
      }
      return `Error reading "${path}"`;
    }
  },
};

/**
 * Tool to search for source files matching a glob pattern.
 */
export const searchSourceFilesTool: AnalysisToolDefinition = {
  name: 'search_source_files',
  description:
    'Find source files matching a glob pattern. Use this to discover what files exist in the repository ' +
    'and understand the project structure that wiki-building agents are working with.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "**/*.md", "src/**/*.ts")',
      },
    },
    required: ['pattern'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const pattern = input['pattern'] as string;
    try {
      const ignorePatterns = await loadIgnorePatterns(context.repoPath);
      const files = await fg(pattern, {
        cwd: context.repoPath,
        onlyFiles: true,
        ignore: ignorePatterns,
      });

      if (files.length === 0) {
        return `No files found matching "${pattern}"`;
      }

      // Limit results
      const maxResults = 50;
      const truncated = files.length > maxResults;
      const displayFiles = files.slice(0, maxResults);

      let result = `## Files matching: ${pattern}\n\nFound ${files.length} files:\n\n`;
      result += displayFiles.join('\n');
      if (truncated) {
        result += `\n\n... and ${files.length - maxResults} more files`;
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          return `Error: Repository path not found or not accessible`;
        }
        return `Error searching for "${pattern}": ${error.message}`;
      }
      return `Error searching for "${pattern}"`;
    }
  },
};

/**
 * Tool to list contents of a source directory.
 */
export const listSourceDirectoryTool: AnalysisToolDefinition = {
  name: 'list_source_directory',
  description:
    'List contents of a source directory to understand project structure. Use this to explore ' +
    'what code exists that wiki-building agents should be documenting.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to repo root (e.g., "src", ".")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const path = input['path'] as string;
    try {
      const fullPath = validateSourcePath(path, context.repoPath);
      const entries = await readdir(fullPath, { withFileTypes: true });
      const ignorePatterns = await loadIgnorePatterns(context.repoPath);

      // Filter out ignored entries
      const filteredEntries = entries.filter(entry => {
        const entryPath = path === '.' ? entry.name : join(path, entry.name);
        // Simple ignore check
        return !ignorePatterns.some(p => entryPath.includes(p.replace('/**', '').replace('*', '')));
      });

      const dirs = filteredEntries.filter(e => e.isDirectory()).map(e => e.name + '/');
      const files = filteredEntries.filter(e => !e.isDirectory()).map(e => e.name);

      let result = `## Directory: ${path}\n\n`;

      if (dirs.length > 0) {
        result += '**Directories:**\n' + dirs.sort().join('\n') + '\n\n';
      }
      if (files.length > 0) {
        result += '**Files:**\n' + files.sort().join('\n');
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          return `Error: Directory "${path}" not found in repository`;
        }
        if (error.message.includes('ENOTDIR')) {
          return `Error: "${path}" is not a directory`;
        }
        return `Error listing "${path}": ${error.message}`;
      }
      return `Error listing "${path}"`;
    }
  },
};

/**
 * All source code exploration tools.
 */
export const sourceTools: AnalysisToolDefinition[] = [
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
];
