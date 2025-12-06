/**
 * Base tool implementations for codebase exploration.
 *
 * This module provides the core logic for file reading, searching, and directory
 * listing, with configurable options for output formatting and behavior.
 *
 * Used by:
 * - codebase-tools.ts (for agent exploration)
 * - source-tools.ts (for self-improvement analysis)
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import fg from 'fast-glob';
import { minimatch } from 'minimatch';
import { loadIgnorePatterns } from '../cwignore.js';

/**
 * Default maximum file size in bytes (100KB).
 */
export const DEFAULT_MAX_FILE_SIZE = 100_000;

/**
 * Default maximum search results.
 */
export const DEFAULT_MAX_SEARCH_RESULTS = 50;

/**
 * Options for base tool behavior.
 */
export interface BaseToolOptions {
  /** Maximum file size in bytes (default: 100KB) */
  maxFileSize?: number;
  /** Maximum search results (default: 50) */
  maxSearchResults?: number;
  /** Format output with markdown headers (default: false) */
  formatOutput?: boolean;
}

/**
 * Validate that a path is within the repository root.
 * Throws if path escapes the repo boundary.
 */
export function validatePath(requestedPath: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, requestedPath);
  const repoResolved = resolve(repoRoot);

  if (!resolved.startsWith(repoResolved)) {
    throw new Error(`Path "${requestedPath}" is outside repository`);
  }
  return resolved;
}

/**
 * Read a file from the filesystem.
 */
export async function readFileContent(
  path: string,
  repoPath: string,
  options: BaseToolOptions = {}
): Promise<string> {
  const maxSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const formatOutput = options.formatOutput ?? false;

  try {
    const fullPath = validatePath(path, repoPath);
    const stats = await stat(fullPath);

    if (stats.size > maxSize) {
      return `Error: File "${path}" is too large (${stats.size} bytes, limit is ${maxSize})`;
    }

    const content = await readFile(fullPath, 'utf-8');

    if (formatOutput) {
      return `## File: ${path}\n\n\`\`\`\n${content}\n\`\`\``;
    }
    return content;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        return `Error: File "${path}" not found in repository`;
      }
      if (error.message.includes('EACCES')) {
        return `Error: Permission denied reading "${path}"`;
      }
      if (error.message.includes('outside repository')) {
        return `Error reading "${path}": ${error.message}`;
      }
      return `Error reading "${path}": ${error.message}`;
    }
    return `Error reading "${path}"`;
  }
}

/**
 * Search for files matching a glob pattern.
 */
export async function searchFiles(
  pattern: string,
  repoPath: string,
  options: BaseToolOptions = {}
): Promise<string> {
  const maxResults = options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS;
  const formatOutput = options.formatOutput ?? false;

  try {
    const ignorePatterns = await loadIgnorePatterns(repoPath);
    const files = await fg(pattern, {
      cwd: repoPath,
      onlyFiles: true,
      ignore: ignorePatterns,
    });

    if (files.length === 0) {
      return `No files found matching "${pattern}"`;
    }

    // Apply limit if maxResults > 0
    const hasLimit = maxResults > 0;
    const truncated = hasLimit && files.length > maxResults;
    const displayFiles = hasLimit ? files.slice(0, maxResults) : files;

    if (formatOutput) {
      let result = `## Files matching: ${pattern}\n\nFound ${files.length} files:\n\n`;
      result += displayFiles.join('\n');
      if (truncated) {
        result += `\n\n... and ${files.length - maxResults} more files`;
      }
      return result;
    }

    // Simple format: just the file list
    let result = displayFiles.join('\n');
    if (truncated) {
      result += `\n\n... and ${files.length - maxResults} more files`;
    }
    return result;
  } catch (error) {
    if (error instanceof Error) {
      return `Error searching for "${pattern}": ${error.message}`;
    }
    return `Error searching for "${pattern}"`;
  }
}

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

/**
 * List contents of a directory.
 */
export async function listDirectory(
  path: string,
  repoPath: string,
  options: BaseToolOptions = {}
): Promise<string> {
  const formatOutput = options.formatOutput ?? false;

  try {
    const fullPath = validatePath(path, repoPath);
    const entries = await readdir(fullPath, { withFileTypes: true });
    const ignorePatterns = await loadIgnorePatterns(repoPath);

    // Filter out ignored entries
    const filteredEntries = entries.filter(entry => {
      const entryPath = path === '.' ? entry.name : join(path, entry.name);
      return !isIgnored(entryPath, ignorePatterns);
    });

    if (formatOutput) {
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
    }

    // Simple format: name with / suffix for directories
    const formatted = filteredEntries.map(entry => {
      const suffix = entry.isDirectory() ? '/' : '';
      return entry.name + suffix;
    });

    return formatted.join('\n');
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        return `Error: Directory "${path}" not found in repository`;
      }
      if (error.message.includes('ENOTDIR')) {
        return `Error: "${path}" is not a directory`;
      }
      if (error.message.includes('outside repository')) {
        return `Error listing "${path}": ${error.message}`;
      }
      return `Error listing "${path}": ${error.message}`;
    }
    return `Error listing "${path}"`;
  }
}
