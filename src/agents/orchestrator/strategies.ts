/**
 * Deterministic work generation strategies for the Orchestrator.
 *
 * Each strategy is responsible for identifying a specific type of work that
 * needs to be done and creating the appropriate work items.
 *
 * Strategy: "Useful Wiki First"
 * - Document the CURRENT codebase before analyzing commit history
 * - Explore until files are actually documented, not until page count is high
 * - The wiki is "done" when files are documented, not when page count is high
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import { createWorkItem, type WorkItem } from '../../domain/work-item.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import type { AgentRun } from '../../domain/agent-run.js';
import type { OrchestratorContext } from './context-gatherer.js';

// Import CQRS queries
import {
  createListWikiPagesQuery,
  handleListWikiPages,
  createListWorkItemsQuery,
  handleListWorkItems,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createListUnprocessedCommitsQuery,
  handleListUnprocessedCommits,
  createListOpenFindingsQuery,
  handleListOpenFindings,
} from '../../queries/index.js';

// Agent type definitions
import {
  ANALYSIS_AGENTS,
} from '../../agents/registry.js';

/**
 * Context passed to all strategies.
 */
export interface StrategyContext {
  repos: Repositories;
  repoId: string;
  wikiId: string;
  existingWorkKeys: Set<string>;
  contextGatherer?: { gather: (repoId: string, wikiId: string) => Promise<OrchestratorContext> };
}

/**
 * Result from a strategy execution.
 */
export interface StrategyResult {
  workItems: WorkItem[];
  stopProcessing?: boolean;  // If true, don't run more strategies
}

/**
 * Strategy function type.
 */
export type Strategy = (
  ctx: StrategyContext,
  remainingSlots: number
) => Promise<StrategyResult>;

/**
 * Coverage threshold for considering a file "documented".
 * Files with coverage below this are considered undocumented.
 * Using 50% means files need at least a dedicated section or multiple mentions.
 */
const FILE_COVERAGE_THRESHOLD = 50;

/**
 * Maximum directories to explore per orchestration run.
 * Keeps work batches manageable while ensuring progress.
 */
const MAX_DIRECTORIES_PER_RUN = 5;

/**
 * Strategy 1: Codebase exploration.
 * Document undocumented code before commit analysis to establish current state.
 *
 * Simplified approach:
 * - Uses file-level coverage (not directory mentions) to determine what's documented
 * - Explores directories where >50% of files have <50% coverage
 * - No page-count-based throttling - explore until files are actually documented
 */
export const codebaseExplorationStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0 || !ctx.contextGatherer) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];
  const context = await ctx.contextGatherer.gather(ctx.repoId, ctx.wikiId);

  // Use the undocumented directories from context (calculated using file-level coverage)
  const undocumentedDirs = context.undocumentedDirectories || [];

  // Sort by priority: more undocumented files first, then by path depth (deeper = more specific)
  const sortedDirs = [...undocumentedDirs].sort((a, b) => {
    // First by undocumented ratio (higher first)
    if (a.undocumentedRatio !== b.undocumentedRatio) {
      return b.undocumentedRatio - a.undocumentedRatio;
    }
    // Then by absolute count of undocumented files (more first)
    if (a.undocumentedCount !== b.undocumentedCount) {
      return b.undocumentedCount - a.undocumentedCount;
    }
    // Then by depth (deeper first for more specific targeting)
    return b.path.split('/').length - a.path.split('/').length;
  });

  // Take top directories up to limit
  const dirsToExplore = sortedDirs.slice(0, Math.min(MAX_DIRECTORIES_PER_RUN, remainingSlots));

  for (const dir of dirsToExplore) {
    if (workItems.length >= remainingSlots) break;

    const key = `codebase-explorer:path:${dir.path}`;
    if (ctx.existingWorkKeys.has(key)) continue;

    ctx.existingWorkKeys.add(key);
    workItems.push(
      createWorkItem({
        id: uuid(),
        repoId: ctx.repoId,
        agentType: 'codebase-explorer',
        target: { type: 'path', path: dir.path },
      })
    );
  }

  return { workItems };
};

/**
 * Strategy 2: Process unprocessed commits with all analysis agents.
 * Work items are processed in FIFO order - recent commits naturally come first
 * since they're discovered first.
 */
