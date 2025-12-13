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
import type { WorkTarget } from '../../domain/work-target.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { LLMService, ToolUseResult } from '../../services/llm/llm-service.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess } from '../../services/repository/unified-repo-access.js';
import { codebaseTools } from '../../services/llm/codebase-tools.js';
import type { ToolContext, ToolDefinition } from '../../services/llm/tools.js';
import { ContextGatherer, type OrchestratorContext } from './context-gatherer.js';
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  buildUserPrompt,
  parseOrchestratorResponse,
  PROGRESS_UPDATE_SYSTEM_PROMPT,
  buildProgressUpdatePrompt,
} from './prompts.js';
import { createOrchestratorRun } from '../../domain/orchestrator-run.js';
import {
  executeStrategies,
  codebaseExplorationStrategy,
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
} from '../../queries/index.js';

// Import agent registry for type lists
import { ANALYSIS_AGENTS } from '../../agents/registry.js';

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
 * Orchestrator interface - the contract for work generation.
 */
export interface Orchestrator {
  generateWorkList(repoId: string, wikiId: string, maxItems?: number): Promise<WorkItem[]>;
  hasMoreWork(repoId: string, wikiId: string): Promise<boolean>;
  getWorkSummary(repoId: string, wikiId: string): Promise<WorkSummary>;
}

/**
 * Default orchestrator implementation.
 * Supports both LLM-powered and deterministic modes.
 */
