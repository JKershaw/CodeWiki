/**
 * Orchestrator - The decision-maker that produces prioritized work lists.
 *
 * Can operate in two modes:
 * - Deterministic: Uses fixed strategies (default, faster, predictable)
 * - LLM-powered: Uses an LLM to make intelligent decisions (smarter, adapts to context)
 *
 * The LLM mode falls back to deterministic if the LLM call fails.
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { WorkItem } from '../../domain/work-item.js';
import { createWorkItem } from '../../domain/work-item.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { GitService } from '../../services/git/git-service.js';
import { ContextGatherer } from './context-gatherer.js';
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  buildUserPrompt,
  parseOrchestratorResponse,
} from './prompts.js';
import { createOrchestratorRun } from '../../domain/orchestrator-run.js';
import {
  executeStrategies,
  Priority,
  type StrategyContext,
} from './strategies.js';

// Import CQRS queries
import {
  createListWikiPagesQuery,
  handleListWikiPages,
  createListWorkItemsQuery,
  handleListWorkItems,
  createGetPendingWorkKeysQuery,
  handleGetPendingWorkKeys,
  createCountPendingWorkQuery,
  handleCountPendingWork,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createListCommitsQuery,
  handleListCommits,
  createListUnprocessedCommitsQuery,
  handleListUnprocessedCommits,
  createCountCommitsByRepoQuery,
  handleCountCommitsByRepo,
  createCountProcessedByAgentQuery,
  handleCountProcessedByAgent,
  createListOpenConflictsQuery,
  handleListOpenConflicts,
  createListOpenFindingsQuery,
  handleListOpenFindings,
  createListLowConfidencePagesQuery,
  handleListLowConfidencePages,
  createCountPendingEditRequestsQuery,
  handleCountPendingEditRequests,
} from '../../queries/index.js';

// Import agent registry for type lists
import { ANALYSIS_AGENTS, META_AGENTS } from '../../agents/registry.js';

/**
 * Orchestrator configuration.
 */
export interface OrchestratorConfig {
  /** Use LLM for decision making (default: true) */
  useLLM?: boolean;
  /** Model to use for orchestration (default: anthropic/claude-haiku-4.5) */
  model?: string;
}

/**
 * Orchestrator class.
 */
export class Orchestrator {
  private contextGatherer: ContextGatherer;
  private config: OrchestratorConfig;

  constructor(
    private readonly repos: Repositories,
    private readonly llm?: LLMService,
    config?: OrchestratorConfig,
    private readonly git?: GitService
  ) {
    this.contextGatherer = new ContextGatherer(repos, git);
    this.config = {
      useLLM: config?.useLLM ?? false,
      model: config?.model ?? 'anthropic/claude-haiku-4.5',
    };
  }

  /**
   * Generate a prioritized work list for the given repository and wiki.
   */
  async generateWorkList(
    repoId: string,
    wikiId: string,
    maxItems: number = 10
  ): Promise<WorkItem[]> {
    // First check for high-priority deterministic work that should always run
    const bootstrapWork = await this.checkBootstrapNeeded(repoId, wikiId);
    if (bootstrapWork) {
      return [bootstrapWork];
    }

    const pendingEditsWork = await this.checkPendingEditsNeeded(repoId, wikiId);

    // If LLM mode enabled and LLM is available, try LLM first
    if (this.config.useLLM && this.llm) {
      try {
        const llmWork = await this.generateWithLLM(repoId, wikiId, maxItems);
        // Prepend high-priority deterministic work
        const allWork = pendingEditsWork ? [pendingEditsWork, ...llmWork] : llmWork;
        return allWork.slice(0, maxItems);
      } catch (error) {
        console.warn('LLM orchestration failed, falling back to deterministic:', error);
      }
    }

    // Deterministic fallback
    const deterministicWork = await this.generateDeterministic(repoId, wikiId, maxItems);

    // Prepend high-priority deterministic work
    const allWork = pendingEditsWork
      ? [pendingEditsWork, ...deterministicWork]
      : deterministicWork;

    return allWork.slice(0, maxItems);
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

    // Check if bootstrap work already pending
    const workQuery = createListWorkItemsQuery(repoId, {
      agentType: 'bootstrap',
      status: 'pending',
    });
    const workResult = await handleListWorkItems(workQuery, this.repos);
    const bootstrapWorkExists = workResult.data || [];

    if (bootstrapWorkExists.length > 0) {
      return null;
    }

    // Check if bootstrap has already completed
    const runsQuery = createListAgentRunsQuery(repoId);
    const runsResult = await handleListAgentRuns(runsQuery, this.repos);
    const recentRuns = runsResult.data || [];
    const bootstrapCompleted = recentRuns.some(
      r => r.agentType === 'bootstrap' && r.status === 'completed'
    );

    if (bootstrapCompleted) {
      return null;
    }

    return createWorkItem({
      id: uuid(),
      repoId,
      agentType: 'bootstrap',
      priority: Priority.USER_REQUEST,
    });
  }

