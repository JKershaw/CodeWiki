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
  createListOpenFindingsQuery,
  handleListOpenFindings,
} from '../../queries/index.js';

// Agent type definitions
import {
  ANALYSIS_AGENTS,
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

  // Check if bootstrap work has failed (don't auto-retry to prevent infinite loop)
  const failedBootstrapQuery = createListWorkItemsQuery(ctx.repoId, {
    agentType: 'bootstrap',
    status: 'failed',
  });
  const failedBootstrapResult = await handleListWorkItems(failedBootstrapQuery, ctx.repos);
  const bootstrapWorkFailed = failedBootstrapResult.data || [];

  if (bootstrapWorkFailed.length > 0) {
    return { workItems: [], stopProcessing: true };  // Bootstrap failed, don't auto-retry
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

  // Check if bootstrap has failed (don't auto-retry to prevent infinite loop)
  const bootstrapFailed = recentRuns.some(
    r => r.agentType === 'bootstrap' && r.status === 'failed'
  );

  if (bootstrapFailed) {
    return { workItems: [], stopProcessing: true };  // Bootstrap failed, don't auto-retry
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
 * Strategy 1: Codebase exploration.
 * Document undocumented code before commit analysis to establish current state.
 *
 * "Useful Wiki First" approach:
 * - When wiki is small (< 10 pages), be aggressive about exploration
 * - Higher coverage threshold = explore more directories
 * - More directories at once = faster foundation building
 * - As wiki grows, become more selective (only truly undocumented areas)
 */
export const codebaseExplorationStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0 || !ctx.git || !ctx.contextGatherer) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Calculate directory coverage
  const context = await ctx.contextGatherer.gather(ctx.repoId, ctx.wikiId);
  const wikiPageCount = context.wikiPages;

  // Adaptive thresholds based on wiki size:
  // - Small wiki (< 5 pages): Aggressively explore anything < 60% covered, up to 5 dirs
  // - Growing wiki (5-10 pages): Explore < 40% covered, up to 4 dirs
  // - Established wiki (10-20 pages): Explore < 30% covered, up to 3 dirs
  // - Mature wiki (20+ pages): Only truly undocumented < 20%, up to 2 dirs
  const coverageThreshold = wikiPageCount < 5 ? 60
    : wikiPageCount < 10 ? 40
    : wikiPageCount < 20 ? 30
    : 20;

  const maxDirectories = wikiPageCount < 5 ? 5
    : wikiPageCount < 10 ? 4
    : wikiPageCount < 20 ? 3
    : 2;

  const lowCoverageDirs = context.directoryCoverage
    .filter(d => d.coveragePercent < coverageThreshold)
    .slice(0, maxDirectories);

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
 * Strategy 2: Process unprocessed commits with all analysis agents.
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
 * Strategy 3: Meta agents (run on wiki after analysis is complete).
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
 * Strategy 4: Synthesis work (elevated in "Useful Wiki First" approach).
 *
 * Key change: Trigger synthesis EARLIER to make wiki useful sooner.
 * - Old approach: Wait for 5+ pages, project-overview at 10+
 * - New approach: Start at 3 pages, project-overview at 5+
 *
 * Rationale: Users need navigation and overview pages early to understand
 * the wiki structure, even if content is still being added.
 */
export const synthesisStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0) return { workItems: [] };

  // Get wiki pages
  const pagesQuery = createListWikiPagesQuery(ctx.wikiId);
  const pagesResult = await handleListWikiPages(pagesQuery, ctx.repos);
  const wikiPages = pagesResult.data || [];

  // Lower threshold: start synthesis at 3 pages (was 5)
  // This supports "Useful Wiki First" - create structure early
  if (wikiPages.length < 3) {
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

  // Project Overview Agent: trigger when 5+ pages but no architecture/overview
  // (Lowered from 10 to support "Useful Wiki First" - users need architecture overview early)
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
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

  // Getting Started Agent: trigger when 5+ pages but no guides/getting-started
  // (Lowered from 10 to support "Useful Wiki First" - users need onboarding guide early)
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
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

  // Wiki Index Agent: trigger when 5+ pages but no navigation/wiki-index
  // (Lowered from 10 to support "Useful Wiki First" - users need navigation early)
  if (workItems.length < remainingSlots && wikiPages.length >= 5) {
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
 *
 * Strategy: "Useful Wiki First"
 * - Users want to USE the wiki immediately, not wait for full commit analysis
 * - Build from CURRENT codebase first (exploration), then add historical context (commits)
 *
 * Note: Pending edit requests are now handled automatically by the Executor
 * before asking the Orchestrator for work. This simplifies the Orchestrator's
 * responsibility to focus on "what new work to generate".
 *
 * Order:
 * 1. Bootstrap - foundation for empty wikis
 * 2. Codebase Exploration - PRIMARY early: document what exists NOW
 * 3. Synthesis - ELEVATED: create overviews/guides early from exploration pages
 * 4. Meta Agents - improve quality and linking
 * 5. Commit Analysis - DEMOTED: add historical context after wiki is useful
 */
export const deterministicStrategies: Strategy[] = [
  bootstrapStrategy,
  codebaseExplorationStrategy,
  synthesisStrategy,           // Elevated: create structure early
  metaAgentsStrategy,
  commitAnalysisStrategy,      // Demoted: historical context comes after useful wiki
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
