import type { Repositories } from '../../repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// Import file-level coverage tree
import {
  buildPrioritizedCoverageTree,
  calculateFileCoverage,
  LOW_COVERAGE_THRESHOLD,
  type FileData,
} from './file-coverage-tree.js';

// Import CQRS queries
import {
  createListCommitsQuery,
  handleListCommits,
  createListWikiPagesQuery,
  handleListWikiPages,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createCountPendingEditRequestsQuery,
  handleCountPendingEditRequests,
} from '../../queries/index.js';

/**
 * Directory with undocumented files, for exploration targeting.
 * Uses file-level coverage to determine what's actually documented.
 */
export interface UndocumentedDirectory {
  /** Relative path from repo root */
  path: string;
  /** Total files in this directory */
  totalFiles: number;
  /** Number of files with < 50% coverage */
  undocumentedCount: number;
  /** Ratio of undocumented files (0-1) */
  undocumentedRatio: number;
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
  pagesWithoutLinksList: string[];

  // Depth Indicators
  shallowPages: number;
  shallowPagesList: string[];
  pagesLackingExamples: number;
  pagesLackingExamplesList: string[];

  // Key pages existence
  hasProjectOverview: boolean;
  hasGettingStarted: boolean;
  hasTestingGuide: boolean;
  hasExtensionGuide: boolean;

  // Undocumented directories - for exploration strategy
  // Uses file-level coverage to identify directories needing documentation
  undocumentedDirectories: UndocumentedDirectory[];

  // Individual files with low coverage (< 50%), for coverage-aware file selection
  // Sorted by coverage ascending (0% first), then by path length
  lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }>;

  // File-level coverage tree - prioritized view with individual files
  fileCoverageTree: string | null;

  // Project overview content (truncated) for LLM context
  projectOverviewContent: string | null;

  // Pending edit requests (from analysis agents, awaiting wiki-editor)
  pendingEditRequests: number;
}

/**
 * Wiki page with file tracking fields for coverage calculation.
 */
export interface WikiPageWithFileTracking {
  path: string;
  content: string;
  filesAccessed?: string[];
  filesReferenced?: string[];
  targetPaths?: string[];
}

/**
 * Build a set of covered files from wiki page tracking data.
 *
 * This function collects all files that have been:
 * - Read by agents (filesAccessed)
 * - Referenced in content (filesReferenced)
 * - Targeted by work items (targetPaths)
 *
 * Using this approach instead of text-based mention matching ensures:
 * - Progress is guaranteed (once read, always covered)
 * - No stall at intermediate coverage levels
 * - Coverage aligns with KPI calculation
 *
 * @param wikiPages - Wiki pages with file tracking fields
 * @returns Set of covered file paths
 */
export function buildCoveredFilesSet(
  wikiPages: WikiPageWithFileTracking[]
): Set<string> {
  const covered = new Set<string>();

  for (const page of wikiPages) {
    // Add files accessed by agents
    if (page.filesAccessed) {
      for (const file of page.filesAccessed) {
        covered.add(file);
      }
    }

    // Add files referenced in content
    if (page.filesReferenced) {
      for (const file of page.filesReferenced) {
        covered.add(file);
      }
    }

    // Add target paths (files or directories)
    if (page.targetPaths) {
      for (const path of page.targetPaths) {
        covered.add(path);
      }
    }
  }

  return covered;
}

/**
 * Build documentation depth scores for files based on wiki page content.
 *
 * For each file, calculates a score based on how much documentation references it:
 *   score(file) = Σ content.length / filesReferenced.length
 *
 * This gives finer granularity than binary coverage:
 * - Files with dedicated pages get higher scores
 * - Files mentioned in overview pages get lower scores (diluted by other files)
 * - Two files are unlikely to have exactly the same score
 *
 * Path Resolution:
 * - When LLMs generate documentation, they often use bare filenames (e.g., `export-wiki.ts`)
 *   instead of full paths (e.g., `scripts/export-wiki.ts`).
 * - If a page has targetPaths (the directory being documented), we use it to resolve
 *   bare filenames to full paths.
 * - This ensures coverage calculation matches documented files to source files.
 *
 * @param wikiPages - Wiki pages with file tracking fields
 * @returns Map of file path to documentation depth score
 */
