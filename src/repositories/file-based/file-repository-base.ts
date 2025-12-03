/**
 * Generic base class for file-based repositories.
 *
 * Provides common CRUD operations and date hydration patterns that are
 * shared across all file-based repository implementations.
 *
 * Subclasses should:
 * 1. Call super() with the collection name
 * 2. Override hydrateDates() if the entity has date fields
 * 3. Implement domain-specific query methods
 */

import { FileStore } from './file-store.js';

/**
 * Base class for file-based repositories.
 *
 * @template T - Entity type with required `id` field
 */
export abstract class FileRepositoryBase<T extends { id: string }> {
  protected readonly store: FileStore<T>;

  constructor(baseDir: string, collectionName: string) {
    this.store = new FileStore<T>(baseDir, collectionName);
  }

  /**
   * Find an entity by ID.
   */
  async findById(id: string): Promise<T | null> {
    const result = await this.store.get(id);
    return result ? this.hydrateDates(result) : null;
  }

  /**
   * Save an entity (create or update).
   */
  async save(item: T): Promise<void> {
    await this.store.set(item);
  }

  /**
   * Save multiple entities.
   */
  async saveMany(items: T[]): Promise<void> {
    await this.store.setMany(items);
  }

  /**
   * Delete an entity by ID.
   */
  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * Find all entities matching a predicate.
   * Results are hydrated with proper Date objects.
   */
  protected async findWhere(predicate: (item: T) => boolean): Promise<T[]> {
    const results = await this.store.find(predicate);
    return results.map(item => this.hydrateDates(item));
  }

  /**
   * Find the first entity matching a predicate.
   * Result is hydrated with proper Date objects.
   */
  protected async findOneWhere(predicate: (item: T) => boolean): Promise<T | null> {
    const result = await this.store.findOne(predicate);
    return result ? this.hydrateDates(result) : null;
  }

  /**
   * Count entities matching a predicate.
   */
  protected async countWhere(predicate: (item: T) => boolean): Promise<number> {
    return this.store.count(predicate);
  }

  /**
   * Delete all entities matching a predicate.
   */
  protected async deleteWhere(predicate: (item: T) => boolean): Promise<void> {
    await this.store.deleteMany(predicate);
  }

  /**
   * Hydrate date fields from JSON storage.
   *
   * Override this method in subclasses that have date fields.
   * The default implementation returns the item unchanged.
   *
   * @example
   * protected hydrateDates(item: MyEntity): MyEntity {
   *   return {
   *     ...item,
   *     createdAt: normalizeDate(item.createdAt),
   *     updatedAt: normalizeDateOrNull(item.updatedAt),
   *   };
   * }
   */
  protected hydrateDates(item: T): T {
    return item;
  }
}
