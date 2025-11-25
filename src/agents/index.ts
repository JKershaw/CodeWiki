/**
 * Agents for CodeWiki.
 *
 * Agents are the workers that analyze commits, generate wiki content,
 * and maintain the wiki's quality and structure.
 *
 * Agent types:
 * - Analysis: Examine commits (code-change, narrative, security, etc.)
 * - Meta: Examine the wiki itself (structure, links, quality)
 * - Synthesis: Create higher-order content (guides, overviews, history)
 * - Special: Orchestrator, research, writer
 */
export * from './base-agent.js';
export * from './analysis/index.js';
export * from './orchestrator/index.js';
