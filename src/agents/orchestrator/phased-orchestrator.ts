/**
 * Phased Orchestrator - Adapts strategy based on wiki maturity.
 *
 * Recognizes 6 distinct phases and allocates work accordingly:
 * - Phase 0: Reconnaissance - Understand codebase before documenting
 * - Phase 1: Skeleton - Build navigable structure
 * - Phase 2: Breadth - Cover all directories shallowly
 * - Phase 3: Depth + Guides - Deepen coverage, create synthesis content
 * - Phase 4: Polish - Quality-focused improvements
 * - Phase 5: Maintenance - Reactive mode
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { WorkItem } from '../../domain/work-item.js';
import { createWorkItem } from '../../domain/work-item.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import { ContextGatherer, type OrchestratorContext } from './context-gatherer.js';
import type { Orchestrator, OrchestratorConfig, WorkSummary } from './orchestrator.js';
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// Import CQRS queries
import {
  createListWikiPagesQuery,
  handleListWikiPages,
  createCountPendingWorkQuery,
  handleCountPendingWork,
  createGetPendingWorkKeysQuery,
  handleGetPendingWorkKeys,
  createListUnprocessedCommitsQuery,
  handleListUnprocessedCommits,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createListOpenConflictsQuery,
  handleListOpenConflicts,
  createListOpenFindingsQuery,
  handleListOpenFindings,
  createListLowConfidencePagesQuery,
  handleListLowConfidencePages,
  createCountCommitsByRepoQuery,
  handleCountCommitsByRepo,
  createCountProcessedByAgentQuery,
  handleCountProcessedByAgent,
} from '../../queries/index.js';

/**
 * Phase enumeration.
 */
export enum Phase {
  Reconnaissance = 0,
  Skeleton = 1,
  Breadth = 2,
  DepthAndGuides = 3,
  Polish = 4,
  Maintenance = 5,
}

/**
 * Context needed for phase detection.
 */
export interface PhaseContext {
  pages: number;
  directoriesWithAnyCoverage: number;
  lowestDirectoryCoverage: number;
  avgConfidence: number;
  hasProjectOverview: boolean;
  hasGettingStarted: boolean;
  hasTestingGuide: boolean;
  hasExtensionGuide: boolean;
  lowConfidenceRatio: number;
  openFindings: number;
}

/**
 * Detect current phase based on wiki state.
 */
export function detectPhase(ctx: PhaseContext): Phase {
  // Phase 0: Empty wiki
  if (ctx.pages === 0) {
    return Phase.Reconnaissance;
  }

  // Phase 1: Few pages or few directories covered
  if (ctx.pages < 10 || ctx.directoriesWithAnyCoverage < 3) {
    return Phase.Skeleton;
  }

  // Phase 2: Any directory below 30% or pages < 25
  if (ctx.lowestDirectoryCoverage < 30 || ctx.pages < 25) {
    return Phase.Breadth;
  }

  // Phase 3: Key pages missing or confidence < 65%
  const keyPagesMissing = !ctx.hasProjectOverview || !ctx.hasGettingStarted ||
                          !ctx.hasTestingGuide || !ctx.hasExtensionGuide;
  if (keyPagesMissing || ctx.avgConfidence < 0.65) {
    return Phase.DepthAndGuides;
  }

  // Phase 4: Low confidence ratio > 10% or too many findings
  if (ctx.lowConfidenceRatio > 0.10 || ctx.openFindings > 5) {
    return Phase.Polish;
  }

  // Phase 5: Maintenance
  return Phase.Maintenance;
}

/**
 * Phased Orchestrator implementation.
 */
export class PhasedOrchestrator implements Orchestrator {
  private contextGatherer: ContextGatherer;
  private config: OrchestratorConfig;

