import type { Repositories } from '../../repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// Import smart coverage filtering
import { filterCoverageItems } from './smart-coverage-filter.js';

// Import CQRS queries
import {
  createListCommitsQuery,
  handleListCommits,
  createListWikiPagesQuery,
  handleListWikiPages,
  createGetWikiPageQuery,
  handleGetWikiPage,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createCountPendingEditRequestsQuery,
  handleCountPendingEditRequests,
} from '../../queries/index.js';

/**
 * Iteration progress information for the orchestrator.
 * Enables phase-aware prioritization during a processing run.
 */
export interface IterationInfo {
  /** Current iteration number (1-indexed) */
  currentIteration: number;
  /** Total iterations requested for this run */
  totalIterations: number;
  /** Remaining iterations in this run */
  remainingIterations: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
}

/**
 * Phase of the processing run based on progress percentage.
 * - early (0-30%): Focus on exploration, breadth-first coverage
 * - mid (30-70%): Balance exploration with synthesis and linking
 * - late (70-100%): Focus on quality, polish, and filling gaps
 */
export type IterationPhase = 'early' | 'mid' | 'late';

/**
 * Options for gathering orchestrator context.
 */
export interface GatherOptions {
  /** Optional iteration info for phase-aware prioritization */
  iterationInfo?: IterationInfo;
}

/**
 * Directory coverage information for the orchestrator (flat format for strategies).
 */
export interface DirectoryCoverage {
  /** Relative path from repo root (e.g., "src/services/llm") */
  path: string;
  /** Number of source files in this directory */
  fileCount: number;
  /** Number of wiki mentions of this directory or its files */
  wikiMentions: number;
  /** Coverage percentage (wikiMentions / fileCount * 100) */
  coveragePercent: number;
}

/**
 * Tree node for deep directory coverage visualization.
 * Used to show the LLM a hierarchical view of coverage.
 */
export interface DirectoryNode {
  /** Directory name (e.g., "llm") */
  name: string;
  /** Full path from repo root (e.g., "src/services/llm") */
  path: string;
  /** Number of source files directly in this directory (not recursive) */
  fileCount: number;
  /** Total source files including all subdirectories */
  totalFileCount: number;
  /** Coverage percentage for this directory and its contents */
  coveragePercent: number;
  /** Child directories */
  children: DirectoryNode[];
}

/**
 * Snapshot of wiki state for orchestrator decision-making.
 */
export interface OrchestratorContext {
  // Coverage
  totalCommits: number;
  commitsByAgent: Record<string, { processed: number; pending: number }>;
  recentCommits: Array<{
    id: string;
    message: string;
    date: Date;
    processedBy: AgentType[];
  }>;

  // Wiki State
  wikiPages: number;
  categoryCounts: Record<string, number>;
  categoriesWithOverview: string[];
  categoriesWithoutOverview: string[];
  pagesNeedingRewrite: number;
  avgConfidence: number;
  lowConfidencePages: number;

  // Recent Activity
  recentRuns: Array<{
    agentType: AgentType;
    success: boolean;
    pagesAffected: number;
    timestamp: Date;
  }>;

  // Quality Indicators
  pagesWithoutLinks: number;

  // Depth Indicators (heuristic-based)
  /** Pages with < 500 chars content (excluding overview/index pages) */
  shallowPages: number;
  /** Pages without fenced code blocks (excluding overview/index pages) */
  pagesLackingExamples: number;

  // Key pages existence
  hasProjectOverview: boolean;
  hasGettingStarted: boolean;
  hasTestingGuide: boolean;
  hasExtensionGuide: boolean;

  // Directory coverage - which parts of the codebase are documented
  directoryCoverage: DirectoryCoverage[];

  // Directory coverage tree - deep hierarchical view for LLM prompt
  coverageTree: DirectoryNode | null;

  // Project overview content (truncated) for LLM context
  projectOverviewContent: string | null;

  // Pending edit requests (from analysis agents, awaiting wiki-editor)
  pendingEditRequests: number;

  // Iteration progress (optional - only present during a processing run)
  iterationInfo?: IterationInfo;

