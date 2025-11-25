/**
 * CQRS Query types.
 *
 * Queries are things that read state. They don't modify anything,
 * just return data from the system.
 */

/**
 * Base interface for all queries.
 */
export interface Query {
  readonly type: string;
}

/**
 * Result of executing a query.
 */
export interface QueryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Query handler function type.
 */
export type QueryHandler<Q extends Query, R> = (query: Q) => Promise<QueryResult<R>>;

/**
 * Helper to create a successful query result.
 */
export function found<T>(data: T): QueryResult<T> {
  return { success: true, data };
}

/**
 * Helper to create a not found result.
 */
export function notFound(message: string): QueryResult<never> {
  return { success: false, error: message };
}

/**
 * Helper to create an error result.
 */
export function queryError(error: string): QueryResult<never> {
  return { success: false, error };
}
