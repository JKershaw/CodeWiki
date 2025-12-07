/**
 * Finding handlers for the ConsolidationAgent.
 *
 * Each handler implements the FindingHandler interface and is responsible
 * for processing a specific type of finding using the Strategy Pattern.
 */

export { BrokenLinkHandler } from './broken-link-handler.js';
export { CategoryMismatchHandler } from './category-mismatch-handler.js';
export { ContradictionHandler } from './contradiction-handler.js';
export { DuplicateHandler } from './duplicate-handler.js';
export { InaccuracyHandler } from './inaccuracy-handler.js';
export { OrphanedPageHandler } from './orphaned-page-handler.js';
export { TerminologyHandler } from './terminology-handler.js';