  // Iteration phase derived from progressPercent (only present when iterationInfo is provided)
  iterationPhase?: IterationPhase;
}

/**
 * Gathers context about the current wiki state for orchestrator decisions.
 */
export class ContextGatherer {
  constructor(
    private readonly repos: Repositories,
    private readonly repoAccessFactory?: UnifiedRepoAccessFactory
  ) {}

  /**
   * Derive iteration phase from progress percentage.
   */
  private getIterationPhase(progressPercent: number): IterationPhase {
    if (progressPercent < 30) return 'early';
    if (progressPercent < 70) return 'mid';
    return 'late';
  }

  /**
   * Gather a complete snapshot of the wiki state.
   */
  async gather(repoId: string, wikiId: string, options?: GatherOptions): Promise<OrchestratorContext> {
    // Fetch all the data we need via CQRS queries
    const commitsQuery = createListCommitsQuery(repoId, { limit: 100 });
    const pagesQuery = createListWikiPagesQuery(wikiId);
    const runsQuery = createListAgentRunsQuery(repoId);
    const pendingEditsQuery = createCountPendingEditRequestsQuery(wikiId);

    const [
      commitsResult,
      pagesResult,
      runsResult,
      pendingEditsResult,
    ] = await Promise.all([
      handleListCommits(commitsQuery, this.repos),
      handleListWikiPages(pagesQuery, this.repos),
      handleListAgentRuns(runsQuery, this.repos),
      handleCountPendingEditRequests(pendingEditsQuery, this.repos),
    ]);

    const commits = commitsResult.data || [];
    const wikiPages = pagesResult.data || [];
    const agentRuns = runsResult.data || [];
    const pendingEditRequests = pendingEditsResult.data || 0;

    // Calculate commits by agent
    const commitsByAgent: Record<string, { processed: number; pending: number }> = {};
    for (const agentType of ANALYSIS_AGENTS) {
      const processed = commits.filter(c =>
        c.processedBy.some(p => p.agentType === agentType)
      ).length;
      commitsByAgent[agentType] = {
        processed,
        pending: commits.length - processed,
      };
    }

    // Recent commits with their processing status
    // Use sha (Git hash) instead of id (internal UUID) for the orchestrator
    const recentCommits = commits
      .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
      .slice(0, 10)
      .map(c => ({
        id: c.sha,
        message: c.message,
        date: c.committedAt,
        processedBy: c.processedBy.map(p => p.agentType) as AgentType[],
      }));

    // Category analysis
    const categoryCounts: Record<string, number> = {};
    const categoriesWithOverview: string[] = [];
    const skipCategories = ['commits'];

    for (const page of wikiPages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;

      if (page.path.endsWith('/overview') || page.path.endsWith('/index')) {
        if (!categoriesWithOverview.includes(category)) {
          categoriesWithOverview.push(category);
        }
      }
    }

    const categoriesWithoutOverview = Object.keys(categoryCounts)
      .filter(cat => !skipCategories.includes(cat))
      .filter(cat => (categoryCounts[cat] ?? 0) >= 3)
      .filter(cat => !categoriesWithOverview.includes(cat));

    // Pages needing rewrite (have "This commit..." style)
    const commitIndicators = [
      'this commit ', 'this change ', 'this patch ',
      'this adds ', 'this modifies ', 'this introduces ',
      'commit adds', 'commit modifies',
    ];

    const pagesNeedingRewrite = wikiPages.filter(page => {
      const category = page.path.split('/')[0] ?? '';
      if (['commits', 'security'].includes(category)) return false;
      if (page.path.endsWith('/overview') || page.path.endsWith('/index')) return false;

      const firstPara = page.content.split('\n\n')[1] ?? '';
      return commitIndicators.some(ind => firstPara.toLowerCase().includes(ind));
    }).length;

    // Confidence
    const avgConfidence = wikiPages.length > 0
      ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
      : 0;

    const lowConfidencePages = wikiPages.filter(p => p.confidence < 0.5).length;

    // Recent agent runs
    const recentRuns = agentRuns
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 20)
      .map(r => ({
        agentType: r.agentType,
        success: r.status === 'completed',
        pagesAffected: r.requestedUpdates.length,
        timestamp: r.startedAt,
      }));

