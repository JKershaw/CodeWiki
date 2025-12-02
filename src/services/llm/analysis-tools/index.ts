/**
 * Analysis tools for the Self-Improvement Agent.
 *
 * These tools allow the agent to explore benchmark history, iteration data,
 * wiki pages, agent prompts, and source code to produce improvement recommendations.
 *
 * Tools are organized into categories:
 * - Benchmark tools: Accuracy benchmark analysis
 * - Quality tools: Quality benchmark analysis
 * - Wiki page tools: Wiki content reading and exploration
 * - Source tools: Source code exploration
 * - Provenance tools: Traceability from wiki content to orchestrator decisions
 */

// Re-export types
export type { AnalysisToolContext, AnalysisToolDefinition } from './types.js';

// Re-export all individual tools for backwards compatibility
export {
  getBenchmarkSummaryTool,
  getQuestionTrendsTool,
  getQuestionHistoryTool,
  getIterationsBetweenTool,
  benchmarkTools,
} from './benchmark-tools.js';

export {
  getQualityTrendsTool,
  getQualityDimensionDetailTool,
  qualityTools,
} from './quality-tools.js';

export {
  getPageContentTool,
  listWikiPagesTool,
  getAgentPromptTool,
  wikiPageTools,
} from './wiki-page-tools.js';

export {
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
  validateSourcePath,
  sourceTools,
} from './source-tools.js';

export {
  getPageProvenanceTool,
  getAgentContributionsTool,
  getOrchestratorDecisionsTool,
  getProvenanceTraceTool,
  getWorkItemOutcomesTool,
  provenanceTools,
} from './provenance-tools.js';

// Import tool arrays
import { benchmarkTools } from './benchmark-tools.js';
import { qualityTools } from './quality-tools.js';
import { wikiPageTools } from './wiki-page-tools.js';
import { sourceTools } from './source-tools.js';
import { provenanceTools } from './provenance-tools.js';

import type { AnalysisToolDefinition } from './types.js';

/**
 * All available analysis tools.
 */
export const analysisTools: AnalysisToolDefinition[] = [
  ...benchmarkTools,
  ...qualityTools,
  ...wikiPageTools,
  ...sourceTools,
  ...provenanceTools,
];