  constructor(
    private readonly repos: Repositories,
    private readonly llm?: LLMService,
    config?: OrchestratorConfig,
    private readonly repoAccessFactory?: UnifiedRepoAccessFactory
  ) {
    this.contextGatherer = new ContextGatherer(repos, repoAccessFactory);
    this.config = {
      useLLM: config?.useLLM ?? false,
      model: config?.model ?? 'anthropic/claude-haiku-4.5',
    };
  }

  /**
   * Generate a prioritized work list based on current phase.
   */
  async generateWorkList(
    repoId: string,
    wikiId: string,
    maxItems: number = 10
  ): Promise<WorkItem[]> {
    // Check for bootstrap first (special case)
    const bootstrapWork = await this.checkBootstrapNeeded(repoId, wikiId);
    if (bootstrapWork) {
      return [bootstrapWork];
    }

    // Fetch existing work keys for deduplication
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    // Check pending work count
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingWork = pendingResult.data || 0;

    if (pendingWork >= maxItems) {
      return [];
    }

    const remainingSlots = maxItems - pendingWork;

    // Gather context
    const context = await this.contextGatherer.gather(repoId, wikiId);

    // Build phase context
    const phaseCtx = await this.buildPhaseContext(repoId, wikiId, context);
    const phase = detectPhase(phaseCtx);

    console.log(`📊 Phase: ${Phase[phase]} (pages=${phaseCtx.pages}, dirs=${phaseCtx.directoriesWithAnyCoverage}, conf=${(phaseCtx.avgConfidence * 100).toFixed(0)}%)`);

    // Generate work based on phase
    const workItems = await this.generatePhaseWork(
      phase,
      repoId,
      wikiId,
      context,
      existingWorkKeys,
      remainingSlots
    );

    return workItems;
  }

  /**
   * Build phase context from orchestrator context.
   */
  private async buildPhaseContext(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext
  ): Promise<PhaseContext> {
    // Count directories we know about
    // For phase detection, we care about "directories explored" rather than "directories fully documented"
    // If we have directory info, count total directories (even if undocumented)
    // If no directory info, estimate from page count
    const hasDirectoryInfo = context.undocumentedDirectories.length > 0;

    // For phase detection: count directories where we have SOME coverage (not 100% undocumented)
    // But also consider: if we have many pages, we've likely explored even if coverage calc can't see it
    const dirsWithSomeCoverage = hasDirectoryInfo
      ? context.undocumentedDirectories.filter(d => d.undocumentedRatio < 1.0).length
      : 0;

    // Estimate explored dirs based on page count as a fallback
    const estimatedDirs = Math.min(Math.floor(context.wikiPages / 3), 10);

    // Use the higher of actual coverage or estimate
    const dirsWithCoverage = Math.max(dirsWithSomeCoverage, estimatedDirs);

    // Find lowest coverage among documented directories
    // If all dirs are 100% undocumented, use page-based estimate
    const documentedDirs = hasDirectoryInfo
      ? context.undocumentedDirectories.filter(d => d.undocumentedRatio < 1.0)
      : [];
    const lowestCoverage = documentedDirs.length > 0
      ? Math.min(...documentedDirs.map(d => (1 - d.undocumentedRatio) * 100))
      : Math.min(context.wikiPages * 2, 80); // Estimate: coverage scales with pages

    // Get open findings count
    const findingsQuery = createListOpenFindingsQuery(wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, this.repos);
    const openFindings = findingsResult.data?.length || 0;

    // Calculate low confidence ratio
    const lowConfidenceRatio = context.wikiPages > 0
      ? context.lowConfidencePages / context.wikiPages
      : 0;

    return {
      pages: context.wikiPages,
      directoriesWithAnyCoverage: dirsWithCoverage,
      lowestDirectoryCoverage: lowestCoverage,
      avgConfidence: context.avgConfidence,
      hasProjectOverview: context.hasProjectOverview,
      hasGettingStarted: context.hasGettingStarted,
      hasTestingGuide: context.hasTestingGuide,
      hasExtensionGuide: context.hasExtensionGuide,
      lowConfidenceRatio,
      openFindings,
    };
  }

