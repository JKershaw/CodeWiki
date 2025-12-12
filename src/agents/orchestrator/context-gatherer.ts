import type { Repositories } from '../../repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// Import file-level coverage tree
import {
  buildPrioritizedCoverageTree,
  type FileData,
} from './file-coverage-tree.js';

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
  /** Page paths without any links */
  pagesWithoutLinksList: string[];

  // Depth Indicators (heuristic-based)
  /** Pages with < 500 chars content (excluding overview/index pages) */
  shallowPages: number;
  /** Page paths that are shallow */
  shallowPagesList: string[];
  /** Pages without fenced code blocks (excluding overview/index pages) */
  pagesLackingExamples: number;
  /** Page paths lacking code examples */
  pagesLackingExamplesList: string[];

  // Key pages existence
  hasProjectOverview: boolean;
  hasGettingStarted: boolean;
  hasTestingGuide: boolean;
  hasExtensionGuide: boolean;

  // Directory coverage - which parts of the codebase are documented
  directoryCoverage: DirectoryCoverage[];

  // File-level coverage tree - prioritized view with individual files
  fileCoverageTree: string | null;

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
    const pagesWithoutLinksList = wikiPages
      .filter(p => p.links.length === 0)
      .map(p => p.path);
    const pagesWithoutLinks = pagesWithoutLinksList.length;

    // Depth metrics (heuristic-based)
    // Shallow pages: content < 500 chars, excluding overview/index pages
    const shallowPagesList = wikiPages
      .filter(p => {
        if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
        return p.content.length < 500;
      })
      .map(p => p.path);
    const shallowPages = shallowPagesList.length;

    // Pages lacking examples: no fenced code blocks, excluding overview/index pages
    const pagesLackingExamplesList = wikiPages
      .filter(p => {
        if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
        return !p.content.includes('```');
      })
      .map(p => p.path);
    const pagesLackingExamples = pagesLackingExamplesList.length;

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

    // Build file-level coverage tree (prioritized view with individual files)
    const fileCoverageTree = await this.buildFileCoverageTree(repoId, wikiPages);

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
      pagesWithoutLinksList,
      shallowPages,
      shallowPagesList,
      pagesLackingExamples,
      pagesLackingExamplesList,
      hasProjectOverview,
      hasGettingStarted,
      hasTestingGuide,
      hasExtensionGuide,
      directoryCoverage,
      fileCoverageTree,
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

      // Extract directories at ALL levels and count files
      // Each file is counted toward its immediate parent directory only
      // e.g., src/agents/orchestrator/strategies.ts -> src/agents/orchestrator
      //       src/agents/base-agent.ts -> src/agents
      const dirCounts = new Map<string, number>();
      for (const filePath of sourceFiles) {
        const parts = filePath.split('/');
        // Only count files that are at least 2 levels deep (e.g., dir/subdir/file.ts)
        if (parts.length >= 3) {
          // Get the immediate parent directory (all parts except the filename)
          const dirPath = parts.slice(0, -1).join('/');
          dirCounts.set(dirPath, (dirCounts.get(dirPath) ?? 0) + 1);
        }
      }

      if (dirCounts.size === 0) {
        return [];
      }

      // Build coverage array
      const coverage: DirectoryCoverage[] = [];
      for (const [dirPath, fileCount] of dirCounts) {
        // Get the last part of the directory path for wiki mention search
        const dirName = dirPath.split('/').pop()!;

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

      // Sort by coverage (lowest first), then by depth (deeper first for same coverage)
      coverage.sort((a, b) => {
        if (a.coveragePercent !== b.coveragePercent) {
          return a.coveragePercent - b.coveragePercent;
        }
        // For same coverage, prefer deeper directories (more specific targeting)
        return b.path.split('/').length - a.path.split('/').length;
      });

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
   * Build a file-level coverage tree with prioritized output.
   *
   * Uses the new file-coverage-tree module for file-level detail,
   * priority scoring, and budget-aware truncation.
   *
   * @param repoId - Repository ID
   * @param wikiPages - Wiki pages for coverage calculation
   * @returns Formatted coverage tree string, or null if unavailable
   */
  private async buildFileCoverageTree(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<string | null> {
    if (!this.repoAccessFactory) {
      return null;
    }

    try {
      const repoAccess = await this.repoAccessFactory.create(repoId);
      const allFiles = await repoAccess.getFileTree();

      // Filter to source files only
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        return null;
      }

      // Convert to FileData format
      // Use estimated LOC based on file type (fetching actual content would be expensive)
      // TypeScript/JavaScript files average ~50-100 LOC, use 75 as default
      const DEFAULT_LOC = 75;
      const fileData: FileData[] = sourceFiles.map(path => ({
        path,
        loc: DEFAULT_LOC,
      }));

      // Use the new prioritized coverage tree builder
      return buildPrioritizedCoverageTree(fileData, wikiPages, 100);
    } catch (error) {
      console.warn(`Failed to build file coverage tree: ${error}`);
      return null;
    }
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
    lines.push('Files marked with ⚠️ have low coverage. Target these with `codebase-explorer`.\n');
    lines.push(ctx.fileCoverageTree ?? '*No source files found*');
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

    // 5. QUALITY GAPS - grouped together for clear prioritization with specific pages
    lines.push('## Quality Gaps\n');

    // Helper to format a list of pages with truncation
    const formatPageList = (pages: string[], maxShow: number = 5): string => {
      if (pages.length === 0) return '';
      if (pages.length <= maxShow) return pages.join(', ');
      return pages.slice(0, maxShow).join(', ') + ` (+${pages.length - maxShow} more)`;
    };

    const hasIssues = ctx.shallowPages > 0 || ctx.pagesLackingExamples > 0 ||
      ctx.pagesWithoutLinks > 0 || ctx.lowConfidencePages > 0 || ctx.pagesNeedingRewrite > 0;

    if (hasIssues) {
      if (ctx.shallowPages > 0) {
        lines.push(`**Shallow pages (< 500 chars):** ${formatPageList(ctx.shallowPagesList)}`);
      }
      if (ctx.pagesLackingExamples > 0) {
        lines.push(`**Without code examples:** ${formatPageList(ctx.pagesLackingExamplesList)}`);
      }
      if (ctx.pagesWithoutLinks > 0) {
        lines.push(`**Without links:** ${formatPageList(ctx.pagesWithoutLinksList)}`);
      }
      if (ctx.lowConfidencePages > 0) {
        lines.push(`**Low confidence:** ${ctx.lowConfidencePages} pages`);
      }
      if (ctx.pagesNeedingRewrite > 0) {
        lines.push(`**Need rewrite (commit-style):** ${ctx.pagesNeedingRewrite} pages`);
      }
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
