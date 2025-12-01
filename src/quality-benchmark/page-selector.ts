/**
 * Page Selector - Selects wiki pages for quality evaluation.
 *
 * Uses a combination of heuristics and random sampling to select
 * a representative set of pages for quality benchmarking.
 */

import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Options for page selection.
 */
export interface PageSelectionOptions {
  /** Maximum total pages to select (default: 20) */
  maxPages?: number;
  /** Number of lowest-confidence pages to include (default: 2) */
  includeLowestConfidence?: number;
  /** Number of most recently updated pages to include (default: 2) */
  includeRecentlyUpdated?: number;
  /** Number of random pages to include (default: remaining slots) */
  includeRandom?: number;
  /** Minimum content length to consider a page (default: 0) */
  minContentLength?: number;
}

/**
 * Result of page selection with metadata.
 */
export interface PageSelectionResult {
  /** Selected pages */
  pages: WikiPage[];
  /** Selection metadata */
  metadata: {
    totalPagesInWiki: number;
    selectedByConfidence: number;
    selectedByRecency: number;
    selectedRandomly: number;
    excludedTooShort: number;
  };
}

/**
 * Select pages for quality evaluation using heuristics + random sampling.
 *
 * Strategy:
 * 1. Include N lowest-confidence pages (likely have quality issues)
 * 2. Include N most recently updated pages (freshness check)
 * 3. Fill remaining slots with random pages (unbiased sampling)
 */
export function selectPagesForEvaluation(
  pages: WikiPage[],
  options: PageSelectionOptions = {}
): PageSelectionResult {
  const {
    maxPages = 20,
    includeLowestConfidence = 2,
    includeRecentlyUpdated = 2,
    minContentLength = 0,
  } = options;

  // Filter out pages that are too short
  const eligiblePages = pages.filter(p => p.content.length >= minContentLength);
  const excludedTooShort = pages.length - eligiblePages.length;

  if (eligiblePages.length === 0) {
    return {
      pages: [],
      metadata: {
        totalPagesInWiki: pages.length,
        selectedByConfidence: 0,
        selectedByRecency: 0,
        selectedRandomly: 0,
        excludedTooShort,
      },
    };
  }

  // If we have fewer eligible pages than maxPages, return all
  if (eligiblePages.length <= maxPages) {
    return {
      pages: eligiblePages,
      metadata: {
        totalPagesInWiki: pages.length,
        selectedByConfidence: 0,
        selectedByRecency: 0,
        selectedRandomly: eligiblePages.length,
        excludedTooShort,
      },
    };
  }

  const selected: WikiPage[] = [];
  const selectedIds = new Set<string>();

  // Helper to add page if not already selected
  const addPage = (page: WikiPage): boolean => {
    if (selectedIds.has(page.id)) return false;
    selected.push(page);
    selectedIds.add(page.id);
    return true;
  };

  // 1. Select lowest-confidence pages
  const byConfidence = [...eligiblePages].sort((a, b) => a.confidence - b.confidence);
  let addedByConfidence = 0;
  for (const page of byConfidence) {
    if (addedByConfidence >= includeLowestConfidence) break;
    if (addPage(page)) addedByConfidence++;
  }

  // 2. Select most recently updated pages
  const byRecency = [...eligiblePages].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );
  let addedByRecency = 0;
  for (const page of byRecency) {
    if (addedByRecency >= includeRecentlyUpdated) break;
    if (addPage(page)) addedByRecency++;
  }

  // 3. Fill remaining slots with random pages
  const remainingSlots = maxPages - selected.length;
  const unselected = eligiblePages.filter(p => !selectedIds.has(p.id));
  const shuffled = shuffleArray(unselected);
  let addedRandomly = 0;
  for (const page of shuffled) {
    if (addedRandomly >= remainingSlots) break;
    if (addPage(page)) addedRandomly++;
  }

  return {
    pages: selected,
    metadata: {
      totalPagesInWiki: pages.length,
      selectedByConfidence: addedByConfidence,
      selectedByRecency: addedByRecency,
      selectedRandomly: addedRandomly,
      excludedTooShort,
    },
  };
}

/**
 * Fisher-Yates shuffle algorithm.
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

/**
 * Additional heuristic selectors for specific evaluation needs.
 */
export const PageSelectors = {
  /**
   * Select pages with extreme characteristics for edge case testing.
   */
  selectExtremes(pages: WikiPage[], count: number = 4): WikiPage[] {
    const eligible = pages.filter(p => p.content.length >= 0);
    if (eligible.length <= count) return eligible;

    const selected: WikiPage[] = [];
    const selectedIds = new Set<string>();

    // Longest page
    const byLength = [...eligible].sort((a, b) => b.content.length - a.content.length);
    if (byLength[0] && !selectedIds.has(byLength[0].id)) {
      selected.push(byLength[0]);
      selectedIds.add(byLength[0].id);
    }

    // Shortest eligible page
    const shortest = byLength[byLength.length - 1];
    if (shortest && !selectedIds.has(shortest.id)) {
      selected.push(shortest);
      selectedIds.add(shortest.id);
    }

    // Most linked page
    const byLinks = [...eligible].sort((a, b) => b.links.length - a.links.length);
    if (byLinks[0] && !selectedIds.has(byLinks[0].id)) {
      selected.push(byLinks[0]);
      selectedIds.add(byLinks[0].id);
    }

    // Most backlinked page (hub page)
    const byBacklinks = [...eligible].sort((a, b) => b.backlinks.length - a.backlinks.length);
    if (byBacklinks[0] && !selectedIds.has(byBacklinks[0].id)) {
      selected.push(byBacklinks[0]);
      selectedIds.add(byBacklinks[0].id);
    }

    return selected.slice(0, count);
  },

  /**
   * Select pages that likely represent different content types.
   */
  selectDiverse(pages: WikiPage[], count: number = 5): WikiPage[] {
    const eligible = pages.filter(p => p.content.length >= 0);
    if (eligible.length <= count) return eligible;

    const selected: WikiPage[] = [];
    const selectedIds = new Set<string>();

    // Categorize by path patterns
    const categories: Record<string, WikiPage[]> = {};
    for (const page of eligible) {
      const category = page.path.split('/')[0] || 'root';
      if (!categories[category]) categories[category] = [];
      categories[category].push(page);
    }

    // Select one random page from each category
    const categoryKeys = Object.keys(categories);
    const shuffledCategories = shuffleArray(categoryKeys);

    for (const category of shuffledCategories) {
      if (selected.length >= count) break;
      const categoryPages = categories[category]!;
      const randomPage = categoryPages[Math.floor(Math.random() * categoryPages.length)];
      if (randomPage && !selectedIds.has(randomPage.id)) {
        selected.push(randomPage);
        selectedIds.add(randomPage.id);
      }
    }

    return selected;
  },
};