export function buildFileDocumentationScores(
  wikiPages: WikiPageWithFileTracking[]
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const page of wikiPages) {
    // Skip pages with no content
    if (!page.content || page.content.length === 0) {
      continue;
    }

    const filesReferenced = page.filesReferenced ?? [];
    const filesAccessed = page.filesAccessed ?? [];

    // Use filesReferenced if available, otherwise fall back to filesAccessed
    // This addresses the Phase 2 stall bug: when prose fallback is used,
    // filesReferenced extraction often fails, but filesAccessed still tracks
    // which files were actually read by the agent.
    const filesToScore = filesReferenced.length > 0 ? filesReferenced : filesAccessed;

    if (filesToScore.length === 0) {
      continue;
    }

    // Get the target directory for resolving bare filenames
    const targetDir = page.targetPaths?.[0];

    // Score per file = content length / number of files
    const scorePerFile = page.content.length / filesToScore.length;

    for (const file of filesToScore) {
      // Resolve bare filenames using targetPaths
      const resolvedFile = resolveFilePath(file, targetDir);
      const currentScore = scores.get(resolvedFile) ?? 0;
      scores.set(resolvedFile, currentScore + scorePerFile);
    }
  }

  return scores;
}

/**
 * Resolve a file path, prefixing bare filenames with a target directory.
 *
 * A bare filename is one that doesn't contain a path separator '/'.
 * If the file already has a path (contains '/'), it's returned as-is.
 *
 * @param file - The file path to resolve
 * @param targetDir - Optional target directory to use as prefix
 * @returns Resolved file path
 */
function resolveFilePath(file: string, targetDir?: string): string {
  // If file already has a path separator, it's already qualified
  if (file.includes('/')) {
    return file;
  }

  // If we have a target directory and file is a bare filename, prefix it
  if (targetDir) {
    // Remove trailing slash from targetDir if present
    const cleanTargetDir = targetDir.endsWith('/') ? targetDir.slice(0, -1) : targetDir;
    return `${cleanTargetDir}/${file}`;
  }

  // No target directory available, return bare filename as-is
  return file;
}

/**
 * Sort undocumented directories for consistent, deterministic ordering.
 *
 * This function ensures that directories with the same undocumented ratio
 * are always sorted in the same order (alphabetically by path). Without
 * deterministic sorting, the orchestrator may select different directories
 * on each iteration, causing the "round-robin" problem where no single
 * directory gets completed before others are started.
 *
 * @param dirs - Array of undocumented directories to sort
 * @returns New sorted array (original is not modified)
 */
