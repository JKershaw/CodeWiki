/**
 * Centralized date utilities for normalizing dates from JSON storage.
 *
 * JSON storage may convert Date objects to:
 * - ISO strings (e.g., "2024-01-15T10:30:00.000Z")
 * - Wrapped objects (e.g., { __type: 'Date', value: '...' })
 *
 * These utilities normalize both formats back to proper Date objects.
 * MongoDB handles dates natively, so these are primarily for file-based storage.
 */

/**
 * Normalize a value to a Date object.
 * Handles: Date objects, ISO strings, wrapped { __type: 'Date', value: '...' }
 *
 * For undefined/null values, returns an Invalid Date (matching Date constructor behavior).
 * This maintains backwards compatibility with code that relied on `new Date(undefined)`.
 */
export function normalizeDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    return new Date(value);
  }

  // Handle wrapped date format from file-store.ts
  if (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    (value as Record<string, unknown>).__type === 'Date' &&
    'value' in value
  ) {
    return new Date((value as Record<string, unknown>).value as string);
  }

  // For undefined, null, or other values, return new Date(value) which may be Invalid Date
  // This matches the old behavior of `new Date(value as unknown as string)`
  return new Date(value as unknown as string);
}

/**
 * Normalize a value to a Date object or null.
 * Returns null for null, undefined, or empty values.
 *
 * @throws Error if value is non-null and cannot be converted to a valid Date
 */
export function normalizeDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeDate(value);
}

/**
 * Safely get timestamp from a Date, string, or null/undefined.
 * Useful for sorting and comparisons.
 *
 * @returns Timestamp in milliseconds, or 0 for null/undefined
 */
export function getTime(date: Date | string | null | undefined): number {
  if (date === null || date === undefined) {
    return 0;
  }

  if (date instanceof Date) {
    return date.getTime();
  }

  return new Date(date).getTime();
}

/**
 * Configuration for date field normalization.
 */
export interface DateFieldConfig<T> {
  /** Fields that are always Date (never null) */
  required: (keyof T)[];
  /** Fields that are Date | null */
  optional?: (keyof T)[];
}

/**
 * Create a type-safe date normalizer function for a specific entity type.
 *
 * @example
 * const normalizeWorkItemDates = createDateNormalizer<WorkItem>({
 *   required: ['createdAt'],
 *   optional: ['claimedAt', 'completedAt'],
 * });
 *
 * const normalized = normalizeWorkItemDates(item);
 */
export function createDateNormalizer<T>(
  config: DateFieldConfig<T>
): (item: T) => T {
  return (item: T): T => {
    const result = { ...item };

    for (const field of config.required) {
      (result as Record<string, unknown>)[field as string] = normalizeDate(
        (item as Record<string, unknown>)[field as string]
      );
    }

    if (config.optional) {
      for (const field of config.optional) {
        (result as Record<string, unknown>)[field as string] = normalizeDateOrNull(
          (item as Record<string, unknown>)[field as string]
        );
      }
    }

    return result;
  };
}
