/**
 * File-level coverage tree for Orchestrator context.
 *
 * Provides prioritized views of codebase coverage at the file level,
 * helping the Orchestrator identify the most important documentation gaps.
 */

/**
 * Minimal wiki page interface for coverage calculation.
 * Only requires path and content for checking mentions.
 */
export interface WikiPageLike {
  path: string;
  content: string;
}

// ============================================================================
// Types
// ============================================================================

/**
 * File node in the coverage tree.
 */
export interface FileNode {
  type: 'file';
  /** File name (e.g., "orchestrator.ts") */
  name: string;
  /** Full path from repo root (e.g., "src/agents/orchestrator/orchestrator.ts") */
  path: string;
  /** Lines of code */
  loc: number;
  /** Coverage percentage (0-100) based on wiki mentions */
  coveragePercent: number;
  /** Priority score for sorting (higher = more important to document) */
  score: number;
}

/**
 * Directory node in the coverage tree.
 */
export interface DirectoryNode {
  type: 'directory';
  /** Directory name (e.g., "orchestrator") */
  name: string;
  /** Full path from repo root (e.g., "src/agents/orchestrator") */
  path: string;
  /** Direct child files */
  files: FileNode[];
  /** Child directories */
  children: DirectoryNode[];
  /** Total LOC including all descendants */
  totalLoc: number;
  /** Total file count including all descendants */
  totalFileCount: number;
  /** Aggregated coverage percentage from all descendant files */
  coveragePercent: number;
}

/**
 * Raw file data from repository.
 */
export interface FileData {
  path: string;
  loc: number;
}

/**
 * Result of truncation operation.
 */
export interface TruncationResult {
  /** Selected files to display */
  files: FileNode[];
  /** Directory paths that must be shown (ancestors of selected files) */
  directories: string[];
  /** Total lines that will be used */
  totalLines: number;
  /** Number of files hidden due to budget */
  hiddenFileCount: number;
  /** Number of directories hidden */
  hiddenDirCount: number;
  /** Whether truncation occurred */
  wasTruncated: boolean;
  /** Effective coverage threshold (coverage of last included file) */
  effectiveThreshold: number;
}

/**
 * Truncation info for display.
 */
