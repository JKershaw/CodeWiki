/**
 * MongoDB utility functions for document <-> entity conversion.
 *
 * MongoDB uses `_id` for document identifiers, while our domain uses `id`.
 * These utilities handle the conversion between the two formats.
 *
 * We use string IDs stored directly in the `_id` field (not ObjectId).
 * Type assertions are used because MongoDB's TypeScript types expect ObjectId
 * for _id, but we're using strings which MongoDB fully supports at runtime.
 */

import type { Document, Filter } from 'mongodb';

/**
 * Base entity type with string id.
 */
export interface EntityWithId {
  id: string;
}

/**
 * MongoDB document type with string _id.
 * This is used when we store string IDs directly in the _id field.
 */
export interface MongoDoc {
  _id: string;
  [key: string]: unknown;
}

/**
 * Convert a MongoDB document to a domain entity.
 * Copies _id to id and removes _id from the result.
 */
export function toEntity<T extends EntityWithId>(doc: Document | null): T | null {
  if (!doc) return null;

  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: String(_id),
  } as T;
}

/**
 * Convert multiple MongoDB documents to domain entities.
 */
export function toEntities<T extends EntityWithId>(docs: Document[]): T[] {
  return docs.map(doc => toEntity<T>(doc)!);
}

/**
 * Convert a domain entity to a MongoDB document.
 * Uses id as _id for the document.
 */
export function toDocument<T extends EntityWithId>(entity: T): MongoDoc {
  const { id, ...rest } = entity;
  return {
    _id: id,
    ...rest,
  };
}

/**
 * Convert multiple domain entities to MongoDB documents.
 */
export function toDocuments<T extends EntityWithId>(entities: T[]): MongoDoc[] {
  return entities.map(toDocument);
}

/**
 * Create a filter by string ID.
 * Uses type assertion because MongoDB types expect ObjectId for _id,
 * but strings work at runtime.
 */
export function byId(id: string): Filter<Document> {
  return { _id: id } as unknown as Filter<Document>;
}

/**
 * Create a bulk write replace operation for an entity.
 */
export function replaceOp<T extends EntityWithId>(entity: T) {
  return {
    replaceOne: {
      filter: { _id: entity.id } as unknown as Filter<Document>,
      replacement: toDocument(entity) as unknown as Document,
      upsert: true,
    },
  };
}

/**
 * Create a filter for multiple IDs ($in query).
 */
export function byIds(ids: string[]): Filter<Document> {
  return { _id: { $in: ids } } as unknown as Filter<Document>;
}

/**
 * Create a filter that excludes an ID ($ne query).
 */
export function idNotEqual(id: string): { _id: unknown } {
  return { _id: { $ne: id } as unknown };
}
