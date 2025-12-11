/**
 * Richer shallow page detection for wiki quality assessment.
 *
 * Uses multi-factor detection instead of simple character count:
 * - Word count < threshold (more meaningful than chars)
 * - Heading count < threshold (indicates lack of structure)
 * - Both conditions must be true to be considered "shallow"
 *
 * This reduces false positives (concise but well-structured pages)
 * and false negatives (verbose but poorly structured pages).
 */

/** Minimum word count to not be considered shallow */
export const MIN_WORD_COUNT = 100;

/** Minimum heading count to not be considered shallow */
export const MIN_HEADING_COUNT = 2;

/**
 * Count words in content.
 *
 * Splits on whitespace and counts non-empty tokens.
 * Handles markdown formatting gracefully.
 *
 * @param content - Page content
 * @returns Number of words
 */
export function countWords(content: string): number {
  if (!content || !content.trim()) {
    return 0;
  }

  // Split on whitespace and filter out empty strings
  // This handles multiple spaces, newlines, etc.
  const words = content
    .split(/\s+/)
    .filter(word => word.length > 0);

  return words.length;
}

/**
 * Count markdown headings in content.
 *
 * Counts ATX-style headings (# to ######) at the start of lines.
 *
 * @param content - Page content
 * @returns Number of headings
 */
export function countHeadings(content: string): number {
  if (!content) {
    return 0;
  }

  // Match ATX headings: # to ###### at start of line
  // The heading must have a space after the # characters
  const headingPattern = /^#{1,6}\s+/gm;
  const matches = content.match(headingPattern);

  return matches ? matches.length : 0;
}

/**
 * Determine if a page is shallow (needs more content).
 *
 * A page is shallow if it has BOTH:
 * - Less than MIN_WORD_COUNT words (default 100)
 * - Less than MIN_HEADING_COUNT headings (default 2)
 *
 * This means:
 * - A short but well-structured page (few words, many headings) is NOT shallow
 * - A long but unstructured page (many words, no headings) is NOT shallow
 * - A short and unstructured page IS shallow
 *
 * Overview and index pages are excluded (they're expected to be navigational).
 *
 * @param content - Page content
 * @param path - Optional page path to check for overview/index exceptions
 * @returns true if the page is shallow
 */
export function isShallowPage(content: string, path?: string): boolean {
  // Exclude overview and index pages - they're expected to be shorter/navigational
  if (path) {
    const lowerPath = path.toLowerCase();
    if (lowerPath.endsWith('/overview') || lowerPath === 'overview') {
      return false;
    }
    if (lowerPath.endsWith('/index') || lowerPath === 'index') {
      return false;
    }
  }

  // Empty content is definitely shallow
  if (!content || !content.trim()) {
    return true;
  }

  const wordCount = countWords(content);
  const headingCount = countHeadings(content);

  // Shallow only if BOTH criteria are below threshold
  // This means either sufficient words OR sufficient structure is enough
  return wordCount < MIN_WORD_COUNT && headingCount < MIN_HEADING_COUNT;
}

/**
 * Calculate shallow pages from a list of wiki pages.
 *
 * @param pages - Array of wiki pages with path and content
 * @returns Number of shallow pages
 */
export function calculateShallowPagesRicher(
  pages: Array<{ path: string; content: string }>
): number {
  return pages.filter(p => isShallowPage(p.content, p.path)).length;
}

/**
 * Get list of shallow page paths.
 *
 * @param pages - Array of wiki pages with path and content
 * @returns Array of paths for shallow pages
 */
export function getShallowPagePaths(
  pages: Array<{ path: string; content: string }>
): string[] {
  return pages
    .filter(p => isShallowPage(p.content, p.path))
    .map(p => p.path);
}
