/**
 * Shared helper functions for wiki page operations.
 *
 * These helpers reduce duplication across wiki-tools and analysis-tools
 * by providing common page lookup and filtering functionality.
 */

import type { WikiPage } from '../../domain/wiki-page.js';

/**
 * Result of finding a wiki page.
 */
export interface FindPageResult {
  /** The found page, or undefined if not found */
  page: WikiPage | undefined;
  /** Whether the match was exact (path equals) or partial (path includes) */
  matchType: 'exact' | 'partial' | 'not-found';
}

/**
 * Find a wiki page by path with case-insensitive matching.
 *
 * First tries exact match, then falls back to partial match.
 */
export function findPageByPath(pages: WikiPage[], path: string): FindPageResult {
  const normalizedPath = path.toLowerCase();

  // Try exact match first
  const exactMatch = pages.find(p => p.path.toLowerCase() === normalizedPath);
  if (exactMatch) {
    return { page: exactMatch, matchType: 'exact' };
  }

  // Try partial match
  const partialMatch = pages.find(p => p.path.toLowerCase().includes(normalizedPath));
  if (partialMatch) {
    return { page: partialMatch, matchType: 'partial' };
  }

  return { page: undefined, matchType: 'not-found' };
}

/**
 * Get suggested pages when a requested page is not found.
 *
 * Looks for pages that share path segments with the requested path.
 */
export function getSuggestedPages(pages: WikiPage[], requestedPath: string, limit: number = 5): WikiPage[] {
  const pathParts = requestedPath.toLowerCase().split('/');

  return pages
    .filter(p => pathParts.some(part => part.length > 0 && p.path.toLowerCase().includes(part)))
    .slice(0, limit);
}

/**
 * Format a "page not found" error message with suggestions.
 */
export function formatPageNotFoundError(requestedPath: string, pages: WikiPage[]): string {
  const suggestions = getSuggestedPages(pages, requestedPath);

  if (suggestions.length > 0) {
    return `Page "${requestedPath}" not found. Did you mean one of these?\n${suggestions.map(p => `- ${p.path}`).join('\n')}`;
  }

  return `Page "${requestedPath}" not found. Use search_wiki to find relevant pages.`;
}

/**
 * Filter pages by category/path prefix.
 */
export function filterPagesByCategory(pages: WikiPage[], category: string): WikiPage[] {
  const lowerCategory = category.toLowerCase();

  return pages.filter(
    p =>
      p.path.toLowerCase().startsWith(lowerCategory) ||
      p.path.toLowerCase().includes('/' + lowerCategory)
  );
}

/**
 * Group pages by their top-level category (first path segment).
 */
export function groupPagesByCategory(pages: WikiPage[]): Record<string, WikiPage[]> {
  const grouped: Record<string, WikiPage[]> = {};

  for (const page of pages) {
    const parts = page.path.split('/');
    const topLevel = parts.length > 1 ? parts[0]! : '(root)';
    if (!grouped[topLevel]) grouped[topLevel] = [];
    grouped[topLevel]!.push(page);
  }

  return grouped;
}

/**
 * Default maximum content length for wiki page display.
 */
export const DEFAULT_MAX_CONTENT_LENGTH = 4000;

/**
 * Truncate content if it exceeds the maximum length.
 */
export function truncateContent(content: string, maxLength: number = DEFAULT_MAX_CONTENT_LENGTH): {
  content: string;
  truncated: boolean;
} {
  if (content.length <= maxLength) {
    return { content, truncated: false };
  }

  return {
    content: content.slice(0, maxLength) + '\n\n... (content truncated)',
    truncated: true,
  };
}
