/**
 * CodeWiki - Generate living wikis from Git repositories.
 *
 * This is the main entry point for the application.
 * It initializes the system and starts the appropriate processes
 * based on the command-line arguments or environment.
 */

import { createRepositories, type RepositoryConfig } from './repositories/index.js';

export { createRepositories } from './repositories/index.js';
export * from './domain/index.js';
export * from './commands/index.js';
export * from './queries/index.js';
export * from './services/index.js';
export * from './agents/index.js';
export * from './executor/index.js';

/**
 * Application configuration.
 */
export interface AppConfig {
  /** Repository storage configuration */
  storage: RepositoryConfig;
}

/**
 * Initialize the CodeWiki application.
 */
export function createApp(config?: Partial<AppConfig>) {
  const repos = createRepositories(config?.storage);

  return {
    repos,
    // Commands and queries will be added here as the system grows
  };
}

// If running directly (not imported as a module)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  console.log('CodeWiki - Generate living wikis from Git repositories');
  console.log('');
  console.log('This is a library module. To use CodeWiki:');
  console.log('');
  console.log('  import { createApp } from "codewiki"');
  console.log('  const app = createApp()');
  console.log('');
}
