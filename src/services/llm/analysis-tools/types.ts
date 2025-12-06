/**
 * Common types for Analysis tools used by the Self-Improvement Agent.
 *
 * Types are now defined in the unified tools.ts module.
 * This file re-exports them for backwards compatibility.
 */

// Re-export unified types from tools.ts
export type { AnalysisToolContext, ToolDefinition } from '../tools.js';

// Type alias for analysis tools
import type { ToolDefinition, AnalysisToolContext } from '../tools.js';
export type AnalysisToolDefinition = ToolDefinition<AnalysisToolContext>;
