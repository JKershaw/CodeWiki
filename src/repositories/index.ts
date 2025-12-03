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
  type?: 'mongodb' | 'file';
  /** MongoDB connection string (for mongodb type) */
  mongoUri?: string;
  /** Base directory for file storage (for file type) */
  fileBasePath?: string;
}

/**
 * Connection to repositories with lifecycle management.
 *
 * For file-based storage, close() is a no-op.
 * For MongoDB, close() properly closes the connection pool.
 */
export interface RepositoryConnection {
  /** The repository instances */
  readonly repositories: Repositories;
  /** Close the connection (no-op for file-based) */
  close(): Promise<void>;
}

/**
 * Create repositories based on configuration.
 * Auto-detects based on environment if config not provided.
 *
 * Returns a RepositoryConnection with a close() method for cleanup.
 * For file-based storage, close() is a no-op.
 */
export async function createRepositories(config?: RepositoryConfig): Promise<RepositoryConnection> {
  const effectiveConfig = { ...detectConfig(), ...config };

  if (effectiveConfig.type === 'mongodb') {
    // TODO: Implement MongoDB repositories
    // When implemented, this will:
    // 1. Create a MongoClient with effectiveConfig.mongoUri
    // 2. await client.connect()
    // 3. Return repositories with close() that calls client.close()
    throw new Error('MongoDB repositories not yet implemented');
  }

  const repositories = createFileRepositories(effectiveConfig.fileBasePath);

  return {
    repositories,
    close: async () => {
      // No-op for file-based storage
    },
  };
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
