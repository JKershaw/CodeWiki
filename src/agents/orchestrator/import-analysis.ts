/**
 * Import analysis for dependency-based importance weighting.
 *
 * Files that are imported by many others are more important to document
 * because they form the foundation of the codebase.
 *
 * This module provides:
 * - Import extraction from TypeScript/JavaScript files
 * - Dependency graph building
 * - Importance boost calculation based on dependent count
 */

/** Built-in Node.js modules to exclude */
const BUILTIN_MODULES = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util',
  'stream', 'events', 'buffer', 'child_process', 'cluster', 'dgram',
  'dns', 'domain', 'net', 'readline', 'repl', 'tls', 'tty', 'v8',
  'vm', 'zlib', 'assert', 'console', 'perf_hooks', 'worker_threads',
  'fs/promises', 'node:fs', 'node:path', 'node:os', 'node:crypto',
]);

/** Threshold for 1.5x boost (5-9 dependents) */
const MEDIUM_DEPENDENT_THRESHOLD = 5;

/** Threshold for 2.0x boost (10+ dependents) */
const HIGH_DEPENDENT_THRESHOLD = 10;

/**
 * Extract import paths from file content.
 *
 * Handles:
 * - ES module imports (import x from './y')
 * - Dynamic imports (import('./y'))
 * - CommonJS require (require('./y'))
 *
 * Excludes:
 * - Node.js built-in modules
 * - npm packages (no ./ or ../ prefix)
 *
 * @param content - File content
 * @returns Array of relative import paths
 */
export function extractImports(content: string): string[] {
  if (!content) {
    return [];
  }

  const imports: string[] = [];

  // Match ES module imports: import x from 'path'
  // Handles: import { x } from 'path', import x from 'path', import * as x from 'path'
  const esImportPattern = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = esImportPattern.exec(content)) !== null) {
    const importPath = match[1]!;
    if (isLocalImport(importPath)) {
      imports.push(importPath);
    }
  }

  // Match dynamic imports: import('path')
  const dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportPattern.exec(content)) !== null) {
    const importPath = match[1]!;
    if (isLocalImport(importPath)) {
      imports.push(importPath);
    }
  }

  // Match CommonJS require: require('path')
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    const importPath = match[1]!;
    if (isLocalImport(importPath)) {
      imports.push(importPath);
    }
  }

  return imports;
}

/**
 * Check if an import path is local (not npm package or built-in).
 */
function isLocalImport(importPath: string): boolean {
  // Local imports start with ./ or ../
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
    return false;
  }

  // Check for built-in modules (shouldn't happen with ./ prefix, but be safe)
  if (BUILTIN_MODULES.has(importPath)) {
    return false;
  }

  return true;
}

/**
 * Resolve a relative import path to an absolute path.
 *
 * @param fromPath - Path of the importing file (e.g., 'src/services/api.ts')
 * @param importPath - Relative import path (e.g., '../utils.js')
 * @returns Resolved path (e.g., 'src/utils')
 */
function resolveImportPath(fromPath: string, importPath: string): string {
  // Get directory of the importing file
  const fromDir = fromPath.split('/').slice(0, -1).join('/');

  // Split import path into parts
  const importParts = importPath.split('/');
  const dirParts = fromDir ? fromDir.split('/') : [];

  for (const part of importParts) {
    if (part === '.') {
      // Current directory - do nothing
    } else if (part === '..') {
      // Parent directory
      dirParts.pop();
    } else {
      // Regular path segment
      dirParts.push(part);
    }
  }

  const resolved = dirParts.join('/');

  // Remove extension for normalization
  return resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
}

/**
 * Build a dependency graph from file contents.
 *
 * @param files - Map of file path to content
 * @returns Map of file path to set of dependent file paths
 */
export function buildDependencyGraph(
  files: Map<string, string>
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Create normalized path lookup
  const normalizedPaths = new Map<string, string>();
  for (const path of files.keys()) {
    const normalized = path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
    normalizedPaths.set(normalized, path);
    // Also add with index suffix for directory imports
    if (path.endsWith('/index.ts') || path.endsWith('/index.js')) {
      const dirPath = path.split('/').slice(0, -1).join('/');
      normalizedPaths.set(dirPath, path);
    }
  }

  for (const [filePath, content] of files) {
    const imports = extractImports(content);

    for (const importPath of imports) {
      // Resolve the import path
      const resolved = resolveImportPath(filePath, importPath);

      // Find the actual file path
      const targetPath = normalizedPaths.get(resolved);
      if (targetPath) {
        // Add filePath as a dependent of targetPath
        if (!graph.has(targetPath)) {
          graph.set(targetPath, new Set());
        }
        graph.get(targetPath)!.add(filePath);
      }
    }
  }

  return graph;
}

/**
 * Get the number of files that depend on a given file.
 *
 * @param filePath - Path to the file
 * @param graph - Dependency graph from buildDependencyGraph
 * @returns Number of dependent files
 */
export function calculateDependentCount(
  filePath: string,
  graph: Map<string, Set<string>>
): number {
  const dependents = graph.get(filePath);
  return dependents ? dependents.size : 0;
}

/**
 * Calculate importance boost based on number of dependents.
 *
 * - 0-4 dependents: 1.0x (no boost)
 * - 5-9 dependents: 1.5x (medium boost)
 * - 10+ dependents: 2.0x (high boost)
 *
 * @param dependentCount - Number of files that import this file
 * @returns Boost multiplier (1.0, 1.5, or 2.0)
 */
export function calculateImportanceBoost(dependentCount: number): number {
  if (dependentCount >= HIGH_DEPENDENT_THRESHOLD) {
    return 2.0;
  }
  if (dependentCount >= MEDIUM_DEPENDENT_THRESHOLD) {
    return 1.5;
  }
  return 1.0;
}

/**
 * Calculate combined priority score with all boosts.
 *
 * Combines:
 * - Base priority from coverage and LOC
 * - Entry point boost
 * - Import-based importance boost
 *
 * @param baseScore - Base priority score
 * @param isEntryPoint - Whether file is an entry point
 * @param dependentCount - Number of dependent files
 * @returns Boosted priority score
 */
export function calculateFullPriorityScore(
  baseScore: number,
  isEntryPoint: boolean,
  dependentCount: number
): number {
  let score = baseScore;

  // Apply entry point boost (2.0x)
  if (isEntryPoint) {
    score *= 2.0;
  }

  // Apply import-based boost
  score *= calculateImportanceBoost(dependentCount);

  return score;
}
