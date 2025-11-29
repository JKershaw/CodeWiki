/**
 * CQRS Queries for CodeWiki.
 *
 * Queries read state. They don't modify anything, just return data.
 *
 * Available queries:
 * - GetWiki: Get a wiki by ID or slug
 * - GetActiveWiki: Get the active wiki for a repository
 * - ListWikis: List all wikis for a repository
 * - GetWikiPage: Get a wiki page by path
 * - SearchWiki: Search wiki pages by content
 * - GetRepoStatus: Get repository status and statistics
 *
 * Future queries (to be implemented):
 * - GetCommitCoverage: Which commits have been processed
 * - GetConfidenceScores: Confidence levels across the wiki
 * - GetAgentHistory: History of agent executions
 */

export * from './types.js';
export * from './get-wiki.js';
export * from './get-active-wiki.js';
export * from './get-wiki-page.js';
export * from './search-wiki.js';
export * from './get-repo-status.js';