export const commitAnalysisStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  const workItems: WorkItem[] = [];

  for (const agentType of ANALYSIS_AGENTS) {
    if (workItems.length >= remainingSlots) break;

    // Find unprocessed commits
    const unprocessedQuery = createListUnprocessedCommitsQuery(ctx.repoId, agentType);
    const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, ctx.repos);
    const unprocessedCommits = unprocessedResult.data || [];

    // Sort by date - recent commits first
    unprocessedCommits.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());

    for (const commit of unprocessedCommits) {
      if (workItems.length >= remainingSlots) break;

      const key = `${agentType}:commit:${commit.sha}`;
      if (ctx.existingWorkKeys.has(key)) continue;

      ctx.existingWorkKeys.add(key);

      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType,
          target: { type: 'commit', commitId: commit.sha },
        })
      );
    }
  }

  return { workItems };
};

/**
 * Strategy 3: Meta agents (quality, linking, structure).
 *
 * Meta agents run based on the orchestrator's strategy ordering.
 * The FIFO queue ensures all work items created in a batch complete
 * before new work is generated.
 */
export const metaAgentsStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  // Get wiki pages
  const pagesQuery = createListWikiPagesQuery(ctx.wikiId);
  const pagesResult = await handleListWikiPages(pagesQuery, ctx.repos);
  const wikiPages = pagesResult.data || [];

  if (wikiPages.length < 2) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Fetch recent agent runs
  const runsQuery = createListAgentRunsQuery(ctx.repoId);
  const runsResult = await handleListAgentRuns(runsQuery, ctx.repos);
  const recentRuns = runsResult.data || [];

  // Cooldown: only consider runs within the last N completed runs as "recent"
  const META_AGENT_COOLDOWN_RUNS = 10;

  // Get all completed runs sorted by completion time (newest first)
  const completedRuns = recentRuns
    .filter(r => r.status === 'completed' && r.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

  // Helper to check if an agent type has run within the cooldown window
  const hasRunWithinCooldown = (agentType: string): boolean => {
    const recentWindow = completedRuns.slice(0, META_AGENT_COOLDOWN_RUNS);
    return recentWindow.some(r => r.agentType === agentType);
  };

  // Link agent: schedule if many pages lack links
  if (workItems.length < remainingSlots) {
    const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);
    const unlinkedRatio = wikiPages.length > 0 ? pagesWithoutLinks.length / wikiPages.length : 0;

    // Schedule if >15% unlinked OR >3 absolute pages unlinked
    if (unlinkedRatio > 0.15 || pagesWithoutLinks.length > 3) {
      const linkKey = 'link:wiki';
      if (!ctx.existingWorkKeys.has(linkKey)) {
        ctx.existingWorkKeys.add(linkKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'link',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Structure agent: run periodically when wiki has 5+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const structureKey = 'structure:wiki';
    if (!ctx.existingWorkKeys.has(structureKey) && !hasRunWithinCooldown('structure')) {
      ctx.existingWorkKeys.add(structureKey);
      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType: 'structure',
          target: { type: 'wiki' },
        })
      );
    }
  }

  // Quality agent: run for low-confidence pages
  if (workItems.length < remainingSlots && wikiPages.length >= 3) {
    const lowConfidencePages = wikiPages.filter(p => p.confidence < 0.7);
    if (lowConfidencePages.length > 0) {
      const qualityKey = 'quality:wiki';
      if (!ctx.existingWorkKeys.has(qualityKey) && !hasRunWithinCooldown('quality')) {
        ctx.existingWorkKeys.add(qualityKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'quality',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Consistency agent: run when wiki has 5+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const consistencyKey = 'consistency:wiki';
    if (!ctx.existingWorkKeys.has(consistencyKey) && !hasRunWithinCooldown('consistency')) {
      ctx.existingWorkKeys.add(consistencyKey);
      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType: 'consistency',
          target: { type: 'wiki' },
        })
      );
    }
  }

  // Consolidation agent: address findings from meta agents
  if (workItems.length < remainingSlots) {
    const findingsQuery = createListOpenFindingsQuery(ctx.wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, ctx.repos);
    const openFindings = findingsResult.data || [];

    if (openFindings.length > 0) {
      const consolidationKey = 'consolidation:wiki';
      // Bypass cooldown if many findings (>3) to clear backlog faster
      const shouldRun = openFindings.length > 3 || !hasRunWithinCooldown('consolidation');

      if (!ctx.existingWorkKeys.has(consolidationKey) && shouldRun) {
        ctx.existingWorkKeys.add(consolidationKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'consolidation',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  return { workItems };
};

/**
 * Strategy 4: Synthesis work.
 *
 * Creates overview pages, guides, and navigation to make the wiki useful.
 * Triggers early (at 3 pages) to build structure alongside exploration.
 */
export const synthesisStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  // Get wiki pages
  const pagesQuery = createListWikiPagesQuery(ctx.wikiId);
  const pagesResult = await handleListWikiPages(pagesQuery, ctx.repos);
  const wikiPages = pagesResult.data || [];

  // Start synthesis at 3 pages
  if (wikiPages.length < 3) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Fetch recent agent runs
  const runsQuery = createListAgentRunsQuery(ctx.repoId);
  const runsResult = await handleListAgentRuns(runsQuery, ctx.repos);
  const synthRuns = runsResult.data || [];

  // Helper to check if agent has completed recently
  const hasCompletedRecently = (agentType: string): boolean => {
    return synthRuns.some((r: AgentRun) => r.agentType === agentType && r.status === 'completed');
  };

  // Group pages by category
  const categories = new Map<string, WikiPage[]>();
  for (const page of wikiPages) {
    const category = page.path.split('/')[0] ?? 'uncategorized';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(page);
  }

  // Overview Agent: for categories with 3+ pages but no overview
  const skipCategories = ['commits'];
  for (const [category, pages] of categories) {
    if (workItems.length >= remainingSlots) break;
    if (skipCategories.includes(category)) continue;
    if (pages.length < 3) continue;

    const hasOverview = pages.some(
      p => p.path === `${category}/overview` || p.path === `${category}/index`
    );

    if (!hasOverview) {
      const overviewKey = 'overview:wiki';
      if (!ctx.existingWorkKeys.has(overviewKey) && !hasCompletedRecently('overview')) {
        ctx.existingWorkKeys.add(overviewKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'overview',
            target: { type: 'wiki' },
          })
        );
        break;
      }
    }
  }

  // Project Overview Agent: at 5+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const hasProjectOverview = wikiPages.some(
      p => p.path === 'architecture/overview' || p.path === 'architecture/index'
    );

    if (!hasProjectOverview) {
      const projectOverviewKey = 'project-overview:wiki';
      if (!ctx.existingWorkKeys.has(projectOverviewKey) && !hasCompletedRecently('project-overview')) {
        ctx.existingWorkKeys.add(projectOverviewKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'project-overview',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Getting Started Agent: at 5+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const hasGettingStarted = wikiPages.some(
      p => p.path === 'guides/getting-started' ||
           p.path === 'guides/quickstart' ||
           p.path === 'guides/index'
    );

    if (!hasGettingStarted) {
      const gettingStartedKey = 'getting-started:wiki';
      if (!ctx.existingWorkKeys.has(gettingStartedKey) && !hasCompletedRecently('getting-started')) {
        ctx.existingWorkKeys.add(gettingStartedKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'getting-started',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Testing Guide Agent: at 15+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 15) {
    const hasTestingGuide = wikiPages.some(
      p => p.path === 'guides/testing' ||
           p.path === 'guides/tests' ||
           p.path === 'guides/testing-guide'
    );

    if (!hasTestingGuide) {
      const testingGuideKey = 'testing-guide:wiki';
      if (!ctx.existingWorkKeys.has(testingGuideKey) && !hasCompletedRecently('testing-guide')) {
        ctx.existingWorkKeys.add(testingGuideKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'testing-guide',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Extension Guide Agent: at 15+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 15) {
    const hasExtensionGuide = wikiPages.some(
      p => p.path === 'guides/extension-patterns' ||
           p.path === 'guides/extending' ||
           p.path === 'guides/adding-features' ||
           p.path === 'guides/patterns'
    );

    if (!hasExtensionGuide) {
      const extensionGuideKey = 'extension-guide:wiki';
      if (!ctx.existingWorkKeys.has(extensionGuideKey) && !hasCompletedRecently('extension-guide')) {
        ctx.existingWorkKeys.add(extensionGuideKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'extension-guide',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Writer Agent: for pages with commit-style content
  if (workItems.length < remainingSlots) {
    const pagesNeedingRewrite = wikiPages.filter(page => {
      const category = page.path.split('/')[0] ?? '';
      if (['commits', 'security'].includes(category)) return false;
      if (page.path.endsWith('/overview') || page.path.endsWith('/index')) return false;

      const firstPara = page.content.split('\n\n')[1] ?? '';
      const commitIndicators = [
        'this commit ', 'this change ', 'this patch ',
        'this adds ', 'this modifies ', 'this introduces ',
        'commit adds', 'commit modifies',
      ];
      return commitIndicators.some(ind => firstPara.toLowerCase().includes(ind));
    });

    if (pagesNeedingRewrite.length > 0) {
      const writerKey = 'writer:wiki';
      if (!ctx.existingWorkKeys.has(writerKey)) {
        ctx.existingWorkKeys.add(writerKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'writer',
            target: { type: 'wiki' },
          })
        );
      }
    }
  }

  // Wiki Index Agent: at 5+ pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const hasWikiIndex = wikiPages.some(
      p => p.path === 'navigation/wiki-index' ||
           p.path === 'navigation/index' ||
           p.path === 'guides/wiki-index'
    );

    if (!hasWikiIndex) {
      const wikiIndexWorkQuery = createListWorkItemsQuery(ctx.repoId, {
        agentType: 'wiki-index',
        status: 'pending',
      });
      const wikiIndexWorkResult = await handleListWorkItems(wikiIndexWorkQuery, ctx.repos);
      const wikiIndexWorkExists = wikiIndexWorkResult.data || [];

      if (wikiIndexWorkExists.length === 0 && !hasCompletedRecently('wiki-index')) {
        const wikiIndexKey = 'wiki-index:wiki';
        if (!ctx.existingWorkKeys.has(wikiIndexKey)) {
          ctx.existingWorkKeys.add(wikiIndexKey);
          workItems.push(
            createWorkItem({
              id: uuid(),
              repoId: ctx.repoId,
              agentType: 'wiki-index',
              target: { type: 'wiki' },
            })
          );
        }
      }
    }
  }

  // TOC Agent: at 5+ pages for long pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const pagesNeedingToc = wikiPages.filter(page => {
      if (page.path.includes('navigation/') || page.path.endsWith('/index')) return false;
      if (page.confidence < 0.5) return false;
      const lowerContent = page.content.toLowerCase();
      if (lowerContent.includes('## table of contents') ||
          lowerContent.includes('## contents') ||
          lowerContent.includes('## toc')) return false;
      const headingCount = (page.content.match(/^#{2,6}\s+/gm) || []).length;
      return headingCount >= 3;
    });

    if (pagesNeedingToc.length > 0) {
      const tocWorkQuery = createListWorkItemsQuery(ctx.repoId, {
        agentType: 'toc',
        status: 'pending',
      });
      const tocWorkResult = await handleListWorkItems(tocWorkQuery, ctx.repos);
      const tocWorkExists = tocWorkResult.data || [];

      if (tocWorkExists.length === 0 && !hasCompletedRecently('toc')) {
        const tocKey = 'toc:wiki';
        if (!ctx.existingWorkKeys.has(tocKey)) {
          ctx.existingWorkKeys.add(tocKey);
          workItems.push(
            createWorkItem({
              id: uuid(),
              repoId: ctx.repoId,
              agentType: 'toc',
              target: { type: 'wiki' },
            })
          );
        }
      }
    }
  }

  return { workItems };
};

/**
 * All deterministic strategies in priority order.
 *
 * Strategy: "Useful Wiki First"
 * - Document current code first (exploration)
 * - Build structure early (synthesis)
 * - Improve quality (meta agents)
 * - Add historical context last (commits)
 */
export const deterministicStrategies: Strategy[] = [
  codebaseExplorationStrategy,
  synthesisStrategy,
  metaAgentsStrategy,
  commitAnalysisStrategy,
];

/**
 * Execute all strategies in order.
 */
export async function executeStrategies(
  ctx: StrategyContext,
  maxItems: number
): Promise<WorkItem[]> {
  const allWorkItems: WorkItem[] = [];

  for (const strategy of deterministicStrategies) {
    const remainingSlots = maxItems - allWorkItems.length;
    if (remainingSlots <= 0) break;

    const result = await strategy(ctx, remainingSlots);
    allWorkItems.push(...result.workItems);

    if (result.stopProcessing) break;
  }

  return allWorkItems;
}

// Export constants for testing
export { FILE_COVERAGE_THRESHOLD, MAX_DIRECTORIES_PER_RUN };
