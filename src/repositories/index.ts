/**
 * Repository module for CodeWiki.
 *
 * Storage uses MongoDB for all environments:
 * - Production/Staging: Real MongoDB via MONGODB_URI
 * - Local development: mongodb-memory-server (in-memory MongoDB)
 *
 * The application auto-detects which to use based on environment configuration.
 */

import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

export * from './interfaces/index.js';
export { createMongoRepositories, createMongoIndexes } from './mongo-based/index.js';

import type { Repositories } from './interfaces/index.js';
import { createMongoRepositories, createMongoIndexes } from './mongo-based/index.js';

// Singleton for memory server to avoid multiple instances
let memoryServerInstance: MongoMemoryServer | null = null;

/**
 * Environment configuration for repository selection.
 */
export interface RepositoryConfig {
  /** MongoDB connection string (uses memory-server if not provided) */
  mongoUri?: string;
  /** MongoDB database name (defaults to 'codewiki') */
  mongoDbName?: string;
  /** Whether to create indexes on startup (defaults to true) */
  createIndexes?: boolean;
}

/**
 * Connection to repositories with lifecycle management.
 * close() properly closes the MongoDB connection pool.
 */
export interface RepositoryConnection {
  /** The repository instances */
  readonly repositories: Repositories;
  /** The MongoDB database instance (for advanced usage) */
  readonly db: Db;
  /** Close the connection */
  close(): Promise<void>;
}

/**
 * Get or create the mongodb-memory-server instance.
 * Uses a singleton to avoid starting multiple servers.
 */
async function getMemoryServer(): Promise<MongoMemoryServer> {
  if (!memoryServerInstance) {
    memoryServerInstance = await MongoMemoryServer.create();
  }
  return memoryServerInstance;
}

/**
 * Stop the memory server if running.
 * Call this during application shutdown for clean exit.
 */
export async function stopMemoryServer(): Promise<void> {
  if (memoryServerInstance) {
    await memoryServerInstance.stop();
    memoryServerInstance = null;
  }
}

/**
 * Create repositories based on configuration.
 * Auto-detects based on environment if config not provided.
 *
 * - If MONGODB_URI is set, connects to that MongoDB instance
 * - Otherwise, starts mongodb-memory-server for local development
 *
 * Returns a RepositoryConnection with a close() method for cleanup.
 */
export async function createRepositories(config?: RepositoryConfig): Promise<RepositoryConnection> {
  const mongoUri = config?.mongoUri ?? process.env['MONGODB_URI'];
  const dbName = config?.mongoDbName ?? process.env['MONGODB_DB_NAME'] ?? 'codewiki';
  const createIndexes = config?.createIndexes !== false;

  let client: MongoClient;

  if (mongoUri) {
    // Use provided MongoDB URI
    client = new MongoClient(mongoUri);
  } else {
    // Start in-memory MongoDB for local development
    const memoryServer = await getMemoryServer();
    const memoryUri = memoryServer.getUri();
    client = new MongoClient(memoryUri);
  }

  await client.connect();
  const db = client.db(dbName);

  // Create indexes by default
  if (createIndexes) {
    await createMongoIndexes(db);
  }

  const repositories = createMongoRepositories(db);

  return {
    repositories,
    db,
    close: async () => {
      await client.close();
      // Note: We don't stop the memory server here to allow reuse
      // Call stopMemoryServer() explicitly during app shutdown if needed
    },
  };
}
