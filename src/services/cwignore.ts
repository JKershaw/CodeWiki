/**
 * Utility for parsing and loading .cwignore files.
 *
 * Implements a layered ignore system:
 * 1. Hardcoded defaults (node_modules, .git, common build outputs)
 * 2. .gitignore patterns (if exists)
 * 3. .cwignore patterns (if exists) - can add or negate patterns
 *
 * Uses the `ignore` package for proper gitignore syntax support including
 * negation patterns (!pattern).
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import ignore, { Ignore } from 'ignore';

const CWIGNORE_FILENAME = '.cwignore';
const GITIGNORE_FILENAME = '.gitignore';

/** Default patterns that are always ignored */
export const DEFAULT_IGNORE_PATTERNS = [
  // Version control
  '.git/**',
  // Dependencies
  'node_modules/**',
  // Build outputs
  'dist/**',
  'build/**',
  'out/**',
  // Test coverage
  'coverage/**',
  // Logs and temp files
  '*.log',
  '.DS_Store',
  // Environment files (may contain secrets)
  '.env*',
];

/** Cache for Ignore instances by repo path */
const ignoreCache = new Map<string, Ignore>();

/** Cache for pattern arrays by repo path (for fast-glob compatibility) */
const patternCache = new Map<string, string[]>();

/**
 * Parse a .cwignore or .gitignore file content into an array of patterns.
 * This is used for fast-glob compatibility which needs string patterns.
 */
export function parseIgnorePatterns(content: string): string[] {
  const patterns: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Skip negation patterns for fast-glob (handled separately by ignore package)
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
 * Read file content safely, returning null if file doesn't exist or is unreadable.
 */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load ignore patterns from a repository using the layered approach.
 *
 * Layers (in order):
 * 1. Default patterns (node_modules, .git, build outputs, etc.)
 * 2. .gitignore patterns (if exists)
 * 3. .cwignore patterns (if exists)
 *
 * Returns patterns as string array for fast-glob compatibility.
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

  const allPatterns: string[] = [...DEFAULT_IGNORE_PATTERNS];

  // Layer 2: Add .gitignore patterns
  const gitignorePath = join(repoPath, GITIGNORE_FILENAME);
  const gitignoreContent = await readFileSafe(gitignorePath);
  if (gitignoreContent) {
    const gitignorePatterns = parseIgnorePatterns(gitignoreContent);
    allPatterns.push(...gitignorePatterns);
  }

  // Layer 3: Add .cwignore patterns
  const cwignorePath = join(repoPath, CWIGNORE_FILENAME);
  const cwignoreContent = await readFileSafe(cwignorePath);
  if (cwignoreContent) {
    const cwignorePatterns = parseIgnorePatterns(cwignoreContent);
    allPatterns.push(...cwignorePatterns);
  }

  // Cache the result
  patternCache.set(repoPath, allPatterns);

  return allPatterns;
}

/**
 * Create an Ignore instance from content strings.
 *
 * This is useful when you have the content of .gitignore and .cwignore
 * files (e.g., fetched from GitHub API) rather than filesystem access.
 *
 * @param gitignoreContent - Content of .gitignore file (optional)
 * @param cwignoreContent - Content of .cwignore file (optional)
 * @returns Ignore instance for checking if paths should be ignored
 */
export function createIgnoreFilterFromContent(
  gitignoreContent?: string | null,
  cwignoreContent?: string | null
): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE_PATTERNS);
  if (gitignoreContent) {
    ig.add(gitignoreContent);
  }
  if (cwignoreContent) {
    ig.add(cwignoreContent);
  }
  return ig;
}

/**
 * Create an Ignore instance with the layered patterns.
 *
 * This uses the `ignore` package for proper gitignore syntax support,
 * including negation patterns (!pattern).
 *
 * @param repoPath - Root path of the repository
 * @returns Ignore instance for checking if paths should be ignored
 */
export async function createIgnoreFilter(repoPath: string): Promise<Ignore> {
  // Check cache first
  if (ignoreCache.has(repoPath)) {
    return ignoreCache.get(repoPath)!;
  }

  const ig = ignore();

  // Layer 1: Add default patterns
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: Add .gitignore patterns (with full syntax support including negation)
  const gitignorePath = join(repoPath, GITIGNORE_FILENAME);
  const gitignoreContent = await readFileSafe(gitignorePath);
  if (gitignoreContent) {
    ig.add(gitignoreContent);
  }

  // Layer 3: Add .cwignore patterns (with full syntax support including negation)
  const cwignorePath = join(repoPath, CWIGNORE_FILENAME);
  const cwignoreContent = await readFileSafe(cwignorePath);
  if (cwignoreContent) {
    ig.add(cwignoreContent);
  }

  // Cache the result
  ignoreCache.set(repoPath, ig);

  return ig;
}

/**
 * Clear all caches for a specific repo or all repos.
 * Useful for testing or when ignore files change.
 */
export function clearIgnoreCache(repoPath?: string): void {
  if (repoPath) {
    patternCache.delete(repoPath);
    ignoreCache.delete(repoPath);
  } else {
    patternCache.clear();
    ignoreCache.clear();
  }
}
