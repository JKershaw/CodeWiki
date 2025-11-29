/**
 * CQRS Commands for CodeWiki.
 *
 * Commands change state. All state changes flow through commands,
 * providing a clean boundary between core logic and external interfaces.
 *
 * Available commands:
 * - CreateWiki: Create a new wiki for a repository
 * - SetActiveWiki: Set the active wiki for processing
 * - StartProcessingRepo: Begin processing a repository
 * - UpdateWikiPage: Create, update, or merge wiki content
 *
 * Future commands (to be implemented):
 * - RunAgent: Execute a specific agent
 * - ResolveConflict: Manually resolve a detected conflict
 * - SetThrottle: Adjust processing throttle settings
 * - AddLearning: Record a learning from an AI session
 */

export * from './types.js';
export * from './create-wiki.js';
export * from './set-active-wiki.js';
export * from './start-processing-repo.js';
export * from './update-wiki-page.js';
