/**
 * Tool definitions for agentic LLM interactions.
 *
 * Tools allow agents to explore the codebase by reading files,
 * searching for content, and understanding project structure.
 *
 * This module provides unified types used across all tool systems:
 * - Codebase tools (file reading, searching)
 * - Wiki tools (page reading, searching)
 * - Analysis tools (benchmarks, quality metrics)
 */

import type { Repositories } from '../../repositories/index.js';
import type { BenchmarkRun } from '../../domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../domain/quality-benchmark.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import type { RepositoryService } from '../repository/repository-service.js';
import type { Repo } from '../../domain/repo.js';

/**
 * Context for codebase exploration tools (read_file, search_files, list_directory).
 */
export interface ToolContext {
  /** Root path of the repository */
  repoPath: string;
  /** Maximum file size to read (bytes) */
  maxFileSize?: number;
}

/**
 * Context for wiki research tools (search_wiki, read_page, list_pages).
 */
export interface WikiToolContext {
  /** All wiki pages available for searching */
  pages: WikiPage[];
  /** Maximum content length to return per page */
  maxContentLength?: number;
}

/**
 * Context for analysis tools used by the Self-Improvement Agent.
 */
export interface AnalysisToolContext {
  /** Repository access for data queries */
  repos: Repositories;
  /** Repository ID being analyzed */
  repoId: string;
  /** Wiki ID being analyzed */
  wikiId: string;
  /** Path to the source code repository (optional - enables filesystem access) */
  repoPath?: string;
  /** Repository service for GitHub API access (optional - fallback when repoPath not available) */
  repoService?: RepositoryService;
  /** Repository entity (required when using repoService) */
  repo?: Repo;
  /** Benchmark runs included in analysis */
  benchmarkRuns: BenchmarkRun[];
  /** Quality benchmark runs included in analysis */
  qualityBenchmarkRuns: QualityBenchmarkRun[];
  /** All wiki pages */
  wikiPages: WikiPage[];
}

/**
 * Unified definition of a tool that an agent can use.
 * Generic over the context type to support different tool categories.
 */
export interface ToolDefinition<TContext = ToolContext> {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  /** Execute the tool with given input */
  execute: (input: Record<string, unknown>, context: TContext) => Promise<string>;
}

/**
 * Result of a tool execution during an agentic loop.
 */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
}
