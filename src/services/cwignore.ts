/**
 * Utility for parsing and loading .cwignore files.
 *
 * Follows .gitignore syntax:
 * - Lines starting with # are comments
 * - Lines starting with ! are negation patterns (not supported, ignored)
 * - Empty lines are skipped
 * - Glob patterns are passed directly to fast-glob
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

const CWIGNORE_FILENAME = '.cwignore';

/** Default patterns that are always ignored */
export const DEFAULT_IGNORE_PATTERNS = ['node_modules/**', '.git/**'];

/** Cache for parsed ignore patterns by repo path */
const patternCache = new Map<string, string[]>();

/**
 * Parse a .cwignore file content into an array of patterns.
 */
export function parseIgnorePatterns(content: string): string[] {
  const patterns: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Skip negation patterns (not supported by fast-glob ignore option)
    if (trimmed.startsWith('!')) {
      continue;
    }

    // Add trailing /** for directory patterns ending with /
    if (trimmed.endsWith('/')) {
      patterns.push(trimmed + '**');
    } else {
      patterns.push(trimmed);
    }
  }

  return patterns;
}

/**
 * Load ignore patterns from a repository's .cwignore file.
 *
 * Returns the default patterns merged with custom patterns from .cwignore.
 * Results are cached per repository path.
 *
 * @param repoPath - Root path of the repository
 * @returns Array of glob patterns to ignore
 */
export async function loadIgnorePatterns(repoPath: string): Promise<string[]> {
  // Check cache first
  if (patternCache.has(repoPath)) {
    return patternCache.get(repoPath)!;
  }

  const cwignorePath = join(repoPath, CWIGNORE_FILENAME);
  let customPatterns: string[] = [];

  try {
    const content = await readFile(cwignorePath, 'utf-8');
    customPatterns = parseIgnorePatterns(content);
  } catch {
    // No .cwignore file or unreadable - use defaults only
  }

  // Merge default patterns with custom patterns
  const allPatterns = [...DEFAULT_IGNORE_PATTERNS, ...customPatterns];

  // Cache the result
  patternCache.set(repoPath, allPatterns);

  return allPatterns;
}

/**
 * Clear the pattern cache for a specific repo or all repos.
 * Useful for testing or when .cwignore file changes.
 */
export function clearIgnoreCache(repoPath?: string): void {
  if (repoPath) {
    patternCache.delete(repoPath);
  } else {
    patternCache.clear();
  }
}