export class DefaultOrchestrator implements Orchestrator {
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
      // Generate progress update for bootstrap if LLM available
      await this.generateBootstrapProgressUpdate(repoId, wikiId, bootstrapWork);
      return [bootstrapWork];
    }

    // Note: Pending edit requests are now handled automatically by the Executor
    // before asking the Orchestrator for work. This simplifies the Orchestrator's
    // responsibility to focus on "what new work to generate".

    // If LLM mode enabled and LLM is available, try LLM first
    if (this.config.useLLM && this.llm) {
      try {
        return await this.generateWithLLM(repoId, wikiId, maxItems);
      } catch (error) {
        console.warn('LLM orchestration failed, falling back to deterministic:', error);
      }
    }

    // Deterministic fallback
    return await this.generateDeterministic(repoId, wikiId, maxItems);
  }

  /**
   * Generate progress update for bootstrap case.
   */
  private async generateBootstrapProgressUpdate(
    repoId: string,
    wikiId: string,
    bootstrapWork: WorkItem
  ): Promise<void> {
    if (!this.llm) {
      return;
    }

    try {
      const startTime = Date.now();
      const context = await this.contextGatherer.gather(repoId, wikiId);
      const reasoning = 'Bootstrap required - wiki is empty, initializing documentation.';

      const progressUpdate = await this.generateProgressUpdate(
        context,
        1,
        reasoning
      );

      // Create and save orchestrator run record
      const runId = uuid();
      const orchestratorRun = createOrchestratorRun({
        id: runId,
        repoId,
        context,
        promptSent: '[bootstrap mode - no prompt]',
      });
      orchestratorRun.rawResponse = reasoning;
      orchestratorRun.decision = { reasoning, workItems: [] };
      orchestratorRun.workItemsCreated = [bootstrapWork.id];
      orchestratorRun.model = 'bootstrap';
      orchestratorRun.costUsd = 0;
      orchestratorRun.durationMs = Date.now() - startTime;
      orchestratorRun.usedLLM = false;
      if (progressUpdate) {
        orchestratorRun.progressUpdate = progressUpdate;
        console.log(`📊 Progress: ${progressUpdate}`);
      }

      await this.repos.orchestratorRuns.save(orchestratorRun);
    } catch (error) {
      console.warn('Failed to generate bootstrap progress update:', error);
    }
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

    // Check if bootstrap work already pending or in progress (claimed)
    // This prevents race conditions when multiple workers try to fill slots concurrently
    const workQuery = createListWorkItemsQuery(repoId, {
      agentType: 'bootstrap',
    });
    const workResult = await handleListWorkItems(workQuery, this.repos);
    const allBootstrapWork = workResult.data || [];

    // If any bootstrap work is pending or currently being processed, don't create more
    const activeBootstrap = allBootstrapWork.filter(
      w => w.status === 'pending' || w.status === 'claimed'
    );
    if (activeBootstrap.length > 0) {
      return null;
    }

    // Check if bootstrap work has failed (don't auto-retry to prevent infinite loop)
    const failedBootstrap = allBootstrapWork.filter(w => w.status === 'failed');
    if (failedBootstrap.length > 0) {
      return null;
    }

    // Check if bootstrap has already completed or failed
    const runsQuery = createListAgentRunsQuery(repoId);
    const runsResult = await handleListAgentRuns(runsQuery, this.repos);
    const recentRuns = runsResult.data || [];
    const bootstrapCompleted = recentRuns.some(
      r => r.agentType === 'bootstrap' && r.status === 'completed'
    );

    if (bootstrapCompleted) {
      return null;
    }

    // Check if bootstrap has failed (don't auto-retry to prevent infinite loop)
    const bootstrapFailed = recentRuns.some(
      r => r.agentType === 'bootstrap' && r.status === 'failed'
    );

    if (bootstrapFailed) {
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
   * Generate work list using LLM reasoning with tool-calling capability.
   *
   * The LLM now has full control over work scheduling including:
   * - Codebase exploration (targeting specific directories from coverage tree)
   * - Commit analysis
   * - Synthesis and meta work
   *
   * If the LLM doesn't schedule any exploration, fallback adds it automatically.
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

    // Gather context for LLM (wiki state, commits, key pages, coverage tree, overview)
    const context = await this.contextGatherer.gather(repoId, wikiId);
    const contextString = this.contextGatherer.formatForPrompt(context);

    // Note: Path validation via coverage tree removed - fileCoverageTree is pre-formatted string
    const validPaths = new Set<string>();

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

    // Create tool executor for codebase exploration
    const toolExecutor = await this.createToolExecutor(repoId);

    // Call LLM with tools - orchestrator can explore before deciding
    const completion = await this.llm!.completeWithTools({
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: toolExecutor ? 5 : 0,
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Get valid commit SHAs for validation
    const commitsQuery = createListCommitsQuery(repoId, { limit: 100 });
    const commitsResult = await handleListCommits(commitsQuery, this.repos);
    const commits = commitsResult.data || [];
    const validCommitIds = new Set(commits.map(c => c.sha));

    // Parse response with path validation
    const decision = parseOrchestratorResponse(completion.content, validCommitIds, validPaths);

    // Update tracking record
    orchestratorRun.rawResponse = completion.content;
    orchestratorRun.decision = decision;
    orchestratorRun.model = completion.model;
    orchestratorRun.costUsd = completion.costUsd;
    orchestratorRun.durationMs = Date.now() - startTime;
    orchestratorRun.usedLLM = true;
    // Track tool usage
    (orchestratorRun as { toolCalls?: ToolUseResult['toolCalls']; toolRounds?: number }).toolCalls = completion.toolCalls;
    (orchestratorRun as { toolRounds?: number }).toolRounds = completion.toolRounds;

    // Convert LLM decisions to work items
    const llmWorkItems: WorkItem[] = [];
    let llmScheduledExploration = false;

    for (const item of decision.workItems) {
      if (llmWorkItems.length >= maxItems) break;

      // Build deduplication key based on target type
      let key: string;
      if (item.targetPath) {
        key = `codebase-explorer:path:${item.targetPath}`;
        llmScheduledExploration = true;
      } else if (item.targetCommitId) {
        key = `${item.agentType}:commit:${item.targetCommitId}`;
      } else {
        key = `${item.agentType}:wiki`;
      }

      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      // Construct target based on what the LLM specified
      const target: WorkTarget = item.targetCommitId
        ? { type: 'commit', commitId: item.targetCommitId }
        : item.targetPath
          ? { type: 'path', path: item.targetPath }
          : { type: 'wiki' };

      const workItem = createWorkItem({
        id: uuid(),
        repoId,
        agentType: item.agentType as AgentType,
        target,
        orchestratorRunId: runId,
      });

      llmWorkItems.push(workItem);
    }

    // Fallback: If LLM didn't schedule any exploration, add deterministic exploration
    let fallbackExplorationWork: WorkItem[] = [];
    if (!llmScheduledExploration && this.contextGatherer) {
      const remainingSlots = maxItems - llmWorkItems.length;
      if (remainingSlots > 0) {
        const explorationCtx: StrategyContext = {
          repos: this.repos,
          repoId,
          wikiId,
          existingWorkKeys,
          contextGatherer: this.contextGatherer,
        };
        const explorationResult = await codebaseExplorationStrategy(explorationCtx, remainingSlots);
        fallbackExplorationWork = explorationResult.workItems;
      }
    }

    // Combine LLM work with fallback exploration
    const allWorkItems = [...llmWorkItems, ...fallbackExplorationWork];

    // Generate progress update
    const progressUpdate = await this.generateProgressUpdate(
      context,
      allWorkItems.length,
      decision.reasoning
    );

    // Save tracking record
    orchestratorRun.workItemsCreated = allWorkItems.map(w => w.id);
    if (progressUpdate) {
      orchestratorRun.progressUpdate = progressUpdate;
    }
    await this.repos.orchestratorRuns.save(orchestratorRun);

    const toolInfo = completion.toolRounds > 0 ? `, ${completion.toolRounds} tool rounds` : '';
    const fallbackInfo = fallbackExplorationWork.length > 0 ? ` (+${fallbackExplorationWork.length} fallback exploration)` : '';
    console.log(
      `🤖 LLM Orchestrator: "${decision.reasoning}" (${allWorkItems.length} items${fallbackInfo}${toolInfo}, $${completion.costUsd.toFixed(4)})`
    );
    if (progressUpdate) {
      console.log(`📊 Progress: ${progressUpdate}`);
    }

    return allWorkItems;
  }

  /**
   * Create a tool executor for the orchestrator to explore the codebase.
   * Uses UnifiedRepoAccess to work with both local and GitHub repositories.
   */
  private async createToolExecutor(repoId: string): Promise<{
    tools: ToolDefinition[];
    executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
  } | null> {
    if (!this.repoAccessFactory) {
      return null;
    }

    try {
      const repoAccess = await this.repoAccessFactory.create(repoId);
      const localPath = repoAccess.getLocalPath();

      // For local repos, use filesystem-based tools
      if (localPath) {
        const toolContext: ToolContext = { repoPath: localPath, maxFileSize: 50000 };
        return {
          tools: codebaseTools,
          executeTools: async (calls) => {
            const results = await Promise.all(calls.map(async (call) => {
              const tool = codebaseTools.find(t => t.name === call.name);
              if (!tool) {
                return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
              }
              try {
                const result = await tool.execute(call.input, toolContext);
                return { id: call.id, result };
              } catch (error) {
                return {
                  id: call.id,
                  result: `Error executing ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
                };
              }
            }));
            return results;
          },
        };
      }

      // For GitHub repos, create API-based tools
      return this.createUnifiedApiTools(repoAccess);
    } catch {
      return null;
    }
  }

  /**
   * Create API-based tools using UnifiedRepoAccess.
   */
  private createUnifiedApiTools(repoAccess: UnifiedRepoAccess): {
    tools: ToolDefinition[];
    executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
  } {
    const apiTools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read the contents of a file from the repository.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path from repository root' },
          },
          required: ['path'],
        },
        execute: async (input) => {
          const path = input['path'] as string;
          try {
            return await repoAccess.getFileContent(path);
          } catch (error) {
            return `Error reading "${path}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory in the repository.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to repository root' },
          },
          required: ['path'],
        },
        execute: async (input) => {
          const path = input['path'] as string;
          try {
            const entries = await repoAccess.listDirectory(path);
            return entries.map(e => `${e.name}${e.type === 'dir' ? '/' : ''}`).join('\n');
          } catch (error) {
            return `Error listing "${path}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
      {
        name: 'search_files',
        description: 'Search for files matching a pattern. Returns file paths.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
          },
          required: ['pattern'],
        },
        execute: async (input) => {
          const pattern = input['pattern'] as string;
          try {
            const allFiles = await repoAccess.getFileTree();
            // Simple glob matching
            const regexPattern = pattern
              .replace(/\*\*/g, '<<<GLOBSTAR>>>')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '.')
              .replace(/<<<GLOBSTAR>>>/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`);
            const matches = allFiles.filter(file => regex.test(file));
            if (matches.length === 0) {
              return `No files found matching "${pattern}"`;
            }
            return matches.join('\n');
          } catch (error) {
            return `Error searching for "${pattern}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
    ];

    return {
      tools: apiTools,
      executeTools: async (calls) => {
        const results = await Promise.all(calls.map(async (call) => {
          const tool = apiTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          const result = await tool.execute(call.input, { repoPath: '', maxFileSize: 100000 });
          return { id: call.id, result };
        }));
        return results;
      },
    };
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
    const startTime = Date.now();

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
      ...(this.contextGatherer && { contextGatherer: this.contextGatherer }),
    };

    // Execute all strategies
    const workItems = await executeStrategies(strategyContext, remainingSlots);

    // Generate progress update if LLM is available
    if (this.llm && workItems.length > 0) {
      // Gather context for progress update
      const context = await this.contextGatherer.gather(repoId, wikiId);

      // Describe what deterministic strategies decided
      const reasoning = this.describeDeterministicReasoning(workItems);

      // Generate progress update
      const progressUpdate = await this.generateProgressUpdate(
        context,
        workItems.length,
        reasoning
      );

      // Create and save orchestrator run record for tracking
      const runId = uuid();
      const orchestratorRun = createOrchestratorRun({
        id: runId,
        repoId,
        context,
        promptSent: '[deterministic mode - no prompt]',
      });
      orchestratorRun.rawResponse = reasoning;
      orchestratorRun.decision = { reasoning, workItems: [] };
      orchestratorRun.workItemsCreated = workItems.map(w => w.id);
      orchestratorRun.model = 'deterministic';
      orchestratorRun.costUsd = 0;
      orchestratorRun.durationMs = Date.now() - startTime;
      orchestratorRun.usedLLM = false;
      if (progressUpdate) {
        orchestratorRun.progressUpdate = progressUpdate;
      }

      await this.repos.orchestratorRuns.save(orchestratorRun);

      if (progressUpdate) {
        console.log(`📊 Progress: ${progressUpdate}`);
      }
    }

    return workItems;
  }

  /**
   * Describe what the deterministic strategies decided to do.
   */
  private describeDeterministicReasoning(workItems: WorkItem[]): string {
    if (workItems.length === 0) {
      return 'No work scheduled - queue may be full or no gaps found.';
    }

    const agentTypes = [...new Set(workItems.map(w => w.agentType))];
    const summary = agentTypes.map(agent => {
      const count = workItems.filter(w => w.agentType === agent).length;
      return `${count} ${agent}`;
    }).join(', ');

    return `Deterministic scheduling: ${summary}`;
  }

  /**
   * Generate a progress update summary via LLM.
   *
   * Called after each orchestrator run to provide visibility into
   * the orchestrator's assessment of progress and remaining work.
   *
   * @returns Progress update paragraph, or undefined if LLM unavailable or fails
   */
  private async generateProgressUpdate(
    context: OrchestratorContext,
    workItemsScheduled: number,
    reasoning: string
  ): Promise<string | undefined> {
    if (!this.llm) {
      return undefined;
    }

    try {
      const prompt = buildProgressUpdatePrompt(context, workItemsScheduled, reasoning);

      const result = await this.llm.complete({
        system: PROGRESS_UPDATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 500,
        temperature: 0.3,
      });

      return result.content.trim();
    } catch (error) {
      console.warn('Failed to generate progress update:', error);
      return undefined;
    }
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

          // Helper to add exact file match only (for filesAccessed, filesReferenced)
          // Directory paths in content mentions should NOT count as covering all files
          const addExactFile = (path: string) => {
            if (sourceFileSet.has(path)) {
              coveredFiles.add(path);
            }
          };

          // Helper to add coverage for a path - allows directory matching
          // Only used for targetPaths (explicit work assignments)
          const addPathCoverage = (path: string) => {
            if (sourceFileSet.has(path)) {
              // Exact file match
              coveredFiles.add(path);
            } else if (path.endsWith('/')) {
              // Directory path - match all files within
              for (const sourceFile of sourceFiles) {
                if (sourceFile.startsWith(path)) {
                  coveredFiles.add(sourceFile);
                }
              }
            } else {
              // Could be a directory without trailing slash - check if it's a prefix
              const pathWithSlash = path + '/';
              for (const sourceFile of sourceFiles) {
                if (sourceFile.startsWith(pathWithSlash)) {
                  coveredFiles.add(sourceFile);
                }
              }
            }
          };

          for (const page of wikiPages) {
            // Files read by agents when building this page (exact matches only)
            for (const file of page.filesAccessed ?? []) {
              addExactFile(file);
            }
            // Files mentioned in the page content (exact matches only)
            // Directory mentions in prose/tree views should NOT count as covering all files
            for (const file of page.filesReferenced ?? []) {
              addExactFile(file);
            }
            // Files/folders agents were asked to analyze (allows directory coverage)
            // This is the only source that should allow directory-level coverage
            for (const path of page.targetPaths ?? []) {
              addPathCoverage(path);
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
  /** File documentation coverage percentage (0-100), weighted by LOC */
  fileDocCoverage: number;
  /** Total number of source files in the repository */
  totalSourceFiles: number;
  /** Number of files with any documentation (coverage > 0) */
  documentedFiles: number;
}

// Import PhasedOrchestrator - no circular dependency since it only imports types from this file
import { PhasedOrchestrator } from './phased-orchestrator.js';

/**
 * Create an orchestrator instance.
 * Uses ORCHESTRATOR_TYPE env var to select implementation.
 * Default is 'phased' (the new phased orchestrator).
 * Use 'legacy' for the original deterministic/LLM orchestrator.
 */
export function createOrchestrator(
  repos: Repositories,
  llm?: LLMService,
  config?: OrchestratorConfig,
  repoAccessFactory?: UnifiedRepoAccessFactory
): Orchestrator {
  const type = process.env.ORCHESTRATOR_TYPE || 'phased';

  switch (type) {
    case 'legacy':
      return new DefaultOrchestrator(repos, llm, config, repoAccessFactory);
    case 'phased':
    default:
      return new PhasedOrchestrator(repos, llm, config, repoAccessFactory);
  }
}