  /**
   * Check if wiki-editor is needed due to pending edit requests.
   */
  private async checkPendingEditsNeeded(
    repoId: string,
    wikiId: string
  ): Promise<WorkItem | null> {
    const PENDING_EDITS_THRESHOLD = 5;
    const PENDING_EDITS_URGENT = 20;

    const pendingEditsQuery = createCountPendingEditRequestsQuery(wikiId);
    const pendingEditsResult = await handleCountPendingEditRequests(pendingEditsQuery, this.repos);
    const pendingEditCount = pendingEditsResult.data || 0;

    if (pendingEditCount === 0) {
      return null;
    }

    const isUrgent = pendingEditCount > PENDING_EDITS_URGENT;

    if (!isUrgent) {
      const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, 'code-change');
      const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
      const unprocessedCommits = unprocessedResult.data || [];
      const analysisComplete = unprocessedCommits.length === 0;

      if (!analysisComplete && pendingEditCount < PENDING_EDITS_THRESHOLD) {
        return null;
      }
    }

    // Check if wiki-editor work already pending
    const workQuery = createListWorkItemsQuery(repoId, {
      agentType: 'wiki-editor',
      status: 'pending',
    });
    const workResult = await handleListWorkItems(workQuery, this.repos);
    const wikiEditorWorkExists = workResult.data || [];

    if (wikiEditorWorkExists.length > 0) {
      return null;
    }

