/**
 * Codebase exploration tools for agentic LLM interactions.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import type { ToolDefinition } from './tools.js';
import { loadIgnorePatterns } from '../cwignore.js';

const DEFAULT_MAX_FILE_SIZE = 100_000; // 100KB

/**
 * Validate that a path is within the repository root.
 */
function validatePath(requestedPath: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, requestedPath);
  const repoResolved = resolve(repoRoot);

  if (!resolved.startsWith(repoResolved)) {
    throw new Error(`Path "${requestedPath}" is outside repository`);
  }
  return resolved;
}

/**
 * Tool to read a file from the repository.
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a file from the repository. Use for README.md, package.json, source files, etc.',
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
    const path = input['path'] as string;
    try {
      const fullPath = validatePath(path, context.repoPath);
      const stats = await stat(fullPath);

      const maxSize = context.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
      if (stats.size > maxSize) {
        return `Error: File "${path}" is too large (${stats.size} bytes, limit is ${maxSize})`;
      }

      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      if (error instanceof Error) {
        return `Error reading "${path}": ${error.message}`;
      }
      return `Error reading "${path}"`;
    }
  },
};

/**
 * Tool to search for files matching a glob pattern.
 */
export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: 'Find files matching a glob pattern. Returns list of matching file paths.',
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

      return files.join('\n');
    } catch (error) {
      if (error instanceof Error) {
        return `Error searching for "${pattern}": ${error.message}`;
      }
      return `Error searching for "${pattern}"`;
    }
  },
};

/**
 * Check if a path should be ignored based on ignore patterns.
 */
function isIgnored(entryPath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    // Handle directory patterns (ending with /**)
    const dirPattern = pattern.endsWith('/**') ? pattern.slice(0, -3) : null;
    if (dirPattern && (entryPath === dirPattern || entryPath.startsWith(dirPattern + '/'))) {
      return true;
    }
    // Use minimatch for glob pattern matching
    if (minimatch(entryPath, pattern, { dot: true })) {
      return true;
    }
  }
  return false;
}

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'List contents of a directory to understand project structure.',
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
    const path = input['path'] as string;
    try {
      const fullPath = validatePath(path, context.repoPath);
      const entries = await readdir(fullPath, { withFileTypes: true });
      const ignorePatterns = await loadIgnorePatterns(context.repoPath);

      // Filter out ignored entries
      const filteredEntries = entries.filter(entry => {
        const entryPath = path === '.' ? entry.name : join(path, entry.name);
        return !isIgnored(entryPath, ignorePatterns);
      });

      const formatted = filteredEntries.map(entry => {
        const suffix = entry.isDirectory() ? '/' : '';
        return entry.name + suffix;
      });

      return formatted.join('\n');
    } catch (error) {
      if (error instanceof Error) {
        return `Error listing "${path}": ${error.message}`;
      }
      return `Error listing "${path}"`;
    }
  },
};

/**
 * All available codebase tools.
 */
export const codebaseTools: ToolDefinition[] = [readFileTool, searchFilesTool, listDirectoryTool];
