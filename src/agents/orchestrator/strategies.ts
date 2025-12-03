/**
 * Deterministic work generation strategies for the Orchestrator.
 *
 * Each strategy is responsible for identifying a specific type of work that
 * needs to be done and creating the appropriate work items.
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { GitService } from '../../services/git/index.js';
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
  createCountPendingEditRequestsQuery,
  handleCountPendingEditRequests,
  createListOpenFindingsQuery,
  handleListOpenFindings,
} from '../../queries/index.js';

// Agent type definitions
import {
  type AgentType,
  ANALYSIS_AGENTS,
  META_AGENTS,
} from '../../agents/registry.js';

/**
 * Priority levels for work items.
 */
export const Priority = {
  USER_REQUEST: 100,
  RECENT_COMMIT: 80,
  EXPLORATION: 75,
  HISTORICAL_COMMIT: 60,
  META: 50,
  LOW_CONFIDENCE: 45,
  SYNTHESIS: 40,
};

/**
 * Context passed to all strategies.
 */
export interface StrategyContext {
  repos: Repositories;
  repoId: string;
  wikiId: string;
  existingWorkKeys: Set<string>;
  git?: GitService;
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
 * Strategy 0: Bootstrap empty wikis.
 * This must run before any commit processing to establish foundation pages.
 */
export const bootstrapStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  // Check wiki pages
  const pagesQuery = createListWikiPagesQuery(ctx.wikiId);
  const pagesResult = await handleListWikiPages(pagesQuery, ctx.repos);
  const wikiPages = pagesResult.data || [];

  if (wikiPages.length > 0) {
    return { workItems: [] };  // Wiki has content, skip bootstrap
  }

  // Check if bootstrap work already pending
  const bootstrapWorkQuery = createListWorkItemsQuery(ctx.repoId, {
    agentType: 'bootstrap',
    status: 'pending',
  });
  const bootstrapWorkResult = await handleListWorkItems(bootstrapWorkQuery, ctx.repos);
  const bootstrapWorkExists = bootstrapWorkResult.data || [];

  if (bootstrapWorkExists.length > 0) {
    return { workItems: [], stopProcessing: true };  // Bootstrap pending, wait for it
  }

  // Check if bootstrap has already run
  const runsQuery = createListAgentRunsQuery(ctx.repoId);
  const runsResult = await handleListAgentRuns(runsQuery, ctx.repos);
  const recentRuns = runsResult.data || [];
  const bootstrapCompleted = recentRuns.some(
    r => r.agentType === 'bootstrap' && r.status === 'completed'
  );

  if (bootstrapCompleted) {
    return { workItems: [] };  // Already done
  }

  // Need to bootstrap
  return {
    workItems: [
      createWorkItem({
        id: uuid(),
        repoId: ctx.repoId,
        agentType: 'bootstrap',
        priority: Priority.USER_REQUEST,
      }),
    ],
    stopProcessing: true,  // Bootstrap must complete before other work
  };
};

/**
 * Strategy 1: Process pending edit requests.
 * Wiki-editor should run when edit requests pile up to keep wiki updated incrementally.
 */
export const pendingEditsStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  const PENDING_EDITS_THRESHOLD = 5;

  // Check pending edit request count
  const pendingEditsQuery = createCountPendingEditRequestsQuery(ctx.wikiId);
  const pendingEditsResult = await handleCountPendingEditRequests(pendingEditsQuery, ctx.repos);
  const pendingEditCount = pendingEditsResult.data || 0;

  if (pendingEditCount < PENDING_EDITS_THRESHOLD) {
    return { workItems: [] };
  }

  const wikiEditorKey = 'wiki-editor:wiki';
  if (ctx.existingWorkKeys.has(wikiEditorKey)) {
    return { workItems: [] };
  }

  ctx.existingWorkKeys.add(wikiEditorKey);
  return {
    workItems: [
      createWorkItem({
        id: uuid(),
        repoId: ctx.repoId,
        agentType: 'wiki-editor',
        priority: Priority.USER_REQUEST - 1,
      }),
    ],
  };
};

