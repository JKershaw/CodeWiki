/**
 * Smart coverage filtering for orchestrator context.
 *
 * Instead of blindly truncating after N lines, this module filters
 * coverage items intelligently:
 * 1. Sort by coverage % ascending (lowest coverage = most important to show)
 * 2. Take up to targetCount items
 * 3. Report the effective threshold (coverage of last included item)
 *
 * This ensures undocumented areas are always visible, regardless of repo size.
 */

/**
 * Minimum interface for a coverage item.
 * Additional properties are preserved through filtering.
 */
export interface CoverageItem {
  path: string;
  coveragePercent: number;
}

/**
 * Options for filtering coverage items.
 */
export interface FilterOptions {
  /** Maximum number of items to return */
  targetCount: number;
}

/**
 * Result of filtering coverage items.
 */
export interface FilteredCoverageResult<T extends CoverageItem = CoverageItem> {
  /** Filtered and sorted items (lowest coverage first) */
  items: T[];
  /** Whether any items were truncated */
  truncated: boolean;
  /** Number of items that were truncated */
  truncatedCount: number;
  /**
   * The effective coverage threshold.
   * This is the coverage % of the last included item,
   * or 100 if all items were included.
   */
  effectiveThreshold: number;
}

/**
 * Filter and sort coverage items by coverage percentage.
 *
 * Items are sorted by coverage ascending (lowest first), then truncated
 * to the target count. This ensures the most important items (those with
 * lowest coverage) are always visible.
 *
 * The effective threshold adapts dynamically:
 * - Large repo with many undocumented areas: threshold stays low
 * - Small repo or mostly documented: threshold rises to fill the limit
 *
 * @param items - Array of items with coverage percentages
 * @param options - Filter options including target count
 * @returns Filtered result with items, truncation info, and effective threshold
 */
export function filterCoverageItems<T extends CoverageItem>(
  items: T[],
  options: FilterOptions
): FilteredCoverageResult<T> {
  const { targetCount } = options;

  // Handle edge cases
  if (items.length === 0) {
    return {
      items: [],
      truncated: false,
      truncatedCount: 0,
      effectiveThreshold: 100,
    };
  }

  if (targetCount <= 0) {
    return {
      items: [],
      truncated: true,
      truncatedCount: items.length,
      effectiveThreshold: 0,
    };
  }

  // Sort by coverage ascending (lowest coverage first = most important)
  const sorted = [...items].sort((a, b) => a.coveragePercent - b.coveragePercent);

  // Take up to targetCount items
  const selected = sorted.slice(0, targetCount);
  const truncatedCount = Math.max(0, sorted.length - targetCount);

  // Calculate effective threshold
  // If all items included, threshold is 100 (no filtering)
  // Otherwise, it's the coverage of the last included item
  let effectiveThreshold: number;
  if (truncatedCount === 0) {
    effectiveThreshold = 100;
  } else {
    effectiveThreshold = selected[selected.length - 1]?.coveragePercent ?? 100;
  }

  return {
    items: selected,
    truncated: truncatedCount > 0,
    truncatedCount,
    effectiveThreshold,
  };
}
