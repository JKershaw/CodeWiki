import * as fs from 'fs';
import * as path from 'path';
import type { Repositories } from '../../repositories/index.js';
import type { GitService } from '../../services/git/git-service.js';
import type { RepositoryServiceFactory, RepositoryService, FileEntry } from '../../services/repository/repository-service.js';
import type { Repo } from '../../domain/repo.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

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
 * Directory coverage information for the orchestrator.
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

  // Pending edit requests (from analysis agents, awaiting wiki-editor)
  pendingEditRequests: number;
}

/**
 * Gathers context about the current wiki state for orchestrator decisions.
 */
export class ContextGatherer {
  constructor(
    private readonly repos: Repositories,
    private readonly git?: GitService,
    private readonly repoServiceFactory?: RepositoryServiceFactory
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
    const hasProjectOverview = wikiPages.some(p =>
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
      shallowPages,
      pagesLackingExamples,
      hasProjectOverview,
      hasGettingStarted,
      hasTestingGuide,
      hasExtensionGuide,
      directoryCoverage,
      pendingEditRequests,
    };
  }

  /**
   * Calculate coverage of source directories in the wiki.
   * Scans the repository's src/ directory and checks how well each
   * subdirectory is documented in the wiki.
   *
   * Works with both local repositories (filesystem) and GitHub repositories (API).
   */
  private async calculateDirectoryCoverage(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryCoverage[]> {
    // Look up the repository to determine if it's local or GitHub
    const repo = await this.repos.repos.findById(repoId);
    if (!repo) {
      return [];
    }

    // For GitHub repos, use API-based approach
    if (repo.isGitHubRepo) {
      return this.calculateDirectoryCoverageViaApi(repo, wikiPages);
    }

    // For local repos, use filesystem-based approach
    return this.calculateDirectoryCoverageViaFilesystem(repoId, wikiPages);
  }

  /**
   * Calculate directory coverage using GitHub API.
   */
  private async calculateDirectoryCoverageViaApi(
    repo: Repo,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryCoverage[]> {
    if (!this.repoServiceFactory) {
      return [];
    }

    try {
      const repoService = this.repoServiceFactory.getService(repo);

      // Check if src directory exists
      let srcEntries: FileEntry[];
      try {
        srcEntries = await repoService.listDirectory(repo, 'src');
      } catch {
        // src directory doesn't exist - try root level instead
        return [];
      }

      const coverage: DirectoryCoverage[] = [];

      // Process directories under src/
      for (const entry of srcEntries) {
        if (entry.type !== 'dir') continue;

        const relativePath = `src/${entry.name}`;

        // Count source files in this directory via API
        const fileCount = await this.countSourceFilesViaApi(repoService, repo, relativePath);
        if (fileCount === 0) continue;

        // Check for wiki mentions
        const wikiMentions = this.countWikiMentions(entry.name, relativePath, wikiPages);

        // Calculate coverage percentage
        const coveragePercent = fileCount > 0
          ? Math.min(100, (wikiMentions / fileCount) * 100)
          : 0;

        coverage.push({
          path: relativePath,
          fileCount,
          wikiMentions,
          coveragePercent: Math.round(coveragePercent),
        });
      }

      // Sort by coverage (lowest first to highlight gaps)
      coverage.sort((a, b) => a.coveragePercent - b.coveragePercent);

      return coverage;
    } catch (error) {
      console.warn(`Failed to calculate directory coverage via API: ${error}`);
      return [];
    }
  }

  /**
   * Count source files in a directory using repository API.
   */
  private async countSourceFilesViaApi(
    repoService: RepositoryService,
    repo: Repo,
    dirPath: string
  ): Promise<number> {
    try {
      // Get all files in repo and filter to this directory
      const allFiles = await repoService.getFileTree(repo);
      const filesInDir = allFiles.filter(f =>
        f.startsWith(dirPath + '/') &&
        this.isSourceFile(f)
      );
      return filesInDir.length;
    } catch {
      return 0;
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
   * Calculate directory coverage using filesystem (for local repos).
   */
  private async calculateDirectoryCoverageViaFilesystem(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryCoverage[]> {
    if (!this.git) {
      return [];
    }

    // For local repos, get the filesystem path
    let repoPath: string;
    try {
      repoPath = this.git.getRepoPath(repoId);
    } catch {
      return [];
    }

    const srcPath = path.join(repoPath, 'src');

    // Check if src directory exists
    if (!fs.existsSync(srcPath)) {
      return [];
    }

    const coverage: DirectoryCoverage[] = [];

    // Scan first-level directories under src/
    const srcEntries = fs.readdirSync(srcPath, { withFileTypes: true });

    for (const entry of srcEntries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(srcPath, entry.name);
      const relativePath = `src/${entry.name}`;

      // Count source files recursively
      const fileCount = this.countSourceFiles(dirPath);
      if (fileCount === 0) continue;

      // Check for wiki mentions
      const wikiMentions = this.countWikiMentions(entry.name, relativePath, wikiPages);

      // Calculate coverage percentage
      const coveragePercent = fileCount > 0
        ? Math.min(100, (wikiMentions / fileCount) * 100)
        : 0;

      coverage.push({
        path: relativePath,
        fileCount,
        wikiMentions,
        coveragePercent: Math.round(coveragePercent),
      });
    }

    // Sort by coverage (lowest first to highlight gaps)
    coverage.sort((a, b) => a.coveragePercent - b.coveragePercent);

    return coverage;
  }

  /**
   * Count source files in a directory recursively.
   */
  private countSourceFiles(dirPath: string): number {
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and common non-source directories
        if (['node_modules', 'dist', 'build', '.git', '__pycache__'].includes(entry.name)) {
          continue;
        }
        count += this.countSourceFiles(fullPath);
      } else if (entry.isFile()) {
        // Count TypeScript and JavaScript files
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
          // Skip test files and declaration files
          if (!entry.name.includes('.test.') &&
              !entry.name.includes('.spec.') &&
              !entry.name.endsWith('.d.ts')) {
            count++;
          }
        }
      }
    }

    return count;
  }

  /**
   * Format context as a string for the LLM prompt.
   */
  formatForPrompt(ctx: OrchestratorContext): string {
    const lines: string[] = [];

    lines.push('## Current Wiki State\n');

    // Coverage
    lines.push(`**Commits:** ${ctx.totalCommits} total`);
    for (const [agent, counts] of Object.entries(ctx.commitsByAgent)) {
      const pct = ctx.totalCommits > 0
        ? ((counts.processed / ctx.totalCommits) * 100).toFixed(0)
        : '0';
      lines.push(`- ${agent}: ${counts.processed}/${ctx.totalCommits} (${pct}%) processed, ${counts.pending} pending`);
    }
    lines.push('');

    // Wiki pages
    lines.push(`**Wiki Pages:** ${ctx.wikiPages} total, avg confidence ${(ctx.avgConfidence * 100).toFixed(0)}%`);
    lines.push(`**Categories:** ${Object.entries(ctx.categoryCounts).map(([cat, count]) => `${cat}(${count})`).join(', ')}`);

    if (ctx.categoriesWithoutOverview.length > 0) {
      lines.push(`**Categories needing overview:** ${ctx.categoriesWithoutOverview.join(', ')}`);
    }

    lines.push(`**Pages needing rewrite:** ${ctx.pagesNeedingRewrite}`);
    lines.push(`**Has project overview (architecture/overview):** ${ctx.hasProjectOverview ? 'YES' : 'NO'}`);
    lines.push(`**Has getting started (guides/getting-started):** ${ctx.hasGettingStarted ? 'YES' : 'NO'}`);
    lines.push(`**Has testing guide (guides/testing):** ${ctx.hasTestingGuide ? 'YES' : 'NO'}`);
    lines.push(`**Has extension guide (guides/extension-patterns):** ${ctx.hasExtensionGuide ? 'YES' : 'NO'}`);
    lines.push(`**Pages without links:** ${ctx.pagesWithoutLinks}`);
    lines.push(`**Low confidence pages:** ${ctx.lowConfidencePages}`);
    lines.push(`**Shallow pages (< 500 chars):** ${ctx.shallowPages}`);
    lines.push(`**Pages without code examples:** ${ctx.pagesLackingExamples}`);
    if (ctx.pendingEditRequests > 0) {
      lines.push(`**⚠️ Pending edit requests:** ${ctx.pendingEditRequests} (run wiki-editor agent!)`);
    }
    lines.push('');

    // Recent commits (show full ID so LLM can reference them exactly)
    lines.push('**Recent commits (most recent first):**');
    for (const commit of ctx.recentCommits.slice(0, 10)) {
      const processed = commit.processedBy.length > 0
        ? commit.processedBy.join(', ')
        : 'none';
      lines.push(`- ${commit.id}: "${commit.message.slice(0, 50)}${commit.message.length > 50 ? '...' : ''}" [processed by: ${processed}]`);
    }
    lines.push('');

    // Recent agent runs
    lines.push('**Last 5 agent runs:**');
    for (const run of ctx.recentRuns.slice(0, 5)) {
      const status = run.success ? 'success' : 'failed';
      lines.push(`- ${run.agentType}: ${status}, ${run.pagesAffected} pages affected`);
    }
    lines.push('');

    // Note: Directory coverage is NOT sent to the LLM prompt.
    // Codebase exploration is handled deterministically by codebaseExplorationStrategy,
    // so including it in the LLM prompt would be noise (the LLM can't act on it).
    // The directoryCoverage data is still gathered and used by the deterministic strategy.

    return lines.join('\n');
  }
}

/**
 * Create a context gatherer instance.
 */
export function createContextGatherer(
  repos: Repositories,
  git?: GitService,
  repoServiceFactory?: RepositoryServiceFactory
): ContextGatherer {
  return new ContextGatherer(repos, git, repoServiceFactory);
}