/**
 * Strategy 2: Codebase exploration.
 * Document undocumented code before commit analysis to establish current state.
 */
export const codebaseExplorationStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0 || !ctx.git || !ctx.contextGatherer) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Calculate directory coverage
  const context = await ctx.contextGatherer.gather(ctx.repoId, ctx.wikiId);
  const lowCoverageDirs = context.directoryCoverage
    .filter(d => d.coveragePercent < 20)
    .slice(0, 3);

  for (const dir of lowCoverageDirs) {
    if (workItems.length >= remainingSlots) break;

    const key = `codebase-explorer:path:${dir.path}`;
    if (ctx.existingWorkKeys.has(key)) continue;

    ctx.existingWorkKeys.add(key);
    workItems.push(
      createWorkItem({
        id: uuid(),
        repoId: ctx.repoId,
        agentType: 'codebase-explorer',
        priority: Priority.EXPLORATION,
        targetPath: dir.path,
      })
    );
  }

  return { workItems };
};

/**
 * Strategy 3: Process unprocessed commits with all analysis agents.
 */
export const commitAnalysisStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  const workItems: WorkItem[] = [];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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

      const isRecent = commit.committedAt > oneWeekAgo;
      const priority = isRecent ? Priority.RECENT_COMMIT : Priority.HISTORICAL_COMMIT;

      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType,
          priority,
          targetCommitId: commit.sha,
        })
      );
    }
  }

  return { workItems };
};

/**
 * Strategy 4: Meta agents (run on wiki after analysis is complete).
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

  // Check if analysis is mostly complete
  const unprocessedQuery = createListUnprocessedCommitsQuery(ctx.repoId, 'code-change');
  const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, ctx.repos);
  const unprocessedByCodeChange = unprocessedResult.data || [];

  if (unprocessedByCodeChange.length > 0) {
    return { workItems: [] };  // Wait for analysis to complete
  }

  const workItems: WorkItem[] = [];

  // Fetch recent agent runs
  const runsQuery = createListAgentRunsQuery(ctx.repoId);
  const runsResult = await handleListAgentRuns(runsQuery, ctx.repos);
  const recentRuns = runsResult.data || [];

  // Check for pages without links (need link agent)
  if (workItems.length < remainingSlots) {
    const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);
    if (pagesWithoutLinks.length > 0) {
      const linkKey = 'link:wiki';
      if (!ctx.existingWorkKeys.has(linkKey)) {
        ctx.existingWorkKeys.add(linkKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'link',
            priority: Priority.META,
          })
        );
      }
    }
  }

  // Run structure agent periodically (when wiki has at least 5 pages)
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const recentStructureRuns = recentRuns
      .filter(r => r.agentType === 'structure' && r.status === 'completed')
      .slice(0, 1);

    const structureKey = 'structure:wiki';
    if (!ctx.existingWorkKeys.has(structureKey) && recentStructureRuns.length === 0) {
      ctx.existingWorkKeys.add(structureKey);
      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType: 'structure',
          priority: Priority.META,
        })
      );
    }
  }

  // Run quality agent for low-confidence pages
  if (workItems.length < remainingSlots && wikiPages.length >= 3) {
    const lowConfidencePages = wikiPages.filter(p => p.confidence < 0.7);
    if (lowConfidencePages.length > 0) {
      const recentQualityRuns = recentRuns
        .filter(r => r.agentType === 'quality' && r.status === 'completed')
        .slice(0, 1);

      const qualityKey = 'quality:wiki';
      if (!ctx.existingWorkKeys.has(qualityKey) && recentQualityRuns.length === 0) {
        ctx.existingWorkKeys.add(qualityKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'quality',
            priority: Priority.META,
          })
        );
      }
    }
  }

  // Run consistency agent when wiki has enough pages (5+)
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const recentConsistencyRuns = recentRuns
      .filter(r => r.agentType === 'consistency' && r.status === 'completed')
      .slice(0, 1);

    const consistencyKey = 'consistency:wiki';
    if (!ctx.existingWorkKeys.has(consistencyKey) && recentConsistencyRuns.length === 0) {
      ctx.existingWorkKeys.add(consistencyKey);
      workItems.push(
        createWorkItem({
          id: uuid(),
          repoId: ctx.repoId,
          agentType: 'consistency',
          priority: Priority.META,
        })
      );
    }
  }

  // Consolidation agent - address findings from meta agents
  if (workItems.length < remainingSlots) {
    const findingsQuery = createListOpenFindingsQuery(ctx.wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, ctx.repos);
    const openFindings = findingsResult.data || [];

    if (openFindings.length > 0) {
      const recentConsolidationRuns = recentRuns
        .filter(r => r.agentType === 'consolidation' && r.status === 'completed')
        .slice(0, 1);

      const consolidationKey = 'consolidation:wiki';
      if (!ctx.existingWorkKeys.has(consolidationKey) && recentConsolidationRuns.length === 0) {
        ctx.existingWorkKeys.add(consolidationKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'consolidation',
            priority: Priority.LOW_CONFIDENCE,
          })
        );
      }
    }
  }

  return { workItems };
};

/**
 * Strategy 7: Synthesis work (when we have enough raw material).
 */
