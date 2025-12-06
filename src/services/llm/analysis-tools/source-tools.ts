/**
 * Source code exploration tools for the Self-Improvement Agent.
 *
 * These tools allow exploring the actual source code repository to understand
 * what code exists that wiki-building agents should be documenting.
 *
 * Supports both local filesystem access (via repoPath) and GitHub API access
 * (via repoService) for flexibility with different repository types.
 */

import { minimatch } from 'minimatch';
import type { ToolDefinition, AnalysisToolContext } from '../tools.js';
import {
  readFileContent,
  searchFiles,
  listDirectory,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_SEARCH_RESULTS,
} from '../base-tools.js';

/**
 * Tool to read a source file from the repository.
 */
export const readSourceFileTool: ToolDefinition<AnalysisToolContext> = {
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
    const path = input['path'] as string;

    // Prefer local filesystem when available
    if (context.repoPath) {
      return readFileContent(path, context.repoPath, {
        maxFileSize: DEFAULT_MAX_FILE_SIZE,
        formatOutput: true, // Markdown headers for analysis context
      });
    }

    // Fall back to GitHub API
    if (context.repoService && context.repo) {
      try {
        const content = await context.repoService.getFileContent(context.repo, path);

        if (content.length > DEFAULT_MAX_FILE_SIZE) {
          return `Error: File "${path}" is too large (${content.length} bytes, limit is ${DEFAULT_MAX_FILE_SIZE})`;
        }

        return `## File: ${path}\n\n\`\`\`\n${content}\n\`\`\``;
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('Not Found') || error.message.includes('404')) {
            return `Error: File "${path}" not found in repository`;
          }
          return `Error reading "${path}": ${error.message}`;
        }
        return `Error reading "${path}"`;
      }
    }

    return 'Source code access is not available for this repository.';
  },
};

/**
 * Tool to search for source files matching a glob pattern.
 */
export const searchSourceFilesTool: ToolDefinition<AnalysisToolContext> = {
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
    const pattern = input['pattern'] as string;

    // Prefer local filesystem when available
    if (context.repoPath) {
      return searchFiles(pattern, context.repoPath, {
        maxSearchResults: DEFAULT_MAX_SEARCH_RESULTS,
        formatOutput: true,
      });
    }

    // Fall back to GitHub API
    if (context.repoService && context.repo) {
      try {
        const allFiles = await context.repoService.getFileTree(context.repo);
        const matchingFiles = allFiles.filter(filePath => minimatch(filePath, pattern));

        if (matchingFiles.length === 0) {
          return `No files found matching "${pattern}"`;
        }

        const truncated = matchingFiles.length > DEFAULT_MAX_SEARCH_RESULTS;
        const displayFiles = matchingFiles.slice(0, DEFAULT_MAX_SEARCH_RESULTS);

        let result = `## Files matching: ${pattern}\n\nFound ${matchingFiles.length} files:\n\n`;
        result += displayFiles.join('\n');
        if (truncated) {
          result += `\n\n... and ${matchingFiles.length - DEFAULT_MAX_SEARCH_RESULTS} more files`;
        }

        return result;
      } catch (error) {
        if (error instanceof Error) {
          return `Error searching for "${pattern}": ${error.message}`;
        }
        return `Error searching for "${pattern}"`;
      }
    }

    return 'Source code access is not available for this repository.';
  },
};

/**
 * Tool to list contents of a source directory.
 */
export const listSourceDirectoryTool: ToolDefinition<AnalysisToolContext> = {
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
    const path = input['path'] as string;

    // Prefer local filesystem when available
    if (context.repoPath) {
      return listDirectory(path, context.repoPath, {
        formatOutput: true,
      });
    }

    // Fall back to GitHub API
    if (context.repoService && context.repo) {
      try {
        const entries = await context.repoService.listDirectory(context.repo, path);

        const dirs = entries.filter(e => e.type === 'dir').map(e => e.name + '/');
        const files = entries.filter(e => e.type === 'file').map(e => e.name);

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
          if (error.message.includes('Not Found') || error.message.includes('404')) {
            return `Error: Directory "${path}" not found in repository`;
          }
          return `Error listing "${path}": ${error.message}`;
        }
        return `Error listing "${path}"`;
      }
    }

    return 'Source code access is not available for this repository.';
  },
};

/**
 * All source code exploration tools.
 */
export const sourceTools: ToolDefinition<AnalysisToolContext>[] = [
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
];
