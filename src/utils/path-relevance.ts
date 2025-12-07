/**
 * Utilities for sorting paths by relevance to a target path.
 *
 * Used to prioritize showing related paths first when truncating lists,
 * ensuring the most relevant items are visible regardless of list size.
 */

/**
 * Calculate shared prefix depth between two paths.
 * Returns the number of matching path segments from the start.
 *
 * @example
 * sharedPrefixDepth('src/agents/foo', 'src/agents/bar') // 2 (src, agents)
 * sharedPrefixDepth('src/agents/foo', 'src/services/bar') // 1 (src)
 * sharedPrefixDepth('foo/bar', 'baz/qux') // 0
 */
function sharedPrefixDepth(path1: string, path2: string): number {
  const parts1 = path1.split('/');
  const parts2 = path2.split('/');
  let depth = 0;

  for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
    if (parts1[i] === parts2[i]) {
      depth++;
    } else {
      break;
    }
  }

  return depth;
}

/**
 * Sort paths by relevance to a target path.
 *
 * Paths that share more prefix segments with the target are sorted first.
 * Paths with equal relevance maintain their original relative order (stable sort).
 *
 * @param paths - Array of paths to sort
 * @param targetPath - The reference path to sort by relevance to
 * @returns New array sorted by relevance (original not modified)
 *
 * @example
 * sortByPathRelevance(
 *   ['guides/testing', 'src/agents/foo', 'src/services/bar'],
 *   'src/agents/explorer'
 * )
 * // Returns: ['src/agents/foo', 'src/services/bar', 'guides/testing']
 */
export function sortByPathRelevance(paths: string[], targetPath: string): string[] {
  // Create array with original indices for stable sort
  const indexed = paths.map((path, index) => ({
    path,
    index,
    relevance: sharedPrefixDepth(path, targetPath),
  }));

  // Sort by relevance descending, then by original index for stability
  indexed.sort((a, b) => {
    if (b.relevance !== a.relevance) {
      return b.relevance - a.relevance;
    }
    return a.index - b.index;
  });

  return indexed.map(item => item.path);
}
