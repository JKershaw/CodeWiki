/**
 * Codebase exploration tools for agentic LLM interactions.
 *
 * These tools allow agents to explore the repository by reading files,
 * searching for content, and understanding project structure.
 */

import type { ToolDefinition, ToolContext } from './tools.js';
import {
  readFileContent,
  searchFiles,
  listDirectory,
  DEFAULT_MAX_FILE_SIZE,
} from './base-tools.js';

/**
 * Tool to read a file from the repository.
 */
export const readFileTool: ToolDefinition<ToolContext> = {
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
    return readFileContent(path, context.repoPath, {
      maxFileSize: context.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      formatOutput: false,
    });
  },
};

/**
 * Tool to search for files matching a glob pattern.
 */
export const searchFilesTool: ToolDefinition<ToolContext> = {
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
    return searchFiles(pattern, context.repoPath, {
      maxSearchResults: 0, // No limit for codebase tools
      formatOutput: false,
    });
  },
};

/**
 * Tool to list contents of a directory.
 */
export const listDirectoryTool: ToolDefinition<ToolContext> = {
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
    return listDirectory(path, context.repoPath, {
      formatOutput: false,
    });
  },
};

/**
 * All available codebase tools.
 */
export const codebaseTools: ToolDefinition<ToolContext>[] = [
  readFileTool,
  searchFilesTool,
  listDirectoryTool,
];
