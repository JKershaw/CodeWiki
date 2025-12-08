/**
 * Deterministic work generation strategies for the Orchestrator.
 *
 * Each strategy is responsible for identifying a specific type of work that
 * needs to be done and creating the appropriate work items.
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import { createWorkItem, type WorkItem } from '../../domain/work-item.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import type { AgentRun } from '../../domain/agent-run.js';
import type { OrchestratorContext, IterationPhase } from './context-gatherer.js';

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
  /** Optional iteration phase for phase-aware prioritization */
  iterationPhase?: IterationPhase;
}

/**
 * Phase-adjusted thresholds for strategies.
 * Allows strategies to adapt behavior based on iteration progress.
 */
export interface PhaseAdjustedThresholds {
  /** Coverage threshold - directories below this are explored */
  coverageThreshold: number;
  /** Maximum directories to explore at once */
  maxDirectories: number;
  /** Priority boost for synthesis work (0-1) */
  synthesisBoost: number;
  /** Priority boost for quality/meta work (0-1) */
  qualityBoost: number;
}

/**
 * Get phase-adjusted thresholds for strategies.
 *
 * Combines wiki size with iteration phase to determine optimal thresholds:
 * - Early phase (0-30%): Aggressive exploration, breadth-first coverage
 * - Mid phase (30-70%): Balance exploration with synthesis
 * - Late phase (70-100%): Focus on quality, polish, and gap-filling
 *
 * @param phase - Current iteration phase (undefined for backwards compatibility)
 * @param wikiPageCount - Current number of wiki pages
 * @returns Adjusted thresholds for strategies
 */
export function getPhaseAdjustedThresholds(
  phase: IterationPhase | undefined,
  wikiPageCount: number
): PhaseAdjustedThresholds {
  // Base thresholds from wiki size (existing logic)
  // Small wiki (< 5 pages): Aggressive exploration
  // Growing wiki (5-10 pages): Moderate exploration
  // Established wiki (10-20 pages): Selective exploration
  // Mature wiki (20+ pages): Only truly undocumented
  const baseCoverageThreshold = wikiPageCount < 5 ? 60
    : wikiPageCount < 10 ? 40
    : wikiPageCount < 20 ? 30
    : 20;

  const baseMaxDirectories = wikiPageCount < 5 ? 5
    : wikiPageCount < 10 ? 4
    : wikiPageCount < 20 ? 3
    : 2;

  // Default boosts (no phase = balanced approach)
  let synthesisBoost = 0.5;
  let qualityBoost = 0.5;

  // Adjust based on iteration phase
  if (!phase) {
    // No phase info - return base thresholds (backwards compatible)
    return {
      coverageThreshold: baseCoverageThreshold,
      maxDirectories: baseMaxDirectories,
      synthesisBoost,
      qualityBoost,
    };
  }

  // Phase adjustments
  let coverageAdjustment = 0;
  let directoryAdjustment = 0;

  switch (phase) {
    case 'early':
      // Early phase: Be MORE aggressive with exploration
      // Increase coverage threshold by 15% (explore more directories)
      // Increase max directories by 2
      coverageAdjustment = 15;
      directoryAdjustment = 2;
      synthesisBoost = 0.3; // Lower synthesis priority
      qualityBoost = 0.2; // Lower quality priority
      break;

    case 'mid':
      // Mid phase: Balance exploration and synthesis
      // Keep base thresholds but boost synthesis
      coverageAdjustment = 5;
      directoryAdjustment = 1;
      synthesisBoost = 0.8; // High synthesis priority
      qualityBoost = 0.5; // Moderate quality priority
      break;

    case 'late':
      // Late phase: Focus on quality, polish, gap-filling
      // Reduce exploration (only truly undocumented)
      // Decrease coverage threshold by 10% (explore fewer directories)
      coverageAdjustment = -10;
      directoryAdjustment = -1;
      synthesisBoost = 0.6; // Moderate synthesis
      qualityBoost = 0.9; // High quality priority
      break;
  }

  return {
    coverageThreshold: Math.max(10, baseCoverageThreshold + coverageAdjustment),
    maxDirectories: Math.max(1, baseMaxDirectories + directoryAdjustment),
    synthesisBoost,
    qualityBoost,
  };
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
        target: { type: 'wiki' },
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
 *
 * Phase-aware adjustments:
 * - Early phase: Even more aggressive exploration (breadth-first)
 * - Mid phase: Balance exploration with other work
 * - Late phase: Only explore truly undocumented areas
 */
export const codebaseExplorationStrategy: Strategy = async (ctx, remainingSlots) => {
  if (remainingSlots <= 0 || !ctx.contextGatherer) {
    return { workItems: [] };
  }

  const workItems: WorkItem[] = [];

  // Calculate directory coverage
  const context = await ctx.contextGatherer.gather(ctx.repoId, ctx.wikiId);
  const wikiPageCount = context.wikiPages;

  // Get phase-adjusted thresholds (combines wiki size with iteration phase)
  const thresholds = getPhaseAdjustedThresholds(ctx.iterationPhase, wikiPageCount);

  const lowCoverageDirs = context.directoryCoverage
    .filter(d => d.coveragePercent < thresholds.coverageThreshold)
    .slice(0, thresholds.maxDirectories);

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

  // Check for pages without links (need link agent)
  // Link agent scheduling is more aggressive than other meta agents because
  // cross-references are critical for wiki navigation
  if (workItems.length < remainingSlots) {
    const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);
    const totalPages = wikiPages.length;
    const unlinkedRatio = totalPages > 0 ? pagesWithoutLinks.length / totalPages : 0;

    // Schedule link agent if:
    // 1. More than 30% of pages have no links, OR
    // 2. More than 5 pages have no links (absolute threshold for small wikis)
    const needsLinking = unlinkedRatio > 0.3 || pagesWithoutLinks.length > 5;

    if (needsLinking) {
      const linkKey = 'link:wiki';

      // Check for recent link runs (cooldown)
      const recentLinkRuns = recentRuns
        .filter(r => r.agentType === 'link' && r.status === 'completed')
        .slice(0, 1);
      const hasRecentRun = recentLinkRuns.length > 0;

      // Override cooldown if unlinked ratio is very high (> 50%)
      // This ensures link agent runs frequently when wiki is poorly linked
      const shouldOverrideCooldown = unlinkedRatio > 0.5;

      if (!ctx.existingWorkKeys.has(linkKey) && (!hasRecentRun || shouldOverrideCooldown)) {
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
          target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
          target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
            target: { type: 'wiki' },
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