    return createWorkItem({
      id: uuid(),
      repoId,
      agentType: 'wiki-editor',
      priority: Priority.USER_REQUEST - 1,
    });
  }

  /**
   * Generate work list using LLM reasoning.
   */
  private async generateWithLLM(
    repoId: string,
    wikiId: string,
    maxItems: number
  ): Promise<WorkItem[]> {
    const startTime = Date.now();

    // Fetch existing work keys for deduplication
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    // Gather context
    const context = await this.contextGatherer.gather(repoId, wikiId);
    const contextString = this.contextGatherer.formatForPrompt(context);

    // Build prompt
    const userPrompt = buildUserPrompt(context, contextString, maxItems);

    // Create tracking record
    const runId = uuid();
    const orchestratorRun = createOrchestratorRun({
      id: runId,
      repoId,
      context,
      promptSent: userPrompt,
    });

    // Call LLM
    const completion = await this.llm!.complete({
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Get valid commit SHAs for validation
    const commitsQuery = createListCommitsQuery(repoId, { limit: 100 });
    const commitsResult = await handleListCommits(commitsQuery, this.repos);
    const commits = commitsResult.data || [];
    const validCommitIds = new Set(commits.map(c => c.sha));

    // Parse response
    const decision = parseOrchestratorResponse(completion.content, validCommitIds);

    // Update tracking record
    orchestratorRun.rawResponse = completion.content;
    orchestratorRun.decision = decision;
    orchestratorRun.model = completion.model;
    orchestratorRun.costUsd = completion.costUsd;
    orchestratorRun.durationMs = Date.now() - startTime;
    orchestratorRun.usedLLM = true;

    // Convert to work items
    const workItems: WorkItem[] = [];
    for (const item of decision.workItems) {
      if (workItems.length >= maxItems) break;

      const key = item.targetPath
        ? `${item.agentType}:path:${item.targetPath}`
        : `${item.agentType}:${item.targetCommitId ?? 'null'}`;
      if (existingWorkKeys.has(key)) continue;

      existingWorkKeys.add(key);

      const workItem = createWorkItem({
        id: uuid(),
        repoId,
        agentType: item.agentType as AgentType,
        priority: this.getPriority(item.agentType),
        ...(item.targetCommitId ? { targetCommitId: item.targetCommitId } : {}),
        ...(item.targetPath ? { targetPath: item.targetPath } : {}),
        orchestratorRunId: runId,
      });

      workItems.push(workItem);
    }

    // Save tracking record
    orchestratorRun.workItemsCreated = workItems.map(w => w.id);
    await this.repos.orchestratorRuns.save(orchestratorRun);

    console.log(
      `🤖 LLM Orchestrator: "${decision.reasoning}" (${workItems.length} items, $${completion.costUsd.toFixed(4)})`
    );

    return workItems;
  }

  /**
   * Get priority for an agent type.
   */
  private getPriority(agentType: string): number {
    if (ANALYSIS_AGENTS.includes(agentType as AgentType)) {
      return Priority.RECENT_COMMIT;
    }
    if (agentType === 'wiki-editor') {
      return Priority.USER_REQUEST - 1;
    }
    if (agentType === 'codebase-explorer') {
      return Priority.EXPLORATION;
    }
    if (META_AGENTS.includes(agentType as AgentType)) {
      return Priority.META;
    }
    if (agentType === 'consolidation') {
      return Priority.LOW_CONFIDENCE;
    }
    return Priority.SYNTHESIS;
  }

  /**
   * Generate work list using deterministic strategies.
   * This is the fallback when LLM is not available or fails.
   */
  private async generateDeterministic(
    repoId: string,
    wikiId: string,
    maxItems: number
  ): Promise<WorkItem[]> {
    // Fetch existing work keys for deduplication
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    // Check for pending work
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingWork = pendingResult.data || 0;

    if (pendingWork >= maxItems) {
      return [];
    }

    const remainingSlots = maxItems - pendingWork;

    // Build strategy context
    const strategyContext: StrategyContext = {
      repos: this.repos,
      repoId,
      wikiId,
      existingWorkKeys,
      ...(this.git && { git: this.git }),
      ...(this.contextGatherer && { contextGatherer: this.contextGatherer }),
    };

    // Execute all strategies
    return executeStrategies(strategyContext, remainingSlots);
  }

  /**
   * Check if there's more work to do for a repository/wiki.
   */
  async hasMoreWork(repoId: string, wikiId: string): Promise<boolean> {
    // Check for pending work
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingCount = pendingResult.data || 0;
    if (pendingCount > 0) return true;

    // Check for unprocessed commits across all analysis agents
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

    // Overall coverage is based on code-change (primary agent)
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
    };
  }

  /**
   * Enable or disable LLM mode.
   */
  setUseLLM(useLLM: boolean): void {
    this.config.useLLM = useLLM;
  }

  /**
   * Check if LLM mode is enabled.
   */
  isUsingLLM(): boolean {
    return this.config.useLLM ?? false;
  }
}

export interface WorkSummary {
  totalCommits: number;
  processedCommits: number;
  coveragePercent: number;
  agentCoverage: Record<string, number>;
  pendingWork: number;
  wikiPages: number;
  avgConfidence: number;
  openConflicts: number;
  openFindings: number;
}

/**
 * Create an orchestrator instance.
 */
export function createOrchestrator(
  repos: Repositories,
  llm?: LLMService,
  config?: OrchestratorConfig,
  git?: GitService
): Orchestrator {
  return new Orchestrator(repos, llm, config, git);
}