export function sortUndocumentedDirectories(
  dirs: UndocumentedDirectory[]
): UndocumentedDirectory[] {
  return [...dirs].sort((a, b) => {
    // Primary sort: by undocumented ratio descending (highest ratio = lowest coverage first)
    if (a.undocumentedRatio !== b.undocumentedRatio) {
      return b.undocumentedRatio - a.undocumentedRatio;
    }
    // Secondary sort: alphabetically by path (deterministic tie-breaker)
    return a.path.localeCompare(b.path);
  });
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
   * Gather a complete snapshot of the wiki state.
   */
  async gather(repoId: string, wikiId: string): Promise<OrchestratorContext> {
    // Fetch all the data we need via CQRS queries
    // Only fetch recent commits for display - use counts for stats
    const commitsQuery = createListCommitsQuery(repoId, { limit: 20 });
    const pagesQuery = createListWikiPagesQuery(wikiId);
    const runsQuery = createListAgentRunsQuery(repoId);
    const pendingEditsQuery = createCountPendingEditRequestsQuery(wikiId);

    const [
      commitsResult,
      pagesResult,
      runsResult,
      pendingEditsResult,
      totalCommits,
    ] = await Promise.all([
      handleListCommits(commitsQuery, this.repos),
      handleListWikiPages(pagesQuery, this.repos),
      handleListAgentRuns(runsQuery, this.repos),
      handleCountPendingEditRequests(pendingEditsQuery, this.repos),
      this.repos.commits.countByRepo(repoId),
    ]);

    const commits = commitsResult.data || [];
    const wikiPages = pagesResult.data || [];
    const agentRuns = runsResult.data || [];
    const pendingEditRequests = pendingEditsResult.data || 0;

    // Calculate commits by agent using database counts (accurate for all commits)
    const commitsByAgent: Record<string, { processed: number; pending: number }> = {};
    const agentCountPromises = ANALYSIS_AGENTS.map(async (agentType) => {
      const processed = await this.repos.commits.countProcessedByAgent(repoId, agentType);
      return { agentType, processed };
    });
    const agentCounts = await Promise.all(agentCountPromises);
    for (const { agentType, processed } of agentCounts) {
      commitsByAgent[agentType] = {
        processed,
        pending: totalCommits - processed,
      };
    }

    // Recent commits with their processing status
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

    // Shallow pages: content < 500 chars, excluding overview/index pages
    const shallowPagesList = wikiPages
      .filter(p => {
        if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
        return p.content.length < 500;
      })
      .map(p => p.path);
    const shallowPages = shallowPagesList.length;

    // Pages lacking examples: no fenced code blocks
    const pagesLackingExamplesList = wikiPages
      .filter(p => {
        if (p.path.endsWith('/overview') || p.path.endsWith('/index')) return false;
        return !p.content.includes('```');
      })
      .map(p => p.path);
    const pagesLackingExamples = pagesLackingExamplesList.length;

    // Key pages existence - check synthesisType to avoid collision with category overviews
    // The synthesisType field distinguishes actual synthesis-generated guide pages from
    // regular exploration pages that happen to have similar paths (e.g., category overviews
    // created at architecture/overview vs the ProjectOverviewAgent's synthesis page)
    const hasProjectOverview = wikiPages.some(p => p.synthesisType === 'project-overview');
    const hasGettingStarted = wikiPages.some(p => p.synthesisType === 'getting-started');
    const hasTestingGuide = wikiPages.some(p => p.synthesisType === 'testing-guide');
    const hasExtensionGuide = wikiPages.some(p => p.synthesisType === 'extension-guide');

    // Calculate undocumented directories and low-coverage files using file-level coverage
    const { directories: undocumentedDirectories, files: lowCoverageFiles } =
      await this.calculateUndocumentedDirectoriesAndFiles(repoId, wikiPages);

    // Build file-level coverage tree
    const fileCoverageTree = await this.buildFileCoverageTree(repoId, wikiPages);

    // Fetch project overview content - find by synthesisType
    let projectOverviewContent: string | null = null;
    if (hasProjectOverview) {
      const overviewPage = wikiPages.find(p => p.synthesisType === 'project-overview');
      if (overviewPage) {
        const content = overviewPage.content;
        const maxOverviewLength = 4000;
        if (content.length > maxOverviewLength) {
          projectOverviewContent = content.slice(0, maxOverviewLength) + '\n\n[... truncated ...]';
        } else {
          projectOverviewContent = content;
        }
      }
    }

    return {
      totalCommits,
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
      undocumentedDirectories,
      lowCoverageFiles,
      fileCoverageTree,
      projectOverviewContent,
      pendingEditRequests,
    };
  }

  /**
   * Calculate which directories have low-coverage files, and collect individual low-coverage files.
   * Uses graduated documentation depth scoring instead of binary coverage.
   *
   * This approach ensures:
   * - Files with partial documentation are prioritized for more work
   * - Coverage percentages match what the LLM sees in the coverage tree
   * - Work generation targets files that truly need more documentation
   *
   * Returns both:
   * - directories: Aggregated stats per directory
   * - files: Individual files with coverage < LOW_COVERAGE_THRESHOLD
   */
  private async calculateUndocumentedDirectoriesAndFiles(
    repoId: string,
    wikiPages: WikiPageWithFileTracking[]
  ): Promise<{
    directories: UndocumentedDirectory[];
    files: Array<{ path: string; coverage: number; directory: string }>;
  }> {
    if (!this.repoAccessFactory) {
      return { directories: [], files: [] };
    }

    try {
      const repoAccess = await this.repoAccessFactory.create(repoId);
      const allFiles = await repoAccess.getFileTree();
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        return { directories: [], files: [] };
      }

      // Build documentation depth scores for graduated coverage
      // This uses the same scoring as the coverage tree shown to the LLM
      const documentationScores = buildFileDocumentationScores(wikiPages);

      // Find max score for normalization
      let maxScore = 0;
      for (const score of documentationScores.values()) {
        if (score > maxScore) maxScore = score;
      }

      // Group files by directory and calculate coverage for each file
      const dirStats = new Map<string, { total: number; lowCoverage: number }>();
      const lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }> = [];

      for (const filePath of sourceFiles) {
        const parts = filePath.split('/');
        if (parts.length < 2) continue;

        const dirPath = parts.slice(0, -1).join('/');

        // Graduated coverage using documentation depth scoring
        const coverage = calculateFileCoverage(filePath, documentationScores, maxScore);
        const isLowCoverage = coverage < LOW_COVERAGE_THRESHOLD;

        if (!dirStats.has(dirPath)) {
          dirStats.set(dirPath, { total: 0, lowCoverage: 0 });
        }

        const stats = dirStats.get(dirPath)!;
        stats.total++;
        if (isLowCoverage) {
          stats.lowCoverage++;
          // Collect low-coverage files
          lowCoverageFiles.push({ path: filePath, coverage, directory: dirPath });
        }
      }

      // Convert to array and filter to directories with low-coverage files
      const undocumentedDirs: UndocumentedDirectory[] = [];

      for (const [path, stats] of dirStats) {
        if (stats.lowCoverage > 0) {
          undocumentedDirs.push({
            path,
            totalFiles: stats.total,
            undocumentedCount: stats.lowCoverage,
            undocumentedRatio: stats.lowCoverage / stats.total,
          });
        }
      }

      // Sort directories deterministically using the exported function
      const sortedDirs = sortUndocumentedDirectories(undocumentedDirs);

      // Sort files by coverage (0% first), then by path length (shorter = more core)
      lowCoverageFiles.sort((a, b) => {
        if (a.coverage !== b.coverage) {
          return a.coverage - b.coverage;
        }
        return a.path.length - b.path.length;
      });

      return { directories: sortedDirs, files: lowCoverageFiles };
    } catch (error) {
      console.warn(`Failed to calculate undocumented directories: ${error}`);
      return { directories: [], files: [] };
    }
  }

  /**
   * Check if a file path is a source code file.
   */
  private isSourceFile(filePath: string): boolean {
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.js')) {
      return false;
    }
    if (filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.endsWith('.d.ts')) {
      return false;
    }
    const skipDirs = ['node_modules', 'dist', 'build', '__pycache__'];
    if (skipDirs.some(dir => filePath.includes(`/${dir}/`))) {
      return false;
    }
    return true;
  }

  /**
   * Build a file-level coverage tree with prioritized output.
   *
   * Uses tracked file relationships (filesAccessed, filesReferenced, targetPaths)
   * for coverage instead of text-based content matching. This ensures coverage
   * updates correctly when files are documented.
   */
  private async buildFileCoverageTree(
    repoId: string,
    wikiPages: WikiPageWithFileTracking[]
  ): Promise<string | null> {
    if (!this.repoAccessFactory) {
      return null;
    }

    try {
      const repoAccess = await this.repoAccessFactory.create(repoId);
      const allFiles = await repoAccess.getFileTree();
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        return null;
      }

      // Use estimated LOC (fetching actual content would be expensive)
      const DEFAULT_LOC = 75;
      const fileData: FileData[] = sourceFiles.map(path => ({
        path,
        loc: DEFAULT_LOC,
      }));

      // Build documentation scores for finer-grained coverage
      const documentationScores = buildFileDocumentationScores(wikiPages);

      return buildPrioritizedCoverageTree(fileData, documentationScores, 100);
    } catch (error) {
      console.warn(`Failed to build file coverage tree: ${error}`);
      return null;
    }
  }

  /**
   * Format context as a string for the LLM prompt.
   */
  formatForPrompt(ctx: OrchestratorContext): string {
    const lines: string[] = [];

    // 1. IMMEDIATE ACTIONS
    if (ctx.pendingEditRequests > 0) {
      lines.push('## Immediate Action Required\n');
      lines.push(`**Pending edit requests:** ${ctx.pendingEditRequests} - run wiki-editor agent FIRST!`);
      lines.push('');
    }

    // 2. PROJECT CONTEXT
    if (ctx.projectOverviewContent) {
      lines.push('## Project Overview\n');
      lines.push(ctx.projectOverviewContent);
      lines.push('');
    }

    // 3. CODEBASE STRUCTURE
    lines.push('## Codebase Structure\n');
    lines.push('Files marked with ⚠️ have low coverage. Target these with `codebase-explorer`.\n');
    lines.push(ctx.fileCoverageTree ?? '*No source files found*');
    lines.push('');

    // 4. UNDOCUMENTED DIRECTORIES (for exploration targeting)
    if (ctx.undocumentedDirectories.length > 0) {
      lines.push('## Directories Needing Documentation\n');
      const topDirs = ctx.undocumentedDirectories.slice(0, 10);
      for (const dir of topDirs) {
        const pct = Math.round(dir.undocumentedRatio * 100);
        lines.push(`- ${dir.path}: ${dir.undocumentedCount}/${dir.totalFiles} files undocumented (${pct}%)`);
      }
      if (ctx.undocumentedDirectories.length > 10) {
        lines.push(`... and ${ctx.undocumentedDirectories.length - 10} more directories`);
      }
      lines.push('');
    }

    // 5. WIKI STATE
    lines.push('## Wiki State\n');
    lines.push(`**Pages:** ${ctx.wikiPages} total, avg confidence ${(ctx.avgConfidence * 100).toFixed(0)}%`);

    const categoryInfo = Object.entries(ctx.categoryCounts)
      .map(([cat, count]) => `${cat}(${count})`)
      .join(', ');
    lines.push(`**Categories:** ${categoryInfo}`);
    if (ctx.categoriesWithoutOverview.length > 0) {
      lines.push(`**Categories needing overview:** ${ctx.categoriesWithoutOverview.join(', ')}`);
    }

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

    // 6. QUALITY GAPS
    lines.push('## Quality Gaps\n');

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

    // 7. RECENT ACTIVITY
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

    // 8. HISTORICAL CONTEXT (commits)
    lines.push('## Historical Context\n');
    lines.push(`**Commits:** ${ctx.totalCommits} total`);
    for (const [agent, counts] of Object.entries(ctx.commitsByAgent)) {
      const pct = ctx.totalCommits > 0
        ? ((counts.processed / ctx.totalCommits) * 100).toFixed(0)
        : '0';
      lines.push(`- ${agent}: ${pct}% processed (${counts.pending} pending)`);
    }
    lines.push('');

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
