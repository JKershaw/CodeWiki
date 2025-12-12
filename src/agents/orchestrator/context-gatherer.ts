import type { Repositories } from '../../repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// Import file-level coverage tree
import {
  buildPrioritizedCoverageTree,
  calculateGraduatedCoverage,
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

  // File-level coverage tree - prioritized view with individual files
  fileCoverageTree: string | null;

  // Project overview content (truncated) for LLM context
  projectOverviewContent: string | null;

  // Pending edit requests (from analysis agents, awaiting wiki-editor)
  pendingEditRequests: number;
}

/**
 * Coverage threshold for considering a file "documented".
 * Files below this threshold need documentation.
 */
const FILE_COVERAGE_THRESHOLD = 50;

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

    // Key pages existence
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

    // Calculate undocumented directories using file-level coverage
    const undocumentedDirectories = await this.calculateUndocumentedDirectories(repoId, wikiPages);

    // Build file-level coverage tree
    const fileCoverageTree = await this.buildFileCoverageTree(repoId, wikiPages);

    // Fetch project overview content
    let projectOverviewContent: string | null = null;
    if (hasProjectOverview) {
      const overviewPaths = ['architecture/overview', 'overview'];
      for (const overviewPath of overviewPaths) {
        const overviewQuery = createGetWikiPageQuery(wikiId, overviewPath);
        const overviewResult = await handleGetWikiPage(overviewQuery, this.repos);
        if (overviewResult.success && overviewResult.data) {
          const content = overviewResult.data.content;
          const maxOverviewLength = 4000;
          if (content.length > maxOverviewLength) {
            projectOverviewContent = content.slice(0, maxOverviewLength) + '\n\n[... truncated ...]';
          } else {
            projectOverviewContent = content;
          }
          break;
        }
      }
    }

    return {
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
      undocumentedDirectories,
      fileCoverageTree,
      projectOverviewContent,
      pendingEditRequests,
    };
  }

  /**
   * Calculate which directories have undocumented files.
   * Uses file-level coverage (graduated coverage) instead of simple mention counting.
   */
  private async calculateUndocumentedDirectories(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<UndocumentedDirectory[]> {
    if (!this.repoAccessFactory) {
      return [];
    }

    try {
      const repoAccess = await this.repoAccessFactory.create(repoId);
      const allFiles = await repoAccess.getFileTree();
      const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

      if (sourceFiles.length === 0) {
        return [];
      }

      // Group files by directory and calculate coverage for each file
      const dirStats = new Map<string, { total: number; undocumented: number }>();

      for (const filePath of sourceFiles) {
        const parts = filePath.split('/');
        if (parts.length < 2) continue;

        const dirPath = parts.slice(0, -1).join('/');

        // Calculate file-level coverage using graduated coverage
        const coverage = calculateGraduatedCoverage(filePath, wikiPages);
        const isUndocumented = coverage < FILE_COVERAGE_THRESHOLD;

        if (!dirStats.has(dirPath)) {
          dirStats.set(dirPath, { total: 0, undocumented: 0 });
        }

        const stats = dirStats.get(dirPath)!;
        stats.total++;
        if (isUndocumented) {
          stats.undocumented++;
        }
      }

      // Convert to array and filter to directories with undocumented files
      const undocumentedDirs: UndocumentedDirectory[] = [];

      for (const [path, stats] of dirStats) {
        if (stats.undocumented > 0) {
          undocumentedDirs.push({
            path,
            totalFiles: stats.total,
            undocumentedCount: stats.undocumented,
            undocumentedRatio: stats.undocumented / stats.total,
          });
        }
      }

      // Sort by undocumented ratio (highest first), then by count
      undocumentedDirs.sort((a, b) => {
        if (a.undocumentedRatio !== b.undocumentedRatio) {
          return b.undocumentedRatio - a.undocumentedRatio;
        }
        return b.undocumentedCount - a.undocumentedCount;
      });

      return undocumentedDirs;
    } catch (error) {
      console.warn(`Failed to calculate undocumented directories: ${error}`);
      return [];
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

      return buildPrioritizedCoverageTree(fileData, wikiPages, 100);
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
