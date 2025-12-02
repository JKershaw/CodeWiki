/**
 * CodeWiki - Generate living wikis from Git repositories.
 *
 * This module re-exports the public API for programmatic use.
 * For CLI usage, run: npx codewiki --help
 */

export { createRepositories } from './repositories/index.js';
export * from './domain/index.js';
export * from './commands/index.js';
export * from './queries/index.js';
export * from './services/index.js';
export * from './agents/index.js';
export * from './executor/index.js';