export interface TruncationInfo {
  hiddenFileCount: number;
  hiddenDirCount: number;
  effectiveThreshold: number;
  wasTruncated: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Low coverage threshold for warning marker (⚠️) */
export const LOW_COVERAGE_THRESHOLD = 40;

/** Default line budget for coverage tree output */
export const DEFAULT_LINE_BUDGET = 100;

// ============================================================================
// Priority Scoring
// ============================================================================

/**
 * Calculate priority score for a file or directory.
 *
 * Higher scores indicate higher priority for documentation.
 * - Uncovered items score higher than covered ones
 * - Larger items score higher than smaller ones (with log scaling)
 *
 * Formula: score = (1 - coveragePercent/100) * Math.log(loc + 1)
 *
 * @param coveragePercent - Coverage percentage (0-100)
 * @param loc - Lines of code
 * @returns Priority score (higher = more important to document)
 */
export function calculatePriorityScore(coveragePercent: number, loc: number): number {
  const coverageFactor = 1 - coveragePercent / 100;
  const sizeFactor = Math.log(loc + 1);
  return coverageFactor * sizeFactor;
}

/** Entry point file names (without extension) */
const ENTRY_POINT_NAMES = ['index', 'main', 'cli', 'app', 'server'];

/** Entry point boost multiplier */
const ENTRY_POINT_BOOST = 2.0;

/**
 * Check if a file path is an entry point.
 *
 * Entry points are files that serve as main entry into a module or application:
 * - index.ts/js - Module entry points
 * - main.ts/js - Application main files
 * - cli.ts/js - Command line interfaces
 * - app.ts/js - Application roots (including React's App.tsx)
 * - server.ts/js - Server entry points
 *
 * @param filePath - Full path to the file
 * @returns true if the file is an entry point
 */
export function isEntryPoint(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? '';

  // Exclude test files
  if (fileName.includes('.test.') || fileName.includes('.spec.')) {
    return false;
  }

  // Exclude files in test directories (handle both with and without leading slash)
  if (
    filePath.includes('/tests/') ||
    filePath.includes('/__tests__/') ||
    filePath.startsWith('tests/')
  ) {
    return false;
  }

  // Extract base name without extension
  // Handle: index.ts, index.js, index.tsx, index.jsx, index.mjs, index.cjs
  const match = fileName.match(/^([a-zA-Z]+)\.(ts|js|tsx|jsx|mjs|cjs)$/);
  if (!match) {
    return false;
  }

  const baseName = match[1]!;
  const baseNameLower = baseName.toLowerCase();

  // Special case: App.tsx/App.jsx (React convention with capital A)
  if (baseName === 'App' && (match[2] === 'tsx' || match[2] === 'jsx')) {
    return true;
  }

  // Only match lowercase entry point names (INDEX.ts is unusual and shouldn't match)
  if (baseName !== baseNameLower) {
    return false;
  }

  return ENTRY_POINT_NAMES.includes(baseNameLower);
}

/**
 * Calculate priority score with entry point boosting.
 *
 * Entry points get a 2x boost because they're critical for understanding:
 * - How the module/application is used
 * - The public API surface
 * - Where to start when learning the codebase
 *
 * @param coveragePercent - Coverage percentage (0-100)
 * @param loc - Lines of code
 * @param filePath - Full path to the file
 * @returns Priority score with entry point boost applied
 */
export function calculatePriorityScoreWithEntryPoint(
  coveragePercent: number,
  loc: number,
  filePath: string
): number {
  const baseScore = calculatePriorityScore(coveragePercent, loc);

  if (isEntryPoint(filePath)) {
    return baseScore * ENTRY_POINT_BOOST;
  }

  return baseScore;
}

// ============================================================================
// Coverage Calculation
// ============================================================================

/**
 * Calculate file coverage based on wiki mentions.
 * A file is considered "covered" if its name or path appears in wiki content.
 *
 * @param filePath - Full path to the file
 * @param wikiPages - Wiki pages to search for mentions
 * @returns Coverage percentage (0 or 100 for now - binary)
 * @deprecated Use calculateGraduatedCoverage for more nuanced scoring
 */
export function calculateFileCoverage(filePath: string, wikiPages: WikiPageLike[]): number {
  // Delegate to graduated coverage for consistency
  return calculateGraduatedCoverage(filePath, wikiPages);
}

/**
 * Calculate graduated file coverage based on wiki mentions.
 *
 * Returns tiered coverage levels:
 * - 0%   - No mention at all
 * - 25%  - Mentioned in passing (filename appears somewhere)
 * - 50%  - Has dedicated section (heading about file or multiple mentions with context)
 * - 100% - Has dedicated wiki page about the file
 *
 * @param filePath - Full path to the file (e.g., "src/agents/orchestrator.ts")
 * @param wikiPages - Wiki pages to search for mentions
 * @returns Coverage percentage (0, 25, 50, or 100)
 */
export function calculateGraduatedCoverage(filePath: string, wikiPages: WikiPageLike[]): number {
  const fileName = filePath.split('/').pop() ?? '';
  // Remove only the final extension for standard files
  // For files like foo.config.ts, we want "foo.config" not "foo"
  const fileNameWithoutExt = fileName.replace(/\.(?:ts|js|tsx|jsx|mjs|cjs)$/, '');
  // Handle camelCase to kebab-case conversion (e.g., baseAgent -> base-agent)
  const kebabName = fileNameWithoutExt.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  // Also create dot-to-kebab version (e.g., env.config -> env-config)
  const dotToKebab = fileNameWithoutExt.replace(/\./g, '-').toLowerCase();

  let highestCoverage = 0;

  for (const page of wikiPages) {
    const pageContent = page.content;
    const pageContentLower = pageContent.toLowerCase();
    const pagePath = page.path.toLowerCase();
    const fileNameLower = fileName.toLowerCase();
    const fileNameWithoutExtLower = fileNameWithoutExt.toLowerCase();

    // Check for 100% - dedicated wiki page about the file
    // Page path should end with or be exactly the file name (without extension)
    const pagePathSegments = pagePath.split('/');
    const lastSegment = pagePathSegments[pagePathSegments.length - 1] ?? '';

    const pathMatchesFile =
      lastSegment === fileNameWithoutExtLower ||
      lastSegment === kebabName ||
      lastSegment === dotToKebab;

    if (pathMatchesFile) {
      // Page path exactly matches the file name - this is strong evidence of a dedicated page.
      // We trust path matches because wiki pages are typically named after what they document.
      // Only reject if content explicitly mentions a DIFFERENT file with similar name.
      //
      // Check if content mentions a different but similar filename (e.g., auth-helper.ts vs auth.ts)
      const similarFilePattern = new RegExp(
        `${escapeRegex(fileNameWithoutExtLower)}-[a-z]+\\.(?:ts|js)`,
        'i'
      );
      const mentionsDifferentFile = similarFilePattern.test(pageContent) &&
        !pageContentLower.includes(fileNameLower);

      if (!mentionsDifferentFile) {
        return 100; // Early return - this is the highest tier
      }
    }

    // Check for 50% - has dedicated section (heading containing filename)
    // Look for markdown headings that mention the file
    const headingPattern = new RegExp(
      `^#{1,6}\\s+.*\\b${escapeRegex(fileNameWithoutExtLower)}\\b.*$`,
      'im'
    );
    if (headingPattern.test(pageContent.toLowerCase())) {
      highestCoverage = Math.max(highestCoverage, 50);
      continue; // Keep looking for potentially higher coverage
    }

    // Check for 50% - multiple mentions with context (3+ mentions)
    const mentionCount = countMentions(pageContentLower, fileNameLower, fileNameWithoutExtLower);
    if (mentionCount >= 3) {
      highestCoverage = Math.max(highestCoverage, 50);
      continue;
    }

    // Check for 25% - mentioned in passing (at least one mention)
    if (mentionCount >= 1) {
      highestCoverage = Math.max(highestCoverage, 25);
      continue;
    }

    // Check if full path is mentioned
    if (pageContentLower.includes(filePath.toLowerCase())) {
      highestCoverage = Math.max(highestCoverage, 25);
    }
  }

  return highestCoverage;
}

/**
 * Count how many times a filename appears in content.
 * Uses strict boundaries to avoid matching partial names like "auth" in "auth-helper".
 */
function countMentions(content: string, fileName: string, fileNameWithoutExt: string): number {
  // Count filename mentions (with extension)
  // For "executor.ts", match "executor.ts" but not "executors.ts" or "pre-executor.ts"
  const fileNameRegex = new RegExp(
    `(?<![a-zA-Z0-9_-])${escapeRegex(fileName)}(?![a-zA-Z0-9_-])`,
    'gi'
  );
  const fileNameMatches = content.match(fileNameRegex) || [];

  // Also count mentions of just the name without extension
  // For "executor", match "executor" but not "executor-helper" or "pre-executor"
  const nameOnlyRegex = new RegExp(
    `(?<![a-zA-Z0-9_-])${escapeRegex(fileNameWithoutExt)}(?![a-zA-Z0-9_-])`,
    'gi'
  );
  const nameOnlyMatches = content.match(nameOnlyRegex) || [];

  // Return the higher count (don't sum - they may overlap)
  return Math.max(fileNameMatches.length, nameOnlyMatches.length);
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count lines of code in file content.
 * Only counts non-empty lines.
 *
 * @param content - File content
 * @returns Number of non-empty lines
 */
export function countLinesOfCode(content: string): number {
  if (!content) return 0;
  return content.split('\n').filter(line => line.trim().length > 0).length;
}

// ============================================================================
// Tree Building
// ============================================================================

/**
 * Get all ancestor directories for a file path.
 *
 * @param filePath - Full path to file
 * @returns Array of ancestor directory paths
 */
export function getAncestors(filePath: string): string[] {
  const parts = filePath.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

/**
 * Create a file node from file data.
 */
export function createFileNode(
  path: string,
  loc: number,
  coveragePercent: number
): FileNode {
  const name = path.split('/').pop() ?? path;
  const score = calculatePriorityScore(coveragePercent, loc);
  return {
    type: 'file',
    name,
    path,
    loc,
    coveragePercent,
    score,
  };
}

/**
 * Create a directory node with calculated aggregates.
 */
export function createDirectoryNode(
  path: string,
  files: FileNode[] = [],
  children: DirectoryNode[] = []
): DirectoryNode {
  const name = path.split('/').pop() ?? path;

  // Calculate totals from files and children
  const directLoc = files.reduce((sum, f) => sum + f.loc, 0);
  const childLoc = children.reduce((sum, c) => sum + c.totalLoc, 0);
  const totalLoc = directLoc + childLoc;

  const directFileCount = files.length;
  const childFileCount = children.reduce((sum, c) => sum + c.totalFileCount, 0);
  const totalFileCount = directFileCount + childFileCount;

  // Coverage is weighted average by LOC
  const directCoverageSum = files.reduce((sum, f) => sum + f.coveragePercent * f.loc, 0);
  const childCoverageSum = children.reduce((sum, c) => sum + c.coveragePercent * c.totalLoc, 0);
  const coveragePercent = totalLoc > 0
    ? (directCoverageSum + childCoverageSum) / totalLoc
    : 0;

  return {
    type: 'directory',
    name,
    path,
    files,
    children,
    totalLoc,
    totalFileCount,
    coveragePercent,
  };
}

/**
 * Build a coverage tree from file data and wiki pages.
 *
 * @param files - Array of file data with paths and LOC
 * @param wikiPages - Wiki pages for coverage calculation
 * @returns Root directory node, or null if no files
 */
export function buildCoverageTreeWithFiles(
  files: FileData[],
  wikiPages: WikiPageLike[]
): DirectoryNode | null {
  if (files.length === 0) {
    return null;
  }

  // Build file nodes with coverage
  const fileNodes: FileNode[] = files.map(f =>
    createFileNode(f.path, f.loc, calculateFileCoverage(f.path, wikiPages))
  );

  // Group files by directory
  const dirMap = new Map<string, { files: FileNode[]; subdirs: Set<string> }>();

  for (const file of fileNodes) {
    const parts = file.path.split('/');
    // Build all ancestor directories
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (!dirMap.has(dirPath)) {
        dirMap.set(dirPath, { files: [], subdirs: new Set() });
      }
      // Track immediate child directory
      if (i < parts.length - 1) {
        const childDirPath = parts.slice(0, i + 1).join('/');
        dirMap.get(dirPath)!.subdirs.add(childDirPath);
      }
    }

    // Add file to its immediate parent directory
    const parentPath = parts.slice(0, -1).join('/');
    if (parentPath && dirMap.has(parentPath)) {
      dirMap.get(parentPath)!.files.push(file);
    }
  }

  // Find root directories (those not contained in another)
  const allDirs = Array.from(dirMap.keys());
  const rootDirs = allDirs.filter(dir => {
    const parent = dir.split('/').slice(0, -1).join('/');
    return !dirMap.has(parent);
  });

  // Build tree recursively
  function buildDirNode(path: string): DirectoryNode {
    const entry = dirMap.get(path);
    const files = entry?.files ?? [];
    const subdirPaths = entry?.subdirs ?? new Set<string>();

    const children = Array.from(subdirPaths).map(buildDirNode);

    return createDirectoryNode(path, files, children);
  }

  // If single root, return it; otherwise create a virtual root
  if (rootDirs.length === 1) {
    return buildDirNode(rootDirs[0]!);
  } else if (rootDirs.length > 1) {
    // Multiple roots - create containing structure
    const children = rootDirs.map(buildDirNode);
    return createDirectoryNode('.', [], children);
  }

  return null;
}

// ============================================================================
// Budget-Aware Truncation
// ============================================================================

/**
 * Truncate files to fit within a line budget.
 *
 * Each file costs 1 line.
 * Each directory costs 1 line.
 * Ancestor directories are included automatically.
 *
 * @param files - All files with their data
 * @param wikiPages - Wiki pages for coverage calculation
 * @param budget - Maximum lines to output
 * @returns Truncation result with selected files and directories
 */
export function truncateToBudget(
  files: Array<{ path: string; loc: number; coveragePercent: number }>,
  budget: number
): TruncationResult {
  // Score and sort files by priority (highest first)
  const scoredFiles: FileNode[] = files
    .map(f => createFileNode(f.path, f.loc, f.coveragePercent))
    .sort((a, b) => b.score - a.score);

  const selectedFiles: FileNode[] = [];
  const includedDirectories = new Set<string>();
  let linesUsed = 0;

  for (const file of scoredFiles) {
    // Calculate ancestors not yet included
    const ancestors = getAncestors(file.path);
    const newAncestors = ancestors.filter(a => !includedDirectories.has(a));

    // Cost = 1 (file) + new ancestors
    const cost = 1 + newAncestors.length;

    if (linesUsed + cost <= budget) {
      selectedFiles.push(file);
      for (const ancestor of newAncestors) {
        includedDirectories.add(ancestor);
      }
      linesUsed += cost;
    }
  }

  // Calculate hidden counts
  const allDirectories = new Set<string>();
  for (const file of files) {
    for (const ancestor of getAncestors(file.path)) {
      allDirectories.add(ancestor);
    }
  }

  const hiddenFileCount = files.length - selectedFiles.length;
  const hiddenDirCount = allDirectories.size - includedDirectories.size;

  // Effective threshold is coverage of last selected file (or 100 if none hidden)
  const effectiveThreshold = selectedFiles.length > 0 && hiddenFileCount > 0
    ? selectedFiles[selectedFiles.length - 1]!.coveragePercent
    : 100;

  return {
    files: selectedFiles,
    directories: Array.from(includedDirectories).sort(),
    totalLines: linesUsed,
    hiddenFileCount,
    hiddenDirCount,
    wasTruncated: hiddenFileCount > 0,
    effectiveThreshold,
  };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a coverage tree as ASCII text for LLM prompt.
 *
 * @param root - Root directory node
 * @param selectedFiles - Files selected by truncation
 * @param selectedDirs - Directory paths selected by truncation
 * @param truncationInfo - Info about hidden items
 * @returns Formatted ASCII tree string
 */
export function formatCoverageTreeWithFiles(
  root: DirectoryNode | null,
  selectedFiles: FileNode[],
  selectedDirs: string[],
  truncationInfo: TruncationInfo
): string {
  if (!root) {
    return '*No source directory found*';
  }

  const lines: string[] = [];
  const selectedDirSet = new Set(selectedDirs);

  // Build a map of files by directory for quick lookup
  const filesByDir = new Map<string, FileNode[]>();
  for (const file of selectedFiles) {
    const dirPath = file.path.split('/').slice(0, -1).join('/');
    if (!filesByDir.has(dirPath)) {
      filesByDir.set(dirPath, []);
    }
    filesByDir.get(dirPath)!.push(file);
  }

  function formatNode(
    node: DirectoryNode,
    prefix: string,
    isLast: boolean,
    isRoot: boolean
  ): void {
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const childPrefix = isRoot ? '' : (isLast ? '    ' : '│   ');

    // Format directory line
    const warning = node.coveragePercent < LOW_COVERAGE_THRESHOLD ? ' ⚠️' : '';
    const dirLine = `${prefix}${connector}${node.name}/ (${Math.round(node.coveragePercent)}%) - ${node.totalFileCount} files, ${node.totalLoc} loc${warning}`;
    lines.push(dirLine);

    // Get files for this directory
    const dirFiles = filesByDir.get(node.path) ?? [];
    // Sort files by coverage ascending (lowest first)
    dirFiles.sort((a, b) => a.coveragePercent - b.coveragePercent);

    // Get child directories that are selected
    const visibleChildren = node.children.filter(c => selectedDirSet.has(c.path));
    // Sort children by coverage ascending
    visibleChildren.sort((a, b) => a.coveragePercent - b.coveragePercent);

    const totalItems = dirFiles.length + visibleChildren.length;
    let itemIndex = 0;

    // Format files first
    for (const file of dirFiles) {
      itemIndex++;
      const isLastItem = itemIndex === totalItems;
      const fileConnector = isLastItem ? '└── ' : '├── ';
      const fileWarning = file.coveragePercent < LOW_COVERAGE_THRESHOLD ? ' ⚠️' : '';
      const fileLine = `${prefix}${childPrefix}${fileConnector}${file.name} (${Math.round(file.coveragePercent)}%) - ${file.loc} loc${fileWarning}`;
      lines.push(fileLine);
    }

    // Format child directories
    for (const child of visibleChildren) {
      itemIndex++;
      const isLastItem = itemIndex === totalItems;
      formatNode(child, prefix + childPrefix, isLastItem, false);
    }
  }

  formatNode(root, '', true, true);

  // Add truncation summary if needed
  if (truncationInfo.wasTruncated) {
    lines.push('');
    const parts: string[] = [];
    if (truncationInfo.hiddenFileCount > 0) {
      parts.push(`${truncationInfo.hiddenFileCount} files`);
    }
    if (truncationInfo.hiddenDirCount > 0) {
      parts.push(`${truncationInfo.hiddenDirCount} directories`);
    }
    if (truncationInfo.effectiveThreshold < 100) {
      lines.push(`Showing items with coverage ≤ ${truncationInfo.effectiveThreshold}% (${parts.join(', ')} hidden)`);
    } else {
      lines.push(`(${parts.join(', ')} hidden)`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * Build and format a prioritized coverage tree for LLM prompt.
 *
 * This is the main entry point for generating file-level coverage context.
 *
 * @param files - Array of file data with paths and content
 * @param wikiPages - Wiki pages for coverage calculation
 * @param budget - Maximum lines to output (default: 100)
 * @returns Formatted coverage tree string
 */
export function buildPrioritizedCoverageTree(
  files: FileData[],
  wikiPages: WikiPageLike[],
  budget: number = DEFAULT_LINE_BUDGET
): string {
  // Build the full tree
  const tree = buildCoverageTreeWithFiles(files, wikiPages);

  if (!tree) {
    return '*No source files found*';
  }

  // Collect all files with their coverage
  const allFiles: Array<{ path: string; loc: number; coveragePercent: number }> = [];

  function collectFiles(node: DirectoryNode): void {
    for (const file of node.files) {
      allFiles.push({
        path: file.path,
        loc: file.loc,
        coveragePercent: file.coveragePercent,
      });
    }
    for (const child of node.children) {
      collectFiles(child);
    }
  }
  collectFiles(tree);

  // Truncate to budget
  const truncation = truncateToBudget(allFiles, budget);

  // Format the result
  return formatCoverageTreeWithFiles(
    tree,
    truncation.files,
    truncation.directories,
    {
      hiddenFileCount: truncation.hiddenFileCount,
      hiddenDirCount: truncation.hiddenDirCount,
      effectiveThreshold: truncation.effectiveThreshold,
      wasTruncated: truncation.wasTruncated,
    }
  );
}

/**
 * Result of aggregate file documentation coverage calculation.
 */
export interface FileDocCoverageResult {
  /** Overall documentation coverage percentage (0-100), weighted by LOC */
  coveragePercent: number;
  /** Total number of source files analyzed */
  totalFiles: number;
  /** Number of files with any documentation (coverage > 0) */
  documentedFiles: number;
  /** Number of files with full documentation (coverage = 100) */
  fullyDocumentedFiles: number;
  /** Breakdown by coverage tier */
  byTier: {
    none: number;      // 0%
    mentioned: number; // 25%
    sectioned: number; // 50%
    dedicated: number; // 100%
  };
}

/**
 * Calculate aggregate file documentation coverage metrics.
 *
 * This provides an overall view of how well the wiki documents the codebase files.
 * Coverage is weighted by lines of code so larger files have more impact on the score.
 *
 * @param files - Array of file data with paths and LOC
 * @param wikiPages - Wiki pages to check for file mentions
 * @returns Aggregate coverage metrics
 */
export function calculateAggregateFileCoverage(
  files: FileData[],
  wikiPages: WikiPageLike[]
): FileDocCoverageResult {
  if (files.length === 0) {
    return {
      coveragePercent: 0,
      totalFiles: 0,
      documentedFiles: 0,
      fullyDocumentedFiles: 0,
      byTier: { none: 0, mentioned: 0, sectioned: 0, dedicated: 0 },
    };
  }

  let totalLoc = 0;
  let weightedCoverageSum = 0;
  let documentedFiles = 0;
  let fullyDocumentedFiles = 0;
  const byTier = { none: 0, mentioned: 0, sectioned: 0, dedicated: 0 };

  for (const file of files) {
    const coverage = calculateGraduatedCoverage(file.path, wikiPages);
    totalLoc += file.loc;
    weightedCoverageSum += coverage * file.loc;

    if (coverage > 0) {
      documentedFiles++;
    }
    if (coverage === 100) {
      fullyDocumentedFiles++;
    }

    // Categorize by tier
    if (coverage === 0) {
      byTier.none++;
    } else if (coverage === 25) {
      byTier.mentioned++;
    } else if (coverage === 50) {
      byTier.sectioned++;
    } else {
      byTier.dedicated++;
    }
  }

  const coveragePercent = totalLoc > 0 ? weightedCoverageSum / totalLoc : 0;

  return {
    coveragePercent,
    totalFiles: files.length,
    documentedFiles,
    fullyDocumentedFiles,
    byTier,
  };
}
