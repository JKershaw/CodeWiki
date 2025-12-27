/**
 * Repository module for CodeWiki.
 *
 * Storage is abstracted behind repository interfaces.
 * Two backends are supported:
 * - MongoDB: Used when MONGODB_URI is set (production, CI)
 * - MangoDB: File-based MongoDB-compatible storage (development)
 *
 * Both backends use the same repository implementations.
 */

import { MongoClient, type Db } from 'mongodb';
import { MangoClient } from 'mangodb';

export * from './interfaces/index.js';
export { createMongoRepositories, createMongoIndexes } from './mongo-based/index.js';

import type { Repositories } from './interfaces/index.js';
import { createMongoRepositories, createMongoIndexes } from './mongo-based/index.js';

/**
 * Environment configuration for repository selection.
 */
export interface RepositoryConfig {
  /** Storage type: 'mongodb' or 'file' */
  type?: 'mongodb' | 'file';
  /** MongoDB connection string (for mongodb type) */
  mongoUri?: string;
  /** MongoDB database name (defaults to 'codewiki') */
  mongoDbName?: string;
  /** Base directory for file storage (for file type) */
  fileBasePath?: string;
  /** Whether to create indexes on startup (for mongodb, defaults to true) */
  createIndexes?: boolean;
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
 */
export async function createRepositories(config?: RepositoryConfig): Promise<RepositoryConnection> {
  const effectiveConfig = { ...detectConfig(), ...config };

  let db: Db;
  let closeFunc: () => Promise<void>;

  if (effectiveConfig.type === 'mongodb') {
    if (!effectiveConfig.mongoUri) {
      throw new Error('MongoDB URI is required for mongodb storage type');
    }

    const client = new MongoClient(effectiveConfig.mongoUri);
    await client.connect();

    const dbName = effectiveConfig.mongoDbName ?? 'codewiki';
    db = client.db(dbName);
    closeFunc = async () => {
      await client.close();
    };
  } else {
    // Use MangoDB for file-based storage
    const dataPath = effectiveConfig.fileBasePath ?? '.codewiki-data';
    const mangoClient = new MangoClient(dataPath);
    await mangoClient.connect();

    const dbName = effectiveConfig.mongoDbName ?? 'codewiki';
    // Type assertion: MangoDb is API-compatible with MongoDB's Db
    db = mangoClient.db(dbName) as unknown as Db;
    closeFunc = async () => {
      await mangoClient.close();
    };
  }

  // Create indexes (works with both backends)
  if (effectiveConfig.createIndexes !== false) {
    await createMongoIndexes(db);
  }

  const repositories = createMongoRepositories(db);

  return {
    repositories,
    close: closeFunc,
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
      mongoDbName: process.env['MONGODB_DB_NAME'] ?? 'codewiki',
    };
  }

  return {
    type: 'file',
    fileBasePath: process.env['CODEWIKI_DATA_PATH'] ?? '.codewiki-data',
  };
}
