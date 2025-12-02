/**
 * Common types for Analysis tools used by the Self-Improvement Agent.
 */

import type { Repositories } from '../../../repositories/index.js';
import type { BenchmarkRun } from '../../../domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../../domain/quality-benchmark.js';
import type { WikiPage } from '../../../domain/wiki-page.js';

/**
 * Context provided to analysis tools when they execute.
 */
export interface AnalysisToolContext {
  /** Repository access for data queries */
  repos: Repositories;
  /** Repository ID being analyzed */
  repoId: string;
  /** Wiki ID being analyzed */
  wikiId: string;
  /** Path to the source code repository (optional - if available enables codebase tools) */
  repoPath?: string;
  /** Benchmark runs included in analysis */
  benchmarkRuns: BenchmarkRun[];
  /** Quality benchmark runs included in analysis */
  qualityBenchmarkRuns: QualityBenchmarkRun[];
  /** All wiki pages */
  wikiPages: WikiPage[];
}

/**
 * Definition of an analysis tool.
 */
export interface AnalysisToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Execute the tool with given input */
  execute: (input: Record<string, unknown>, context: AnalysisToolContext) => Promise<string>;
}