  /**
   * Generate work items for a specific phase.
   */
  private async generatePhaseWork(
    phase: Phase,
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    switch (phase) {
      case Phase.Reconnaissance:
        return this.generateReconnaissanceWork(repoId, context, existingWorkKeys, maxItems);
      case Phase.Skeleton:
        return this.generateSkeletonWork(repoId, context, existingWorkKeys, maxItems);
      case Phase.Breadth:
        return this.generateBreadthWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.DepthAndGuides:
        return this.generateDepthAndGuidesWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.Polish:
        return this.generatePolishWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.Maintenance:
        return this.generateMaintenanceWork(repoId, context, existingWorkKeys, maxItems);
      default:
        return [];
    }
  }

  /**
   * Phase 0: Reconnaissance - Analyze recent commits before exploration.
   */
  private async generateReconnaissanceWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Analyze recent commits with code-change and narrative
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, 5);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'code-change',
        target: { type: 'commit', commitId: commit.id },
      }));
    }

    // Also analyze with narrative agent
    const narrativeUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('narrative')
    ).slice(0, 3);

    for (const commit of narrativeUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `narrative:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'narrative',
        target: { type: 'commit', commitId: commit.id },
      }));
    }

    return workItems;
  }

  /**
   * Phase 1: Skeleton - Build navigable structure.
   * 70% exploration (core → entry → active), 20% recent commits, 10% structure.
   */
  private async generateSkeletonWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // 70% exploration
    const explorationSlots = Math.ceil(maxItems * 0.7);
    const undocumentedDirs = context.undocumentedDirectories
      .filter(d => d.undocumentedRatio > 0.5)
      .slice(0, explorationSlots);

    for (const dir of undocumentedDirs) {
      if (workItems.length >= explorationSlots) break;

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'codebase-explorer',
        target: { type: 'path', path: dir.path },
      }));
    }

    // 20% recent commits
    const commitSlots = Math.ceil(maxItems * 0.2);
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, commitSlots);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'code-change',
        target: { type: 'commit', commitId: commit.id },
      }));
    }

    // 10% structure - wiki-index if pages >= 5
    if (workItems.length < maxItems && context.wikiPages >= 5) {
      const key = 'wiki-index:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType: 'wiki-index',
          target: { type: 'wiki' },
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 2: Breadth - Cover all directories shallowly.
   * 60% exploration, 20% commits, 10% overview, 10% link.
   */
  private async generateBreadthWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // 60% exploration - target lowest coverage directories
    const explorationSlots = Math.ceil(maxItems * 0.6);
    const undocumentedDirs = context.undocumentedDirectories
      .sort((a, b) => b.undocumentedRatio - a.undocumentedRatio)
      .slice(0, explorationSlots);

    for (const dir of undocumentedDirs) {
      if (workItems.length >= explorationSlots) break;

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'codebase-explorer',
        target: { type: 'path', path: dir.path },
      }));
    }

    // 20% commits
    const commitSlots = Math.ceil(maxItems * 0.2);
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, commitSlots);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems - 2) break; // Reserve 2 slots

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'code-change',
        target: { type: 'commit', commitId: commit.id },
      }));
    }

    // 10% overview - for categories with 3+ pages
    if (workItems.length < maxItems && context.categoriesWithoutOverview.length > 0) {
      const key = 'overview:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType: 'overview',
          target: { type: 'wiki' },
        }));
      }
    }

    // 10% link
    if (workItems.length < maxItems && context.pagesWithoutLinks > 3) {
      const key = 'link:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType: 'link',
          target: { type: 'wiki' },
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 3: Depth and Guides.
   * 40% exploration, 25% synthesis, 20% commits, 15% quality.
   */
  private async generateDepthAndGuidesWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // 40% exploration - deepen below-target directories
    const explorationSlots = Math.ceil(maxItems * 0.4);
    const belowTargetDirs = context.undocumentedDirectories
      .filter(d => d.undocumentedRatio > 0.4) // Below 60% coverage
      .slice(0, explorationSlots);

    for (const dir of belowTargetDirs) {
      if (workItems.length >= explorationSlots) break;

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'codebase-explorer',
        target: { type: 'path', path: dir.path },
      }));
    }

    // 25% synthesis - key pages in priority order
    const synthesisSlots = Math.ceil(maxItems * 0.25);
    const synthesisAgents: Array<{ agent: string; check: boolean }> = [
      { agent: 'project-overview', check: !context.hasProjectOverview },
      { agent: 'getting-started', check: !context.hasGettingStarted },
      { agent: 'testing-guide', check: !context.hasTestingGuide },
      { agent: 'extension-guide', check: !context.hasExtensionGuide },
    ];

    let synthesisAdded = 0;
    for (const { agent, check } of synthesisAgents) {
      if (synthesisAdded >= synthesisSlots) break;
      if (!check) continue;

      const key = `${agent}:wiki`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: agent as AgentType,
        target: { type: 'wiki' },
      }));
      synthesisAdded++;
    }

    // 20% commits - expand to more agent types
    const commitAgents: AgentType[] = ['code-change', 'security', 'dependency'];

    for (const agentType of commitAgents) {
      if (workItems.length >= maxItems - 1) break; // Reserve 1 slot

      const unprocessed = context.recentCommits.filter(
        c => !c.processedBy.includes(agentType)
      ).slice(0, 2);

      for (const commit of unprocessed) {
        if (workItems.length >= maxItems - 1) break;

        const key = `${agentType}:commit:${commit.id}`;
        if (existingWorkKeys.has(key)) continue;
        existingWorkKeys.add(key);

        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType,
          target: { type: 'commit', commitId: commit.id },
        }));
      }
    }

    // 15% quality
    if (workItems.length < maxItems && context.lowConfidencePages > 0) {
      const key = 'quality:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType: 'quality',
          target: { type: 'wiki' },
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 4: Polish - Quality-focused.
   * 50% meta agents, 30% coverage gaps, 20% commits.
   */
  private async generatePolishWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // 50% meta/quality agents
    const qualityAgents: AgentType[] = ['quality', 'consistency', 'writer', 'consolidation'];
    const qualitySlots = Math.ceil(maxItems * 0.5);

    for (const agentType of qualityAgents) {
      if (workItems.length >= qualitySlots) break;

      const key = `${agentType}:wiki`;
      if (existingWorkKeys.has(key)) continue;

      // Skip writer if no pages need rewrite
      if (agentType === 'writer' && context.pagesNeedingRewrite === 0) continue;

      existingWorkKeys.add(key);
      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType,
        target: { type: 'wiki' },
      }));
    }

    // 30% coverage gaps
    const gapSlots = Math.ceil(maxItems * 0.3);
    const gapDirs = context.undocumentedDirectories
      .filter(d => d.undocumentedRatio > 0.2)
      .slice(0, gapSlots);

    for (const dir of gapDirs) {
      if (workItems.length >= maxItems - 2) break; // Reserve slots for commits

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'codebase-explorer',
        target: { type: 'path', path: dir.path },
      }));
    }

    // 20% remaining commits
    for (const agentType of ANALYSIS_AGENTS) {
      if (workItems.length >= maxItems) break;

      const unprocessed = context.recentCommits.filter(
        c => !c.processedBy.includes(agentType)
      ).slice(0, 1);

      for (const commit of unprocessed) {
        if (workItems.length >= maxItems) break;

        const key = `${agentType}:commit:${commit.id}`;
        if (existingWorkKeys.has(key)) continue;
        existingWorkKeys.add(key);

        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType,
          target: { type: 'commit', commitId: commit.id },
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 5: Maintenance - Minimal reactive work.
   */
  private async generateMaintenanceWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];
    const maintenanceMax = Math.min(3, maxItems); // Cap at 3 items

    // Process new commits only
    const recentUnprocessed = context.recentCommits.filter(
      c => c.processedBy.length === 0
    ).slice(0, 2);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maintenanceMax) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      workItems.push(createWorkItem({
        id: uuid(),
        repoId,
        agentType: 'code-change',
        target: { type: 'commit', commitId: commit.id },
      }));
    }

    return workItems;
  }

  /**
   * Check if bootstrap is needed for an empty wiki.
   */
  private async checkBootstrapNeeded(
    repoId: string,
    wikiId: string
  ): Promise<WorkItem | null> {
    const pagesQuery = createListWikiPagesQuery(wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, this.repos);
    const wikiPages = pagesResult.data || [];

    if (wikiPages.length > 0) {
      return null;
    }

    // Check if bootstrap already pending, claimed, or completed
    const runsQuery = createListAgentRunsQuery(repoId);
    const runsResult = await handleListAgentRuns(runsQuery, this.repos);
    const recentRuns = runsResult.data || [];

    const bootstrapRun = recentRuns.find(r => r.agentType === 'bootstrap');
    if (bootstrapRun) {
      return null;
    }

    // Check pending work
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    if (existingWorkKeys.has('bootstrap:wiki')) {
      return null;
    }

    return createWorkItem({
      id: uuid(),
      repoId,
      agentType: 'bootstrap',
      target: { type: 'wiki' },
    });
  }

  /**
   * Check if there's more work to do.
   */
  async hasMoreWork(repoId: string, wikiId: string): Promise<boolean> {
    // Check for pending work
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingCount = pendingResult.data || 0;
    if (pendingCount > 0) return true;

    // Check for unprocessed commits
    for (const agentType of ANALYSIS_AGENTS) {
      const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, agentType);
      const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
      const unprocessedCommits = unprocessedResult.data || [];
      if (unprocessedCommits.length > 0) return true;
    }

    // Check for open conflicts
    const conflictsQuery = createListOpenConflictsQuery(wikiId);
    const conflictsResult = await handleListOpenConflicts(conflictsQuery, this.repos);
    const openConflicts = conflictsResult.data || [];
    if (openConflicts.length > 0) return true;

    // Check for low-confidence pages
    const lowConfQuery = createListLowConfidencePagesQuery(wikiId, 0.5);
    const lowConfResult = await handleListLowConfidencePages(lowConfQuery, this.repos);
    const lowConfidencePages = lowConfResult.data || [];
    if (lowConfidencePages.length > 0) return true;

    // Check for open findings
    const findingsQuery = createListOpenFindingsQuery(wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, this.repos);
    const openFindings = findingsResult.data || [];
    if (openFindings.length > 0) return true;

    return false;
  }

  /**
   * Get a summary of the current work state.
   */
  async getWorkSummary(repoId: string, wikiId: string): Promise<WorkSummary> {
    const [
      totalCommitsResult,
      pendingWorkResult,
      wikiPagesResult,
      openConflictsResult,
      openFindingsResult,
    ] = await Promise.all([
      handleCountCommitsByRepo(createCountCommitsByRepoQuery(repoId), this.repos),
      handleCountPendingWork(createCountPendingWorkQuery(repoId), this.repos),
      handleListWikiPages(createListWikiPagesQuery(wikiId), this.repos),
      handleListOpenConflicts(createListOpenConflictsQuery(wikiId), this.repos),
      handleListOpenFindings(createListOpenFindingsQuery(wikiId), this.repos),
    ]);

    const totalCommits = totalCommitsResult.data || 0;
    const pendingWork = pendingWorkResult.data || 0;
    const wikiPages = wikiPagesResult.data || [];
    const openConflicts = openConflictsResult.data || [];
    const openFindings = openFindingsResult.data || [];

    // Get per-agent coverage
    const agentCoverage: Record<string, number> = {};
    for (const agentType of ANALYSIS_AGENTS) {
      const processedQuery = createCountProcessedByAgentQuery(repoId, agentType);
      const processedResult = await handleCountProcessedByAgent(processedQuery, this.repos);
      const processed = processedResult.data || 0;
      agentCoverage[agentType] = totalCommits > 0 ? (processed / totalCommits) * 100 : 0;
    }

    const codeChangeProcessedQuery = createCountProcessedByAgentQuery(repoId, 'code-change');
    const codeChangeProcessedResult = await handleCountProcessedByAgent(
      codeChangeProcessedQuery,
      this.repos
    );
    const processedCommits = codeChangeProcessedResult.data || 0;

    const avgConfidence =
      wikiPages.length > 0
        ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
        : 0;

    // Calculate file documentation coverage using tracked file relationships
    // Wiki pages now track: filesAccessed (read by agents), filesReferenced (mentioned in content),
    // and targetPaths (work item targets). This is more accurate than searching content for file names.
    let fileDocCoverage = 0;
    let totalSourceFiles = 0;
    let documentedFiles = 0;

    if (this.repoAccessFactory) {
      try {
        const repoAccess = await this.repoAccessFactory.create(repoId);
        const allFiles = await repoAccess.getFileTree();
        const sourceFiles = allFiles.filter(f => this.isSourceFile(f));
        const sourceFileSet = new Set(sourceFiles);

        if (sourceFiles.length > 0) {
          // Collect all files covered by wiki pages from tracked relationships
          const coveredFiles = new Set<string>();
          for (const page of wikiPages) {
            // Files read by agents when building this page
            for (const file of page.filesAccessed ?? []) {
              if (sourceFileSet.has(file)) {
                coveredFiles.add(file);
              }
            }
            // Files mentioned in the page content
            for (const file of page.filesReferenced ?? []) {
              if (sourceFileSet.has(file)) {
                coveredFiles.add(file);
              }
            }
            // Files/folders agents were asked to analyze
            for (const path of page.targetPaths ?? []) {
              // For target paths, check if any source file starts with this path
              // (handles both exact matches and directory targets)
              if (sourceFileSet.has(path)) {
                coveredFiles.add(path);
              } else {
                // Check if it's a directory containing source files
                const pathWithSlash = path.endsWith('/') ? path : path + '/';
                for (const sourceFile of sourceFiles) {
                  if (sourceFile.startsWith(pathWithSlash)) {
                    coveredFiles.add(sourceFile);
                  }
                }
              }
            }
          }

          totalSourceFiles = sourceFiles.length;
          documentedFiles = coveredFiles.size;
          fileDocCoverage = (documentedFiles / totalSourceFiles) * 100;
        }
      } catch (error) {
        // If file coverage calculation fails, continue with zeros
        console.warn('Failed to calculate file documentation coverage:', error);
      }
    }

    return {
      totalCommits,
      processedCommits,
      coveragePercent: totalCommits > 0 ? (processedCommits / totalCommits) * 100 : 0,
      agentCoverage,
      pendingWork,
      wikiPages: wikiPages.length,
      avgConfidence,
      openConflicts: openConflicts.length,
      openFindings: openFindings.length,
      fileDocCoverage,
      totalSourceFiles,
      documentedFiles,
    };
  }

  /**
   * Check if a file path is a source file (for coverage calculation).
   */
  private isSourceFile(filePath: string): boolean {
    // Include TypeScript and JavaScript files
    if (!filePath.match(/\.(ts|js|tsx|jsx)$/)) {
      return false;
    }
    // Exclude test files
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      return false;
    }
    // Exclude type definition files
    if (filePath.endsWith('.d.ts')) {
      return false;
    }
    // Exclude common non-source directories
    if (
      filePath.includes('node_modules/') ||
      filePath.includes('dist/') ||
      filePath.includes('build/') ||
      filePath.includes('__pycache__/')
    ) {
      return false;
    }
    return true;
  }
}