export const synthesisStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  // Get wiki pages
  const pagesQuery = createListWikiPagesQuery(ctx.wikiId);
  const pagesResult = await handleListWikiPages(pagesQuery, ctx.repos);
  const wikiPages = pagesResult.data || [];

  if (wikiPages.length < 5) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Fetch recent agent runs for synthesis checks
  const synthRunsQuery = createListAgentRunsQuery(ctx.repoId);
  const synthRunsResult = await handleListAgentRuns(synthRunsQuery, ctx.repos);
  const synthRuns = synthRunsResult.data || [];

  // Group pages by category
  const categories = new Map<string, WikiPage[]>();
  for (const page of wikiPages) {
    const category = page.path.split('/')[0] ?? 'uncategorized';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(page);
  }

  // Overview Agent: trigger for categories with 3+ pages but no overview
  const skipCategories = ['commits'];
  for (const [category, pages] of categories) {
    if (workItems.length >= remainingSlots) break;
    if (skipCategories.includes(category)) continue;
    if (pages.length < 3) continue;

    const hasOverview = pages.some(
      p => p.path === `${category}/overview` || p.path === `${category}/index`
    );

    if (!hasOverview) {
      const recentOverviewRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'overview' && r.status === 'completed')
        .slice(0, 1);

      const overviewKey = 'overview:wiki';
      if (!ctx.existingWorkKeys.has(overviewKey) && recentOverviewRuns.length === 0) {
        ctx.existingWorkKeys.add(overviewKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'overview',
            priority: Priority.SYNTHESIS,
          })
        );
        break;
      }
    }
  }

  // Project Overview Agent: trigger when 10+ pages but no architecture/overview
  if (workItems.length < remainingSlots && wikiPages.length >= 10) {
    const hasProjectOverview = wikiPages.some(
      p => p.path === 'architecture/overview' || p.path === 'architecture/index'
    );

    if (!hasProjectOverview) {
      const recentProjectOverviewRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'project-overview' && r.status === 'completed')
        .slice(0, 1);

      const projectOverviewKey = 'project-overview:wiki';
      if (!ctx.existingWorkKeys.has(projectOverviewKey) && recentProjectOverviewRuns.length === 0) {
        ctx.existingWorkKeys.add(projectOverviewKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'project-overview',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // Getting Started Agent: trigger when 10+ pages but no guides/getting-started
  if (workItems.length < remainingSlots && wikiPages.length >= 10) {
    const hasGettingStarted = wikiPages.some(
      p =>
        p.path === 'guides/getting-started' ||
        p.path === 'guides/quickstart' ||
        p.path === 'guides/index'
    );

    if (!hasGettingStarted) {
      const recentGettingStartedRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'getting-started' && r.status === 'completed')
        .slice(0, 1);

      const gettingStartedKey = 'getting-started:wiki';
      if (!ctx.existingWorkKeys.has(gettingStartedKey) && recentGettingStartedRuns.length === 0) {
        ctx.existingWorkKeys.add(gettingStartedKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'getting-started',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // Testing Guide Agent: trigger when 15+ pages but no guides/testing
  if (workItems.length < remainingSlots && wikiPages.length >= 15) {
    const hasTestingGuide = wikiPages.some(
      p =>
        p.path === 'guides/testing' ||
        p.path === 'guides/tests' ||
        p.path === 'guides/testing-guide'
    );

    if (!hasTestingGuide) {
      const recentTestingGuideRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'testing-guide' && r.status === 'completed')
        .slice(0, 1);

      const testingGuideKey = 'testing-guide:wiki';
      if (!ctx.existingWorkKeys.has(testingGuideKey) && recentTestingGuideRuns.length === 0) {
        ctx.existingWorkKeys.add(testingGuideKey);
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'testing-guide',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // Extension Guide Agent: trigger when 15+ pages but no guides/extension-patterns
  if (workItems.length < remainingSlots && wikiPages.length >= 15) {
    const hasExtensionGuide = wikiPages.some(
      p =>
        p.path === 'guides/extension-patterns' ||
        p.path === 'guides/extending' ||
        p.path === 'guides/adding-features' ||
        p.path === 'guides/patterns'
    );

    if (!hasExtensionGuide) {
      const recentExtensionGuideRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'extension-guide' && r.status === 'completed')
        .slice(0, 1);

      if (
        !ctx.existingWorkKeys.has('extension-guide:wiki') &&
        recentExtensionGuideRuns.length === 0
      ) {
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'extension-guide',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // Writer Agent: trigger for pages with commit-style content
  if (workItems.length < remainingSlots) {
    const pagesNeedingRewrite = wikiPages.filter(page => {
      const category = page.path.split('/')[0] ?? '';
      if (['commits', 'security'].includes(category)) return false;
      if (page.path.endsWith('/overview') || page.path.endsWith('/index')) return false;

      const firstPara = page.content.split('\n\n')[1] ?? '';
      const commitIndicators = [
        'this commit ',
        'this change ',
        'this patch ',
        'this adds ',
        'this modifies ',
        'this introduces ',
        'commit adds',
        'commit modifies',
      ];
      return commitIndicators.some(ind => firstPara.toLowerCase().includes(ind));
    });

    if (pagesNeedingRewrite.length > 0) {
      if (!ctx.existingWorkKeys.has('writer:wiki')) {
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'writer',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // Wiki Index Agent: trigger when 10+ pages but no navigation/wiki-index
  if (workItems.length < remainingSlots && wikiPages.length >= 10) {
    const hasWikiIndex = wikiPages.some(
      p =>
        p.path === 'navigation/wiki-index' ||
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

      const recentWikiIndexRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'wiki-index' && r.status === 'completed')
        .slice(0, 1);

      if (wikiIndexWorkExists.length === 0 && recentWikiIndexRuns.length === 0) {
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'wiki-index',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  // TOC Agent: trigger when 5+ pages to add table of contents to long pages
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
    const pagesNeedingToc = wikiPages.filter(page => {
      if (page.path.includes('navigation/') || page.path.endsWith('/index')) return false;
      if (page.confidence < 0.5) return false;
      const lowerContent = page.content.toLowerCase();
      if (
        lowerContent.includes('## table of contents') ||
        lowerContent.includes('## contents') ||
        lowerContent.includes('## toc')
      )
        return false;
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

      const recentTocRuns = synthRuns
        .filter((r: AgentRun) => r.agentType === 'toc' && r.status === 'completed')
        .slice(0, 1);

      if (tocWorkExists.length === 0 && recentTocRuns.length === 0) {
        workItems.push(
          createWorkItem({
            id: uuid(),
            repoId: ctx.repoId,
            agentType: 'toc',
            priority: Priority.SYNTHESIS,
          })
        );
      }
    }
  }

  return { workItems };
};

/**
 * All deterministic strategies in priority order.
 */
export const deterministicStrategies: Strategy[] = [
  bootstrapStrategy,
  pendingEditsStrategy,
  codebaseExplorationStrategy,
  commitAnalysisStrategy,
  metaAgentsStrategy,
  synthesisStrategy,
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
