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
 *
 * Architecture:
 * - ConsolidationAgent: Coordinates finding lifecycle and delegates to handlers
 * - FindingHandler: Interface for strategy pattern handlers
 * - FindingHandlerRegistry: Manages handler registration and lookup
 * - handlers/*: Individual strategy implementations for each finding type
 */

export { ConsolidationAgent } from './consolidation-agent.js';
export { type FindingHandler, type FindingHandlerResult, HandlerUtils } from './finding-handler.js';
export { FindingHandlerRegistry, createDefaultHandlerRegistry } from './finding-handler-registry.js';

// Export individual handlers for custom registration or testing
export {
  BrokenLinkHandler,
  CategoryMismatchHandler,
  ContradictionHandler,
  DuplicateHandler,
  OrphanedPageHandler,
  TerminologyHandler,
} from './handlers/index.js';