    // Pages without links
    const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0).length;

    // Depth metrics (heuristic-based)
    // Shallow pages: content < 500 chars, excluding overview/index pages
    const shallowPages = wikiPages.filter(p => {
      if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
      return p.content.length < 500;
    }).length;

    // Pages lacking examples: no fenced code blocks, excluding overview/index pages
    const pagesLackingExamples = wikiPages.filter(p => {
      if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
      return !p.content.includes('```');
    }).length;

    // Key pages existence
    // Check for project overview in either location:
    // - 'overview' (created by bootstrap agent on empty wikis)
    // - 'architecture/overview' (created by project-overview agent on 10+ page wikis)
    const hasProjectOverview = wikiPages.some(p =>
      p.path === 'overview' ||
      p.path === 'architecture/overview' ||
      p.path === 'architecture/index'
    );
    const hasGettingStarted = wikiPages.some(p =>
      p.path === 'guides/getting-started' ||
      p.path === 'guides/quickstart' ||
      p.path === 'guides/index'
    );
    const hasTestingGuide = wikiPages.some(p =>
      p.path === 'guides/testing' ||
      p.path === 'guides/tests' ||
      p.path === 'guides/testing-guide'
    );
    const hasExtensionGuide = wikiPages.some(p =>
      p.path === 'guides/extension-patterns' ||
      p.path === 'guides/extending' ||
      p.path === 'guides/adding-features' ||
      p.path === 'guides/patterns'
    );

    // Calculate directory coverage (which parts of the codebase are documented)
    const directoryCoverage = await this.calculateDirectoryCoverage(repoId, wikiPages);

    // Build deep coverage tree for LLM prompt
    const coverageTree = await this.buildCoverageTree(repoId, wikiPages);

    // Fetch project overview content (if exists)
    // Try multiple paths in order of preference:
    // 1. 'architecture/overview' (project-overview agent, more comprehensive)
    // 2. 'overview' (bootstrap agent, basic starter)
    let projectOverviewContent: string | null = null;
    if (hasProjectOverview) {
      const overviewPaths = ['architecture/overview', 'overview'];
      for (const overviewPath of overviewPaths) {
        const overviewQuery = createGetWikiPageQuery(wikiId, overviewPath);
        const overviewResult = await handleGetWikiPage(overviewQuery, this.repos);
        if (overviewResult.success && overviewResult.data) {
          const content = overviewResult.data.content;
          // Truncate to ~4000 chars for LLM context (increased from 2000 to preserve more architectural context)
          const maxOverviewLength = 4000;
          if (content.length > maxOverviewLength) {
            projectOverviewContent = content.slice(0, maxOverviewLength) + '\n\n[... truncated ...]';
          } else {
            projectOverviewContent = content;
          }
          break; // Found one, stop looking
        }
      }
    }

    // Build result with optional iteration info
    const result: OrchestratorContext = {
      totalCommits: commits.length,
      commitsByAgent,
      recentCommits,
      wikiPages: wikiPages.length,
      categoryCounts,
      categoriesWithOverview,
      categoriesWithoutOverview,
      pagesNeedingRewrite,
      avgConfidence,
      lowConfidencePages,
      recentRuns,
      pagesWithoutLinks,
      shallowPages,
      pagesLackingExamples,
      hasProjectOverview,
      hasGettingStarted,
      hasTestingGuide,
      hasExtensionGuide,
      directoryCoverage,
      coverageTree,
      projectOverviewContent,
      pendingEditRequests,
    };

    // Add iteration info if provided
    if (options?.iterationInfo) {
      result.iterationInfo = options.iterationInfo;
      result.iterationPhase = this.getIterationPhase(options.iterationInfo.progressPercent);
    }

    return result;
  }

  /**
   * Calculate coverage of source directories in the wiki.
   * Scans the repository for source files and checks how well each
   * directory is documented in the wiki.
   *
   * Uses UnifiedRepoAccess to work uniformly with both local and GitHub repositories.
   */
  private async calculateDirectoryCoverage(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryCoverage[]> {
    if (!this.repoAccessFactory) {
      return [];
    }

    try {
      // Get unified access for this repository
      const repoAccess = await this.repoAccessFactory.create(repoId);

      // Get all files via unified interface
      const allFiles = await repoAccess.getFileTree();

      // Filter to source files only (any directory)
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        return [];
      }

      // Extract second-level directories and count files
      // e.g., src/agents/foo.ts -> src/agents, lib/utils/bar.ts -> lib/utils
      const dirCounts = new Map<string, number>();
      for (const filePath of sourceFiles) {
        const parts = filePath.split('/');
        // Only count files that are at least 2 levels deep (e.g., dir/subdir/file.ts)
        if (parts.length >= 3) {
          const dirPath = `${parts[0]}/${parts[1]}`;
          dirCounts.set(dirPath, (dirCounts.get(dirPath) ?? 0) + 1);
        }
      }

      if (dirCounts.size === 0) {
        return [];
      }

      // Build coverage array
      const coverage: DirectoryCoverage[] = [];
      for (const [dirPath, fileCount] of dirCounts) {
        const dirName = dirPath.split('/')[1]!;

        // Check for wiki mentions
        const wikiMentions = this.countWikiMentions(dirName, dirPath, wikiPages);

        // Calculate coverage percentage
        const coveragePercent = fileCount > 0
          ? Math.min(100, (wikiMentions / fileCount) * 100)
          : 0;

        coverage.push({
          path: dirPath,
          fileCount,
          wikiMentions,
          coveragePercent: Math.round(coveragePercent),
        });
      }

      // Sort by coverage (lowest first to highlight gaps)
      coverage.sort((a, b) => a.coveragePercent - b.coveragePercent);

      return coverage;
    } catch (error) {
      console.warn(`Failed to calculate directory coverage: ${error}`);
      return [];
    }
  }

  /**
   * Check if a file path is a source code file.
   */
  private isSourceFile(filePath: string): boolean {
    // Only TypeScript and JavaScript files
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.js')) {
      return false;
    }
    // Skip test files and declaration files
    if (filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.endsWith('.d.ts')) {
      return false;
    }
    // Skip common non-source directories
    const skipDirs = ['node_modules', 'dist', 'build', '__pycache__'];
    if (skipDirs.some(dir => filePath.includes(`/${dir}/`))) {
      return false;
    }
    return true;
  }

  /**
   * Count wiki mentions for a directory.
   */
  private countWikiMentions(
    dirName: string,
    relativePath: string,
    wikiPages: Array<{ path: string; content: string }>
  ): number {
    const searchTerms = [
      dirName.toLowerCase(),
      relativePath.toLowerCase(),
      relativePath.replace(/\//g, '-').toLowerCase(),
    ];

    let wikiMentions = 0;
    for (const term of searchTerms) {
      const mentionCount = wikiPages.filter(p =>
        p.content.toLowerCase().includes(term) ||
        p.path.toLowerCase().includes(term)
      ).length;
      wikiMentions = Math.max(wikiMentions, mentionCount);
    }
    return wikiMentions;
  }

  /**
   * Build a deep coverage tree for LLM visualization.
   * Returns a hierarchical view of all directories with coverage data.
   *
   * Uses UnifiedRepoAccess to work uniformly with both local and GitHub repositories.
   */
  private async buildCoverageTree(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryNode | null> {
    if (!this.repoAccessFactory) {
      console.warn(`buildCoverageTree: repoAccessFactory not available`);
      return null;
    }

    try {
      // Get unified access for this repository
      const repoAccess = await this.repoAccessFactory.create(repoId);

      // Get all files via unified interface
      const allFiles = await repoAccess.getFileTree();

      if (allFiles.length === 0) {
        console.warn(`buildCoverageTree: getFileTree returned empty for ${repoId}`);
        return null;
      }

      // Filter to source files only (any directory, not just src/)
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        console.warn(`buildCoverageTree: no source files found in ${allFiles.length} files for ${repoId}`);
        return null;
      }

      // Find the predominant top-level directory to use as root
      const topLevelCounts = new Map<string, number>();
      for (const filePath of sourceFiles) {
        const parts = filePath.split('/');
        if (parts.length >= 2) {
          const topLevel = parts[0]!;
          topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) ?? 0) + 1);
        }
      }

      if (topLevelCounts.size === 0) {
        return null;
      }

      // Use the top-level directory with the most files as root
      const rootDir = Array.from(topLevelCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]![0];

      // Filter to files in this root directory
      const rootFiles = sourceFiles.filter(f => f.startsWith(`${rootDir}/`));

      // Build tree from file paths
      return this.buildTreeFromPaths(rootFiles, wikiPages, rootDir);
    } catch (error) {
      console.warn(`Failed to build coverage tree: ${error}`);
      return null;
    }
  }

  /**
   * Build a directory tree from a list of file paths.
   */
  private buildTreeFromPaths(
    filePaths: string[],
    wikiPages: Array<{ path: string; content: string }>,
    rootDir: string = 'src'
  ): DirectoryNode {
    // Build intermediate structure
    interface BuildNode {
      name: string;
      path: string;
      fileCount: number;
      children: Map<string, BuildNode>;
    }

    const root: BuildNode = { name: rootDir, path: rootDir, fileCount: 0, children: new Map() };

    for (const filePath of filePaths) {
      const parts = filePath.split('/');
      let current = root;

      // Navigate/create directories (skip last part which is the file)
      for (let i = 1; i < parts.length - 1; i++) {
        const part = parts[i]!;
        const currentPath = parts.slice(0, i + 1).join('/');

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: currentPath,
            fileCount: 0,
            children: new Map(),
          });
        }
        current = current.children.get(part)!;
      }

      // Count file in its direct parent
      current.fileCount++;
    }

    // Convert BuildNode to DirectoryNode with coverage
    const convertNode = (node: BuildNode): DirectoryNode => {
      const children = Array.from(node.children.values())
        .map(convertNode)
        .filter(c => c.totalFileCount > 0)
        .sort((a, b) => b.totalFileCount - a.totalFileCount);

      const totalFileCount = node.fileCount + children.reduce((sum, c) => sum + c.totalFileCount, 0);
      const wikiMentions = this.countWikiMentions(node.name, node.path, wikiPages);
      const coveragePercent = totalFileCount > 0
        ? Math.min(100, Math.round((wikiMentions / totalFileCount) * 100))
        : 0;

      return {
        name: node.name,
        path: node.path,
        fileCount: node.fileCount,
        totalFileCount,
        coveragePercent,
        children,
      };
    };

    return convertNode(root);
  }

  /**
   * Format coverage tree as a visual tree string for LLM prompt.
   *
   * Uses smart filtering to prioritize low-coverage directories:
   * 1. Flattens tree to collect all directory nodes
   * 2. Filters using coveragePercent (lowest first, up to maxLines)
   * 3. Formats only filtered nodes while preserving tree structure
   *
   * This ensures undocumented areas are always visible regardless of repo size.
   */
  formatCoverageTree(tree: DirectoryNode | null, maxLines: number = 100): string {
    if (!tree) {
      return '*No source directory found*';
    }

    // Step 1: Flatten tree to get all nodes with their coverage
    const allNodes: DirectoryNode[] = [];
    const flattenTree = (node: DirectoryNode): void => {
      allNodes.push(node);
      for (const child of node.children) {
        flattenTree(child);
      }
    };
    flattenTree(tree);

    // Step 2: Apply smart filtering - prioritize lowest coverage
    const filterResult = filterCoverageItems(allNodes, { targetCount: maxLines });

    // Step 3: Build set of paths to include (filtered nodes + their ancestors)
    const includedPaths = new Set<string>();
    for (const node of filterResult.items) {
      // Add the node's path
      includedPaths.add(node.path);
      // Add all ancestor paths to maintain tree structure
      const parts = node.path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        includedPaths.add(parts.slice(0, i).join('/'));
      }
    }

    // Step 4: Format tree, only showing included paths
    const lines: string[] = [];

    // Use effective threshold for marking low coverage (or 50% if all included)
    const lowCoverageThreshold = filterResult.truncated
      ? filterResult.effectiveThreshold
      : 50;

    const formatNode = (node: DirectoryNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
      const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
      const coverageMarker = node.coveragePercent < lowCoverageThreshold ? ' ⚠️' : '';
      const line = `${prefix}${connector}${node.name}/ (${node.coveragePercent}%) - ${node.totalFileCount} files${coverageMarker}`;
      lines.push(line);

      // Prepare prefix for children
      const childPrefix = isRoot ? '' : (prefix + (isLast ? '    ' : '│   '));

      // Filter children to only included paths, sort by coverage ascending
      const includedChildren = node.children
        .filter(child => includedPaths.has(child.path))
        .sort((a, b) => a.coveragePercent - b.coveragePercent);

      // Process children
      for (let i = 0; i < includedChildren.length; i++) {
        const child = includedChildren[i]!;
        const childIsLast = i === includedChildren.length - 1;
        formatNode(child, childPrefix, childIsLast, false);
      }
    };

    formatNode(tree, '', true, true);

    // Add summary line showing filtering info
    if (filterResult.truncated) {
      lines.push(`[Showing ${filterResult.items.length} directories with coverage ≤${filterResult.effectiveThreshold}% | ${filterResult.truncatedCount} higher-coverage directories hidden]`);
    }

    return lines.join('\n');
  }

  /**
   * Format context as a string for the LLM prompt.
   *
   * Order prioritizes existing code understanding over historical commits:
   * 1. Immediate actions (pending edits)
   * 2. Project context (what are we documenting?)
   * 3. Codebase structure (what code exists?)
   * 4. Wiki state (what's documented?)
   * 5. Quality gaps (what needs improvement?)
   * 6. Recent activity (what work was done?)
   * 7. Historical context (commits for enrichment)
   */
  formatForPrompt(ctx: OrchestratorContext): string {
    const lines: string[] = [];

    // 0. ITERATION PROGRESS - helps with phase-aware prioritization
    if (ctx.iterationInfo) {
      lines.push('## Iteration Progress\n');
      lines.push(`**Progress:** ${ctx.iterationInfo.currentIteration} of ${ctx.iterationInfo.totalIterations} (${ctx.iterationInfo.progressPercent}%), ${ctx.iterationInfo.remainingIterations} remaining`);
      lines.push(`**Phase:** ${ctx.iterationPhase}`);

      // Phase-specific guidance
      if (ctx.iterationPhase === 'early') {
        lines.push('**Priority:** Focus on exploration and breadth-first coverage. Document undocumented areas aggressively.');
      } else if (ctx.iterationPhase === 'mid') {
        lines.push('**Priority:** Balance exploration with synthesis. Create overview pages and cross-references.');
      } else {
        lines.push('**Priority:** Focus on quality and polish. Fill gaps, improve low-confidence pages, ensure consistency.');
      }
      lines.push('');
    }

    // 1. IMMEDIATE ACTIONS - must be addressed first
    if (ctx.pendingEditRequests > 0) {
      lines.push('## ⚠️ Immediate Action Required\n');
      lines.push(`**Pending edit requests:** ${ctx.pendingEditRequests} - run wiki-editor agent FIRST!`);
      lines.push('');
    }

    // 2. PROJECT CONTEXT - understand what we're documenting
    if (ctx.projectOverviewContent) {
      lines.push('## Project Overview\n');
      lines.push(ctx.projectOverviewContent);
      lines.push('');
    }

    // 3. CODEBASE STRUCTURE - what code exists and what's covered
    lines.push('## Codebase Structure\n');
    lines.push('Directories marked with ⚠️ have low coverage. Target these with `codebase-explorer`.\n');
    lines.push(this.formatCoverageTree(ctx.coverageTree, 100));
    lines.push('');

    // 4. WIKI STATE - what's already documented
    lines.push('## Wiki State\n');
    lines.push(`**Pages:** ${ctx.wikiPages} total, avg confidence ${(ctx.avgConfidence * 100).toFixed(0)}%`);

    // Categories with overview status inline
    const categoryInfo = Object.entries(ctx.categoryCounts)
      .map(([cat, count]) => `${cat}(${count})`)
      .join(', ');
    lines.push(`**Categories:** ${categoryInfo}`);
    if (ctx.categoriesWithoutOverview.length > 0) {
      lines.push(`**Categories needing overview:** ${ctx.categoriesWithoutOverview.join(', ')}`);
    }

    // Key pages consolidated into single line showing what's missing
    const missingKeyPages: string[] = [];
    if (!ctx.hasProjectOverview) missingKeyPages.push('project-overview');
    if (!ctx.hasGettingStarted) missingKeyPages.push('getting-started');
    if (!ctx.hasTestingGuide) missingKeyPages.push('testing-guide');
    if (!ctx.hasExtensionGuide) missingKeyPages.push('extension-guide');
    if (missingKeyPages.length > 0) {
      lines.push(`**Missing key pages:** ${missingKeyPages.join(', ')}`);
    } else {
      lines.push('**Key pages:** all present ✓');
    }
    lines.push('');

    // 5. QUALITY GAPS - grouped together for clear prioritization
    lines.push('## Quality Gaps\n');
    const qualityIssues: string[] = [];
    if (ctx.shallowPages > 0) qualityIssues.push(`${ctx.shallowPages} shallow (< 500 chars)`);
    if (ctx.pagesLackingExamples > 0) qualityIssues.push(`${ctx.pagesLackingExamples} without code examples`);
    if (ctx.pagesWithoutLinks > 0) qualityIssues.push(`${ctx.pagesWithoutLinks} without links`);
    if (ctx.lowConfidencePages > 0) qualityIssues.push(`${ctx.lowConfidencePages} low confidence`);
    if (ctx.pagesNeedingRewrite > 0) qualityIssues.push(`${ctx.pagesNeedingRewrite} need rewrite (commit-style)`);

    if (qualityIssues.length > 0) {
      lines.push(`**Issues:** ${qualityIssues.join(', ')}`);
    } else {
      lines.push('**Issues:** none ✓');
    }
    lines.push('');

    // 6. RECENT ACTIVITY - what work was done recently
    lines.push('## Recent Activity\n');
    if (ctx.recentRuns.length > 0) {
      for (const run of ctx.recentRuns.slice(0, 5)) {
        const status = run.success ? '✓' : '✗';
        lines.push(`- ${run.agentType}: ${status} ${run.pagesAffected} pages`);
      }
    } else {
      lines.push('No recent agent runs.');
    }
    lines.push('');

    // 7. HISTORICAL CONTEXT - commits for enrichment (last priority)
    lines.push('## Historical Context\n');
    lines.push(`**Commits:** ${ctx.totalCommits} total`);
    for (const [agent, counts] of Object.entries(ctx.commitsByAgent)) {
      const pct = ctx.totalCommits > 0
        ? ((counts.processed / ctx.totalCommits) * 100).toFixed(0)
        : '0';
      lines.push(`- ${agent}: ${pct}% processed (${counts.pending} pending)`);
    }
    lines.push('');

    // Recent commits (show full ID so LLM can reference them exactly)
    if (ctx.recentCommits.length > 0) {
      lines.push('**Recent commits:**');
      for (const commit of ctx.recentCommits.slice(0, 10)) {
        const processed = commit.processedBy.length > 0
          ? `[${commit.processedBy.join(', ')}]`
          : '[unprocessed]';
        const msg = commit.message.length > 50
          ? commit.message.slice(0, 50) + '...'
          : commit.message;
        lines.push(`- ${commit.id}: "${msg}" ${processed}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Create a context gatherer instance.
 */
export function createContextGatherer(
  repos: Repositories,
  repoAccessFactory?: UnifiedRepoAccessFactory
): ContextGatherer {
  return new ContextGatherer(repos, repoAccessFactory);
}
