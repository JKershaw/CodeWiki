/**
 * Analysis tools for the Self-Improvement Agent.
 *
 * @deprecated Import from './analysis-tools/index.js' instead.
 * This file re-exports for backwards compatibility.
 *
 * Tools are now organized into categories:
 * - analysis-tools/benchmark-tools.ts: Accuracy benchmark analysis
 * - analysis-tools/quality-tools.ts: Quality benchmark analysis
 * - analysis-tools/wiki-page-tools.ts: Wiki content reading and exploration
 * - analysis-tools/source-tools.ts: Source code exploration
 * - analysis-tools/provenance-tools.ts: Traceability from wiki to orchestrator decisions
 */

// Re-export everything from the new modular structure
export * from './analysis-tools/index.js';
