/**
 * Consolidation Agent module.
 *
 * The Consolidation Agent is responsible for self-healing wiki maintenance:
 * - Merging duplicate pages
 * - Deleting redundant content
 * - Updating broken links
 * - Standardizing terminology
 *
 * It works on findings detected by meta agents (Consistency, Quality, Structure)
 * and uses LLM to make intelligent consolidation decisions.
 */

export { ConsolidationAgent } from './consolidation-agent.js';
