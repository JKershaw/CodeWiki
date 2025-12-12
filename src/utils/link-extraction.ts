/**
 * Utilities for extracting wiki page links from markdown content.
 *
 * These utilities help maintain consistency between:
 * - Content-based links (markdown links in page text)
 * - Graph-based links (page.links array in database)
 *
 * Used by synthesis agents and link management to ensure proper
 * graph tracking of page relationships.
 */

/**
 * Extract wiki page links from markdown content.
 *
 * Features:
 * - Extracts markdown links in format [text](path)
 * - Removes .md extension from paths
 * - Removes leading / or ./ from paths
 * - Filters out external URLs and URL schemes (http://, https://, mailto:, etc.)
 * - Filters out anchor-only links (#section)
 * - Extracts path portion from links with anchors (path#section -> path)
 * - Ignores links inside code blocks and inline code
 * - Deduplicates results
 *
 * @param content - Markdown content to extract links from
 * @returns Array of unique wiki page paths
 */
export function extractLinksFromContent(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Remove code blocks to avoid extracting links from code
  const contentWithoutCodeBlocks = removeCodeBlocks(content);

  // Remove inline code to avoid extracting links from inline code
  const contentWithoutCode = removeInlineCode(contentWithoutCodeBlocks);

  const links: string[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  let match;
  while ((match = linkRegex.exec(contentWithoutCode)) !== null) {
    const rawPath = match[2]!;

    // Skip external URLs and other URL schemes (mailto:, ftp:, file:, etc.)
    if (rawPath.includes('://') || rawPath.startsWith('mailto:')) {
      continue;
    }

    // Skip anchor-only links
    if (rawPath.startsWith('#')) {
      continue;
    }

    // Extract path portion (remove anchor if present)
    let path = rawPath.split('#')[0]!;

    // Normalize the path
    path = normalizePath(path);

    if (path.length > 0) {
      links.push(path);
    }
  }

  // Deduplicate and return
  return [...new Set(links)];
}

/**
 * Extract wiki page links from content as a Set.
 * Useful for quick existence checks.
 *
 * @param content - Markdown content to extract links from
 * @returns Set of unique wiki page paths
 */
export function extractLinkTargetsAsSet(content: string): Set<string> {
  return new Set(extractLinksFromContent(content));
}

/**
 * Normalize a wiki page path.
 * - Removes .md extension
 * - Removes leading / or ./
 *
 * @param path - Raw path from markdown link
 * @returns Normalized path
 */
function normalizePath(path: string): string {
  return path
    .replace(/\.md$/, '')      // Remove .md extension
    .replace(/^\.?\//, '');    // Remove leading / or ./
}

/**
 * Remove fenced code blocks from content.
 * This prevents extracting false positive links from code examples.
 */
function removeCodeBlocks(content: string): string {
  // Match fenced code blocks (``` ... ```)
  return content.replace(/```[\s\S]*?```/g, '');
}

/**
 * Remove inline code from content.
 * This prevents extracting false positive links from inline code.
 */
function removeInlineCode(content: string): string {
  // Match inline code (`...`)
  return content.replace(/`[^`]+`/g, '');
}
