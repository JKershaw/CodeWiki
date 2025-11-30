import * as fs from 'fs';
import * as path from 'path';
import type { Repositories } from '../../repositories/index.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { GitService } from '../../services/git/git-service.js';

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
 * Analysis agents that process commits.
 */
const ANALYSIS_AGENTS: AgentType[] = [
  'code-change',
  'narrative',
  'security',
  'pattern',
  'dependency',
];

/**
 * Gathers context about the current wiki state for orchestrator decisions.
 */
export class ContextGatherer {
  constructor(
    private readonly repos: Repositories,
    private readonly git?: GitService
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
   */
  private async calculateDirectoryCoverage(
    repoId: string,
    wikiPages: Array<{ path: string; content: string }>
  ): Promise<DirectoryCoverage[]> {
    // If we don't have git service, return empty coverage
    if (!this.git) {
      return [];
    }

    const repoPath = this.git.getRepoPath(repoId);
    const srcPath = path.join(repoPath, 'src');

    // Check if src directory exists
    if (!fs.existsSync(srcPath)) {
      return [];
    }

    // Combine all wiki content for searching
    const allWikiContent = wikiPages.map(p => p.content).join('\n').toLowerCase();
    const allWikiPaths = wikiPages.map(p => p.path.toLowerCase()).join('\n');

    const coverage: DirectoryCoverage[] = [];

    // Scan first-level directories under src/
    const srcEntries = fs.readdirSync(srcPath, { withFileTypes: true });

    for (const entry of srcEntries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(srcPath, entry.name);
      const relativePath = `src/${entry.name}`;

      // Count source files recursively (only .ts, .js files)
      const fileCount = this.countSourceFiles(dirPath);
      if (fileCount === 0) continue;

      // Check for wiki mentions of this directory
      // Look for: directory name, path references, and file names from this dir
      const searchTerms = [
        entry.name.toLowerCase(),
        relativePath.toLowerCase(),
        relativePath.replace(/\//g, '-').toLowerCase(),
      ];

      // Count distinct mentions
      let wikiMentions = 0;
      for (const term of searchTerms) {
        // Count pages that mention this term
        const mentionCount = wikiPages.filter(p =>
          p.content.toLowerCase().includes(term) ||
          p.path.toLowerCase().includes(term)
        ).length;
        wikiMentions = Math.max(wikiMentions, mentionCount);
      }

      // Calculate coverage percentage
      // Use min(wikiMentions, fileCount) to cap at 100%
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

    // Directory coverage (which parts of the codebase are documented)
    if (ctx.directoryCoverage.length > 0) {
      lines.push('## Directory Coverage (Source Code Documentation)\n');
      lines.push('Shows how well each source directory is documented in the wiki:');
      lines.push('');

      // Find directories with very low coverage (candidates for codebase-explorer)
      const lowCoverageDirs = ctx.directoryCoverage.filter(d => d.coveragePercent < 20);
      const mediumCoverageDirs = ctx.directoryCoverage.filter(d => d.coveragePercent >= 20 && d.coveragePercent < 50);
      const goodCoverageDirs = ctx.directoryCoverage.filter(d => d.coveragePercent >= 50);

      if (lowCoverageDirs.length > 0) {
        lines.push('**⚠️ UNDOCUMENTED (< 20% coverage) - use codebase-explorer:**');
        for (const dir of lowCoverageDirs) {
          lines.push(`- ${dir.path}: ${dir.coveragePercent}% (${dir.fileCount} files, ${dir.wikiMentions} wiki mentions)`);
        }
        lines.push('');
      }

      if (mediumCoverageDirs.length > 0) {
        lines.push('**Partially documented (20-50% coverage):**');
        for (const dir of mediumCoverageDirs) {
          lines.push(`- ${dir.path}: ${dir.coveragePercent}% (${dir.fileCount} files, ${dir.wikiMentions} wiki mentions)`);
        }
        lines.push('');
      }

      if (goodCoverageDirs.length > 0) {
        lines.push('**Well documented (50%+ coverage):**');
        for (const dir of goodCoverageDirs) {
          lines.push(`- ${dir.path}: ${dir.coveragePercent}% (${dir.fileCount} files, ${dir.wikiMentions} wiki mentions)`);
        }
      }
    }

    return lines.join('\n');
  }
}

/**
 * Create a context gatherer instance.
 */
export function createContextGatherer(repos: Repositories, git?: GitService): ContextGatherer {
  return new ContextGatherer(repos, git);
}
