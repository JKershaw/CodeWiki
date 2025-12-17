/**
 * Similarity utilities for detecting duplicate and related content.
 *
 * Used to prevent duplicate wiki pages by detecting:
 * - Similar titles (fuzzy matching)
 * - Similar paths (same category/naming patterns)
 * - Similar content (Jaccard similarity)
 */

import type { WikiPage } from '../domain/wiki-page.js';

/**
 * Calculate Jaccard similarity between two texts based on words.
 * Ignores short words (< 5 chars) to focus on meaningful content.
 *
 * @param text1 - First text
 * @param text2 - Second text
 * @returns Similarity score between 0 and 1
 */
export function calculateJaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 4));

  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection++;
  }

  const union = words1.size + words2.size - intersection;
  return intersection / union;
}

/**
 * Calculate similarity between two titles.
 * Normalizes titles by splitting into words and comparing as sets.
 *
 * @param title1 - First title
 * @param title2 - Second title
 * @returns Similarity score between 0 and 1
 */
export function calculateTitleSimilarity(title1: string, title2: string): number {
  // Normalize: lowercase, split on word boundaries (spaces, hyphens, underscores)
  const normalize = (title: string): Set<string> => {
    return new Set(
      title
        .toLowerCase()
        .split(/[\s\-_]+/)
        .filter(w => w.length > 0)
    );
  };

  const words1 = normalize(title1);
  const words2 = normalize(title2);

  if (words1.size === 0 || words2.size === 0) return 0;

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) intersection++;
  }

  const union = words1.size + words2.size - intersection;
  return intersection / union;
}

/**
 * Calculate similarity between two paths.
 * Considers path components (categories, segments).
 *
 * Pages in different categories are penalized to avoid false matches like
 * "modules/overview" being considered similar to "overview".
 *
 * @param path1 - First path
 * @param path2 - Second path
 * @returns Similarity score between 0 and 1
 */
export function calculatePathSimilarity(path1: string, path2: string): number {
  // Extract category (first path segment) for each path
  const getCategory = (path: string): string | null => {
    const segments = path.split('/').filter(s => s.length > 0);
    return segments.length > 1 ? segments[0]!.toLowerCase() : null;
  };

  const category1 = getCategory(path1);
  const category2 = getCategory(path2);

  // If paths are in different categories (or one is root-level), they're unlikely duplicates
  // Apply a heavy penalty to prevent false matches like "modules/overview" vs "overview"
  const differentCategories = category1 !== category2;

  // Split paths into components and sub-components
  const normalize = (path: string): Set<string> => {
    const parts = new Set<string>();

    // Add each path segment
    for (const segment of path.split('/')) {
      if (segment.length > 0) {
        parts.add(segment.toLowerCase());

        // Also add hyphen-separated sub-parts
        for (const subPart of segment.split('-')) {
          if (subPart.length > 2) {
            parts.add(subPart.toLowerCase());
          }
        }
      }
    }

    return parts;
  };

  const parts1 = normalize(path1);
  const parts2 = normalize(path2);

  if (parts1.size === 0 || parts2.size === 0) return 0;

  let intersection = 0;
  for (const part of parts1) {
    if (parts2.has(part)) intersection++;
  }

  const union = parts1.size + parts2.size - intersection;
  let similarity = intersection / union;

  // Penalize cross-category matches to prevent false positives
  // This ensures "modules/overview" won't match "overview" (0.5 * 0.5 = 0.25, below threshold)
  if (differentCategories) {
    similarity *= 0.5;
  }

  return similarity;
}

/**
 * Result from findSimilarPage.
 */
export interface SimilarPageMatch {
  /** The matching page */
  page: WikiPage;
  /** Which aspect matched: title, path, or content */
  matchType: 'title' | 'path' | 'content';
  /** Similarity score (0-1) */
  similarity: number;
}

/**
 * Find an existing page that is similar to the proposed new page.
 * Checks title, path, and content similarity.
 *
 * @param newTitle - Title of the proposed new page
 * @param newPath - Path of the proposed new page
 * @param newContent - Content of the proposed new page
 * @param existingPages - List of existing wiki pages
 * @param threshold - Minimum similarity score to consider a match (default: 0.6)
 * @returns The best matching page and match details, or null if no match
 */
export function findSimilarPage(
  newTitle: string,
  newPath: string,
  newContent: string,
  existingPages: WikiPage[],
  threshold: number = 0.6
): SimilarPageMatch | null {
  let bestMatch: SimilarPageMatch | null = null;
  let bestScore = 0;

  for (const page of existingPages) {
    // Check title similarity
    const titleSim = calculateTitleSimilarity(newTitle, page.title);
    if (titleSim >= threshold && titleSim > bestScore) {
      bestScore = titleSim;
      bestMatch = { page, matchType: 'title', similarity: titleSim };
    }

    // Check path similarity
    const pathSim = calculatePathSimilarity(newPath, page.path);
    if (pathSim >= threshold && pathSim > bestScore) {
      bestScore = pathSim;
      bestMatch = { page, matchType: 'path', similarity: pathSim };
    }

    // Check content similarity (only if content is substantial)
    if (newContent.length > 200 && page.content.length > 200) {
      const contentSim = calculateJaccardSimilarity(newContent, page.content);
      if (contentSim >= threshold && contentSim > bestScore) {
        bestScore = contentSim;
        bestMatch = { page, matchType: 'content', similarity: contentSim };
      }
    }
  }

  return bestMatch;
}
