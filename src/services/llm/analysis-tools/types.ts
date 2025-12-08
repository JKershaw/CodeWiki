/**
 * Common types for Analysis tools used by the Self-Improvement Agent.
 */

// Re-export unified types from tools.ts
export type { AnalysisToolContext, ToolDefinition } from '../tools.js';

// Type alias for analysis tools
import type { ToolDefinition, AnalysisToolContext } from '../tools.js';
export type AnalysisToolDefinition = ToolDefinition<AnalysisToolContext>;
