/**
 * Repository module for CodeWiki.
 *
 * Storage is abstracted behind repository interfaces.
 * Two implementations exist:
 * - MongoDB: Used in production, staging, and CI/CD tests
 * - File-based: Used in local development and restricted environments
 *
 * The application auto-detects which to use based on environment configuration.
 */

export * from './interfaces/index.js';
export { createFileRepositories } from './file-based/index.js';

import type { Repositories } from './interfaces/index.js';
import { createFileRepositories } from './file-based/index.js';

/**
 * Environment configuration for repository selection.
 */
export interface RepositoryConfig {
  /** Storage type: 'mongodb' or 'file' */
  type: 'mongodb' | 'file';
  /** MongoDB connection string (for mongodb type) */
  mongoUri?: string;
  /** Base directory for file storage (for file type) */
  fileBasePath?: string;
}

/**
 * Create repositories based on configuration.
 * Auto-detects based on environment if config not provided.
 */
export function createRepositories(config?: RepositoryConfig): Repositories {
  const effectiveConfig = config ?? detectConfig();

  if (effectiveConfig.type === 'mongodb') {
    // TODO: Implement MongoDB repositories
    throw new Error('MongoDB repositories not yet implemented');
  }

  return createFileRepositories(effectiveConfig.fileBasePath);
}

/**
 * Auto-detect repository configuration from environment.
 */
function detectConfig(): RepositoryConfig {
  const mongoUri = process.env['MONGODB_URI'];

  if (mongoUri) {
    return {
      type: 'mongodb',
      mongoUri,
    };
  }

  return {
    type: 'file',
    fileBasePath: process.env['CODEWIKI_DATA_PATH'] ?? '.codewiki-data',
  };
}
