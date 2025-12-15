import { v4 as uuid } from 'uuid';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { AgentContext, WorkTarget } from '../agents/base-agent.js';
import type { WorkItem } from '../domain/work-item.js';
import { isCommitTarget, isPathTarget } from '../domain/work-item.js';
import { Orchestrator } from '../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';
import { getAgent } from '../agents/registry.js';
import type { RepositoryServiceFactory } from '../services/repository/repository-service.js';
import {
  createUnifiedRepoAccessFactory,
  type UnifiedRepoAccess,
} from '../services/repository/unified-repo-access.js';
import { runContinuousPool } from './continuous-worker-pool.js';

// Import CQRS commands
import {
  createStartProcessingRunCommand,
  handleStartProcessingRun,
  createUpdateProcessingProgressCommand,
  handleUpdateProcessingProgress,
  createCompleteProcessingRunCommand,
  handleCompleteProcessingRun,
  createFailProcessingRunCommand,
  handleFailProcessingRun,
  createStopProcessingRunCommand,
  handleStopProcessingRun,
  createConfirmStopProcessingRunCommand,
  handleConfirmStopProcessingRun,
} from '../commands/processing-run.js';
import {
  createStartIterationCommand,
  handleStartIteration,
  createUpdateIterationWorkItemCommand,
  handleUpdateIterationWorkItem,
  createCompleteIterationCommand,
  handleCompleteIteration,
  createFailIterationCommand,
  handleFailIteration,
} from '../commands/iteration.js';
import {
  createClaimWorkItemOneCommand,
  handleClaimWorkItemOne,
  createSaveWorkItemsCommand,
  handleSaveWorkItems,
  createCompleteWorkItemCommand,
  handleCompleteWorkItem,
  createFailWorkItemCommand,
  handleFailWorkItem,
} from '../commands/work-queue.js';
import {
  createCreateAgentRunCommand,
  handleCreateAgentRun,
  createCompleteAgentRunCommand,
  handleCompleteAgentRun,
  createFailAgentRunCommand,
  handleFailAgentRun,
} from '../commands/agent-run.js';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../commands/update-wiki-page.js';

// Import CQRS queries
import {
  createListCommitsQuery,
  handleListCommits,
  createGetCommitByShaQuery,
  handleGetCommitBySha,
} from '../queries/index.js';

// Import EditRequest for routing analysis agent output
import { createEditRequest, createCommitEditSource } from '../domain/edit-request.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../agents/registry.js';

// Import tool enforcement for verification
import {
  validateToolUsage,
  isWarnOnly,
  hasToolRequirements,
  formatToolMetricsForLog,
  ToolEnforcementError,
} from './tool-enforcement.js';

/**
 * Executor - The inner loop that runs agents from the work queue.
 *
 * Takes work items and fires off agents, respecting throttle limits.
 * Uses on-demand work computation - each worker requests one item at a time.
 * Edit requests are checked on every claim, ensuring they're processed promptly.
 *
 * All state changes flow through CQRS commands for clean separation.
 */
export class Executor {
  private running = false;
  private shouldStop = false;

  constructor(
    private readonly repos: Repositories,
    private readonly git: GitService,
    private readonly llm: LLMService,
    private readonly orchestrator: Orchestrator,
    private readonly repoServiceFactory?: RepositoryServiceFactory
  ) {
    // Agents are managed by the central registry (src/agents/registry.ts)
  }

  /**
   * Run a fixed number of iterations, processing work items in parallel batches.
   * Respects ordering constraints and maxConcurrency from repo config.
   *
   * @param repoId - Repository to process
   * @param iterations - Number of work items to process
   * @returns Summary of what was done
   */
  async runIterations(repoId: string, iterations: number): Promise<ExecutionSummary> {
    const summary: ExecutionSummary = {
      processingRunId: '',
      iterations: 0,
      successful: 0,
      failed: 0,
      totalCost: 0,
      wikiPagesCreated: 0,
      wikiPagesUpdated: 0,
      duplicatesFiltered: 0,
    };

    // Get or create the active wiki for this repo
    const wiki = await getOrCreateActiveWiki(repoId, this.repos);
    const wikiId = wiki.id;

    // Get maxConcurrency from env with default of 4
    const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY ?? '4', 10);

    // Create a processing run record to track this execution (via CQRS command)
    const processingRunId = uuid();
    const startRunResult = await handleStartProcessingRun(
      createStartProcessingRunCommand({
        id: processingRunId,
        repoId,
        wikiId,
        totalIterations: iterations,
      }),
      this.repos
    );

    if (!startRunResult.success) {
      throw new Error(`Failed to start processing run: ${startRunResult.error}`);
    }
    summary.processingRunId = processingRunId;

    this.running = true;
    this.shouldStop = false;

    try {
      let iterationNumber = 0;

      while (summary.iterations < iterations && !this.shouldStop) {
        // Check if stop has been requested via DB flag
        const currentRun = await this.repos.processingRuns.findById(processingRunId);
        if (currentRun?.status === 'stopping') {
          console.log('Stop requested, finishing after current batch...');
          this.shouldStop = true;
          break;
        }

        // Check rate limits before starting work
        const rateLimitStatus = this.llm.getRateLimitStatus();
        if (rateLimitStatus.isLimited) {
          const reason = rateLimitStatus.reason === 'requests_per_minute'
            ? `${rateLimitStatus.currentRequests}/${rateLimitStatus.maxRequests} requests/min`
            : `$${rateLimitStatus.currentHourlyCost.toFixed(2)}/$${rateLimitStatus.maxHourlyCost.toFixed(2)} hourly`;
          const timeStr = rateLimitStatus.clearsInSeconds !== null
            ? rateLimitStatus.clearsInSeconds >= 60
              ? `~${Math.ceil(rateLimitStatus.clearsInSeconds / 60)}m`
              : `~${rateLimitStatus.clearsInSeconds}s`
            : '';
          console.log(`⏳ Rate limited (${reason}), clears in ${timeStr}...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Get commits already processed by code-change agent (for ordering constraints)
        // This set is updated dynamically when code-change jobs complete
        const processedCommits = await this.getCodeChangeProcessedCommits(repoId);

        // Track if we should exit the main loop
        let workExhausted = false;

        // Run the continuous worker pool
        console.log(`\n▶ Starting continuous pool with max concurrency: ${maxConcurrency}`);

        const poolResult = await runContinuousPool<WorkItem, WorkItemResult>({
          maxConcurrency,
          maxIterations: iterations - summary.iterations,

          claimWork: async () => {
            // Check for stop request
            const currentRun = await this.repos.processingRuns.findById(processingRunId);
            if (currentRun?.status === 'stopping' || this.shouldStop) {
              return null;
            }

            // Check rate limits
            const rateLimitStatus = this.llm.getRateLimitStatus();
            if (rateLimitStatus.isLimited) {
              // Wait for rate limit to clear before claiming
              await new Promise(resolve => setTimeout(resolve, 2000));
              return null; // Will retry claiming
            }

            // Edit requests are now processed synchronously after analysis agents complete,
            // so we don't need to create separate wiki-editor work items here.
            // See executeWorkItem() for the synchronous wiki-editor execution.

            // Try to claim existing work from the queue
            const claimResult = await handleClaimWorkItemOne(
              createClaimWorkItemOneCommand(repoId, processedCommits),
              this.repos
            );
            let workItem = claimResult.success ? claimResult.data : null;

            // If no work in queue, generate new work on-demand
            if (!workItem) {
              // Generate a small batch of work items (on-demand, not pre-filling)
              const newWork = await this.orchestrator.generateWorkList(repoId, wikiId, 10);
              if (newWork.length === 0) {
                // No work from orchestrator - but check if work is in progress
                // If there's pending/claimed work, we should wait rather than exit
                const statusCounts = await this.repos.workQueue.countByStatus(repoId);
                const inProgressCount = (statusCounts.pending || 0) + (statusCounts.claimed || 0);
                if (inProgressCount > 0) {
                  console.log(`  ⏳ No new work generated, ${inProgressCount} item(s) in progress, waiting...`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  return null; // Retry - don't mark exhausted
                }
                // Genuinely no more work
                workExhausted = true;
                return null;
              }

              // Save new work items via CQRS command
              const saveResult = await handleSaveWorkItems(
                createSaveWorkItemsCommand(newWork),
                this.repos
              );

              // Track duplicates filtered
              if (saveResult.success && saveResult.data) {
                const { saved, duplicatesFiltered } = saveResult.data;

                if (duplicatesFiltered > 0) {
                  summary.duplicatesFiltered += duplicatesFiltered;
                  console.log(`  ⚠ ${duplicatesFiltered} duplicate(s) filtered (already in progress)`);
                }

                // If all items were duplicates, work is in progress - wait and retry
                if (saved === 0 && duplicatesFiltered > 0) {
                  console.log(`  ⏳ All ${duplicatesFiltered} item(s) already in progress, waiting...`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  return null; // Retry - don't mark exhausted
                }
              }

              // Claim the first item
              const finalResult = await handleClaimWorkItemOne(
                createClaimWorkItemOneCommand(repoId, processedCommits),
                this.repos
              );
              workItem = finalResult.success ? finalResult.data : null;

              if (!workItem) {
                // Still nothing to claim - check if work is in progress
                const statusCounts = await this.repos.workQueue.countByStatus(repoId);
                const inProgressCount = (statusCounts.pending || 0) + (statusCounts.claimed || 0);
                if (inProgressCount > 0) {
                  console.log(`  ⏳ Claim failed but ${inProgressCount} item(s) in progress, waiting...`);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  return null; // Retry - don't mark exhausted
                }
                workExhausted = true;
                return null;
              }
            }

            console.log(`  ◆ Claimed: ${workItem.agentType}`);
            return workItem;
          },

          executeWork: async (workItem) => {
            // Create iteration record
            iterationNumber++;
            const iterationId = uuid();

            await handleStartIteration(
              createStartIterationCommand({
                id: iterationId,
                processingRunId,
                iterationNumber,
              }),
              this.repos
            );

            await handleUpdateIterationWorkItem(
              createUpdateIterationWorkItemCommand(iterationId, {
                workItemId: workItem.id,
                agentType: workItem.agentType,
              }),
              this.repos
            );

            const result = await this.executeWorkItem(workItem, repoId, wikiId);
            return { ...result, iterationId, workItem };
          },

          onComplete: async (workItem, result) => {
            const { iterationId } = result as WorkItemResult & { iterationId: string; workItem: WorkItem };

            if (result.success) {
              // Capture KPI snapshot for tracking/charting
              let kpiSnapshot: Record<string, unknown> | undefined;
              try {
                const workSummary = await this.orchestrator.getWorkSummary(repoId, wikiId);
                kpiSnapshot = workSummary as unknown as Record<string, unknown>;
              } catch (error) {
                console.warn('Failed to capture KPI snapshot:', error);
              }

              await handleCompleteIteration(
                createCompleteIterationCommand(iterationId, {
                  agentRunId: result.agentRunId!,
                  durationMs: result.durationMs,
                  costUsd: result.cost,
                  pagesCreated: result.pagesCreated,
                  pagesUpdated: result.pagesUpdated,
                  ...(kpiSnapshot && { kpiSnapshot }),
                }),
                this.repos
              );
              summary.successful++;

              // Dynamic processedCommits update: if code-change completed, add commit to set
              if (workItem.agentType === 'code-change' && isCommitTarget(workItem.target)) {
                processedCommits.add(workItem.target.commitId);
              }
            } else {
              await handleFailIteration(
                createFailIterationCommand(iterationId, result.error || 'Unknown error', result.durationMs),
                this.repos
              );
              summary.failed++;
            }

            summary.iterations++;
            summary.totalCost += result.cost;
            summary.wikiPagesCreated += result.pagesCreated;
            summary.wikiPagesUpdated += result.pagesUpdated;

            // Update processing run progress via CQRS command
            await handleUpdateProcessingProgress(
              createUpdateProcessingProgressCommand(processingRunId, {
                completedIterations: summary.iterations,
                successfulIterations: summary.successful,
                failedIterations: summary.failed,
                totalCostUsd: summary.totalCost,
                wikiPagesCreated: summary.wikiPagesCreated,
                wikiPagesUpdated: summary.wikiPagesUpdated,
                duplicatesFiltered: summary.duplicatesFiltered,
              }),
              this.repos
            );
          },

          onError: async (workItem, error) => {
            console.error(`Unexpected error processing ${workItem.agentType}: ${error.message}`);
            summary.failed++;
            summary.iterations++;
          },

          shouldStop: () => this.shouldStop || workExhausted,
        });

        console.log(`\n▶ Pool completed: ${poolResult.completed} successful, ${poolResult.failed} failed`);

        // Process any remaining edits synchronously (e.g., pre-existing edits from previous runs)
        // This handles edge cases where edits exist but weren't created by this run's agents
        const postPoolEdits = await this.repos.editRequests.countPending(wikiId);
        if (postPoolEdits > 0) {
          console.log(`  📝 Processing ${postPoolEdits} remaining edit(s) synchronously...`);
          const wikiEditorAgent = getAgent('wiki-editor');
          if (wikiEditorAgent) {
            const wikiEditorTarget = { type: 'wiki' as const };
            const context: AgentContext = {
              repoId,
              wikiId,
              repos: this.repos,
              llm: this.llm,
            };

            try {
              const result = await wikiEditorAgent.run(wikiEditorTarget, context);
              console.log(`  ✓ wiki-editor processed remaining edits ($${result.costUsd.toFixed(4)})`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.warn(`  ⚠️  wiki-editor failed: ${errorMsg}`);
            }
          }
        }

        // Exit the main loop if work is exhausted
        if (workExhausted) {
          console.log('No more work to do');
          break;
        }
      }

      // Mark processing run as completed via CQRS command
      await handleCompleteProcessingRun(
        createCompleteProcessingRunCommand(processingRunId),
        this.repos
      );
    } catch (error) {
      // Mark processing run as failed via CQRS command
      const errorMessage = error instanceof Error ? error.message : String(error);
      await handleFailProcessingRun(
        createFailProcessingRunCommand(processingRunId, errorMessage),
        this.repos
      );
      throw error;
    } finally {
      this.running = false;

      // If stopped, confirm or set the stopped status via CQRS
      if (this.shouldStop) {
        const run = await this.repos.processingRuns.findById(processingRunId);
        if (run?.status === 'stopping') {
          // Graceful shutdown via HTTP request - confirm the stop
          await handleConfirmStopProcessingRun(
            createConfirmStopProcessingRunCommand(processingRunId),
            this.repos
          );
        } else if (run?.status === 'running') {
          // Direct stop() call - mark as stopped via CQRS
          await handleStopProcessingRun(
            createStopProcessingRunCommand(processingRunId),
            this.repos
          );
        }
      }
    }

    return summary;
  }

  /**
   * Get the set of commit SHAs that have been processed by the code-change agent.
   * Used for ordering constraints in batch claiming.
   */
  private async getCodeChangeProcessedCommits(repoId: string): Promise<Set<string>> {
    // Use CQRS query to get commits
    const query = createListCommitsQuery(repoId, { limit: 1000 });
    const result = await handleListCommits(query, this.repos);
    const commits = result.data || [];
    const processedShas = new Set<string>();

    for (const commit of commits) {
      const hasCodeChange = commit.processedBy.some(
        record => record.agentType === 'code-change'
      );
      if (hasCodeChange) {
        processedShas.add(commit.sha);
      }
    }

    return processedShas;
  }

  /**
   * Stop the executor after the current iteration.
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Check if the executor is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private async executeWorkItem(
    workItem: WorkItem,
    repoId: string,
    wikiId: string
  ): Promise<WorkItemResult> {
    const agent = getAgent(workItem.agentType);
    if (!agent) {
      const errorMsg = `Unknown agent type: ${workItem.agentType}`;
      console.error(errorMsg);
      // Fail work item via CQRS command
      await handleFailWorkItem(
        createFailWorkItemCommand(workItem.id),
        this.repos
      );
      return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0, durationMs: 0, agentRunId: null, error: errorMsg };
    }

    // Extract target info using type guards
    const targetCommitId = isCommitTarget(workItem.target) ? workItem.target.commitId : null;
    const targetPath = isPathTarget(workItem.target) ? workItem.target.path : null;

    // Translate SHA to internal commit ID if we have a target commit
    // The orchestrator returns Git SHAs, but agents expect internal UUIDs
    // Also store the full commit for EditRequest creation
    let internalCommitId: string | undefined;
    let commitData: { sha: string; committedAt: Date } | undefined;
    if (targetCommitId) {
      // Use CQRS query to find commit by SHA
      const commitQuery = createGetCommitByShaQuery(repoId, targetCommitId);
      const commitResult = await handleGetCommitBySha(commitQuery, this.repos);
      if (!commitResult.success || !commitResult.data) {
        const errorMsg = `Commit not found for SHA: ${targetCommitId}`;
        console.error(errorMsg);
        // Fail work item via CQRS command
        await handleFailWorkItem(
          createFailWorkItemCommand(workItem.id),
          this.repos
        );
        return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0, durationMs: 0, agentRunId: null, error: errorMsg };
      }
      internalCommitId = commitResult.data.id;
      commitData = {
        sha: commitResult.data.sha,
        committedAt: commitResult.data.committedAt instanceof Date
          ? commitResult.data.committedAt
          : new Date(commitResult.data.committedAt),
      };
    }

    // Create agent run record via CQRS command
    const agentRunId = uuid();
    const createRunResult = await handleCreateAgentRun(
      createCreateAgentRunCommand({
        id: agentRunId,
        repoId,
        wikiId,
        agentType: workItem.agentType,
        targetCommitId: internalCommitId,
        targetPath: targetPath ?? undefined,
      }),
      this.repos
    );

    if (!createRunResult.success) {
      console.error(`Failed to create agent run: ${createRunResult.error}`);
      await handleFailWorkItem(
        createFailWorkItemCommand(workItem.id),
        this.repos
      );
      return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0, durationMs: 0, agentRunId: null, error: createRunResult.error || 'Failed to create agent run' };
    }

    // Create unified repo access for file and commit operations
    let repoAccess: UnifiedRepoAccess | undefined;
    if (this.repoServiceFactory) {
      try {
        const repoAccessFactory = createUnifiedRepoAccessFactory({
          repos: this.repos,
          repoServiceFactory: this.repoServiceFactory,
          gitService: this.git,
        });
        repoAccess = await repoAccessFactory.create(repoId);
      } catch (err) {
        console.warn(`Failed to create unified repo access: ${err}`);
      }
    }

    // Build agent context
    const context: AgentContext = {
      repoId,
      wikiId,
      repos: this.repos,
      llm: this.llm,
      ...(repoAccess && { repoAccess }),
    };

    const startTime = Date.now();

    try {
      // Build the work target for the agent
      // Note: Commit targets use internal IDs (UUIDs), not Git SHAs
      const agentTarget: WorkTarget = internalCommitId
        ? { type: 'commit', commitId: internalCommitId }
        : targetPath
          ? { type: 'path', path: targetPath }
          : { type: 'wiki' };

      // Verify agent can handle this target type
      if (!agent.canHandle(agentTarget)) {
        throw new Error(`Agent ${agent.type} cannot handle target type: ${agentTarget.type}`);
      }

      // Run the agent using the unified polymorphic interface
      const result = await agent.run(agentTarget, context);

      const durationMs = Date.now() - startTime;

      // Validate tool usage if agent has requirements and provided metrics
      if (result.toolMetrics && hasToolRequirements(agent.type as AgentType)) {
        const validation = validateToolUsage(agent.type as AgentType, result.toolMetrics);

        // Log tool usage for monitoring
        console.log(`  🔧 ${formatToolMetricsForLog(agent.type as AgentType, result.toolMetrics)}`);

        if (!validation.valid) {
          if (isWarnOnly(agent.type as AgentType)) {
            // Log warning but continue
            console.warn(`  ⚠️  Tool verification warning: ${validation.message}`);
          } else {
            // Throw error to fail the agent run
            throw new ToolEnforcementError(agent.type as AgentType, validation);
          }
        }
      } else if (hasToolRequirements(agent.type as AgentType) && !result.toolMetrics) {
        // Agent has requirements but didn't provide metrics - warn for now
        // This allows gradual migration as agents are updated
        console.warn(`  ⚠️  Agent '${agent.type}' has tool requirements but didn't report metrics`);
      }

      // Complete the agent run via CQRS command
      await handleCompleteAgentRun(
        createCompleteAgentRunCommand(agentRunId, result.result, durationMs, result.costUsd),
        this.repos
      );

      // Process wiki updates
      // Analysis agents route through EditRequest queue for intelligent temporal handling
      // Other agents (meta, synthesis) apply updates directly
      let pagesCreated = 0;
      let pagesUpdated = 0;
      let editRequestsQueued = 0;

      const isAnalysisAgent = ANALYSIS_AGENTS.includes(agent.type as AgentType);
      const shouldQueueEdits = isAnalysisAgent && commitData;

      for (const update of result.updates) {
        update.agentRunId = agentRunId;

        // Propagate file tracking data from agent run to wiki updates
        // This enables accurate file coverage calculation
        if (result.toolMetrics?.filesRead && result.toolMetrics.filesRead.length > 0) {
          update.filesAccessed = result.toolMetrics.filesRead;
        }
        if (targetPath) {
          update.targetPaths = [targetPath];
        }

        if (shouldQueueEdits) {
          // Route analysis agent updates through EditRequest queue
          // This enables the WikiEditorAgent to handle out-of-order commits intelligently
          const editRequestParams: Parameters<typeof createEditRequest>[0] = {
            id: uuid(),
            repoId,
            wikiId,
            source: createCommitEditSource(commitData!.sha, commitData!.committedAt),
            sourceAgentType: agent.type as AgentType,
            sourceAgentRunId: agentRunId,
            workItemId: workItem.id, // Link to originating work item for provenance
            targetPagePath: update.path,
            proposedUpdateType: update.type,
            proposedContent: update.content,
            confidenceDelta: update.confidenceDelta,
          };

          // Only add optional properties if they have values
          if (update.title !== undefined) {
            editRequestParams.targetPageTitle = update.title;
          }
          if (update.redirectTo !== undefined) {
            editRequestParams.redirectTo = update.redirectTo;
          }
          // Pass file tracking data for coverage calculation
          if (update.filesAccessed && update.filesAccessed.length > 0) {
            editRequestParams.filesAccessed = update.filesAccessed;
          }
          if (update.targetPaths && update.targetPaths.length > 0) {
            editRequestParams.targetPaths = update.targetPaths;
          }

          const editRequest = createEditRequest(editRequestParams);
          await this.repos.editRequests.save(editRequest);
          editRequestsQueued++;
        } else {
          // Apply updates directly for meta/synthesis agents
          const updateResult = await handleUpdateWikiPage(
            createUpdateWikiPageCommand(update),
            this.repos,
            wikiId
          );

          if (updateResult.success && updateResult.data) {
            // Determine if it was a create or update based on page creation time
            // Handle both Date objects and ISO strings (from JSON deserialization)
            const createdAt = updateResult.data.createdAt instanceof Date
              ? updateResult.data.createdAt
              : new Date(updateResult.data.createdAt);
            const pageAge = Date.now() - createdAt.getTime();
            if (pageAge < 1000) {
              // Created less than 1 second ago, likely new
              pagesCreated++;
            } else {
              pagesUpdated++;
            }
          }
        }
      }

      if (editRequestsQueued > 0) {
        console.log(`  📝 Queued ${editRequestsQueued} edit request(s) for wiki-editor`);

        // Run wiki-editor synchronously to process the edits immediately
        // This prevents duplicate task queuing and ensures edits are applied
        // before the iteration completes
        const wikiEditorAgent = getAgent('wiki-editor');
        if (wikiEditorAgent) {
          console.log(`  📝 Processing edit requests synchronously...`);
          const wikiEditorTarget = { type: 'wiki' as const };

          // Create agent run for wiki-editor (for tracking)
          const wikiEditorRunId = uuid();
          await handleCreateAgentRun(
            createCreateAgentRunCommand({
              id: wikiEditorRunId,
              repoId,
              wikiId,
              agentType: 'wiki-editor',
            }),
            this.repos
          );

          try {
            const wikiEditorResult = await wikiEditorAgent.run(wikiEditorTarget, context);

            // Complete wiki-editor agent run
            await handleCompleteAgentRun(
              createCompleteAgentRunCommand(wikiEditorRunId, wikiEditorResult.result, 0, wikiEditorResult.costUsd),
              this.repos
            );

            // Apply wiki updates from wiki-editor
            const updateCount = wikiEditorResult.updates.length;
            for (const wikiUpdate of wikiEditorResult.updates) {
              wikiUpdate.agentRunId = wikiEditorRunId;
              const updateResult = await handleUpdateWikiPage(
                createUpdateWikiPageCommand(wikiUpdate),
                this.repos,
                wikiId
              );

              if (updateResult.success && updateResult.data) {
                const createdAt = updateResult.data.createdAt instanceof Date
                  ? updateResult.data.createdAt
                  : new Date(updateResult.data.createdAt);
                const pageAge = Date.now() - createdAt.getTime();
                if (pageAge < 1000) {
                  pagesCreated++;
                } else {
                  pagesUpdated++;
                }
              }
            }

            console.log(`  ✓ wiki-editor processed ${editRequestsQueued} edit(s), applied ${updateCount} page update(s) ($${wikiEditorResult.costUsd.toFixed(4)})`);
          } catch (wikiEditorError) {
            // Log but don't fail the main agent - wiki-editor can be retried
            const errorMsg = wikiEditorError instanceof Error ? wikiEditorError.message : String(wikiEditorError);
            console.warn(`  ⚠️  wiki-editor failed: ${errorMsg}`);
            await handleFailAgentRun(
              createFailAgentRunCommand(wikiEditorRunId, errorMsg, 0),
              this.repos
            );
          }
        }
      }

      // Mark commit as processed (still direct repo access - could be another command)
      if (internalCommitId) {
        await this.repos.commits.addProcessingRecord(internalCommitId, {
          agentType: agent.type,
          agentRunId,
          processedAt: new Date(),
        });
      }

      // Complete the work item via CQRS command
      await handleCompleteWorkItem(
        createCompleteWorkItemCommand(workItem.id, agentRunId),
        this.repos
      );

      console.log(`✓ ${agent.type} completed (${durationMs}ms, $${result.costUsd.toFixed(4)})`);

      return {
        success: true,
        cost: result.costUsd,
        pagesCreated,
        pagesUpdated,
        durationMs,
        agentRunId,
        error: null,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Fail agent run via CQRS command
      await handleFailAgentRun(
        createFailAgentRunCommand(agentRunId, errorMessage, durationMs),
        this.repos
      );

      // Fail work item via CQRS command
      await handleFailWorkItem(
        createFailWorkItemCommand(workItem.id),
        this.repos
      );

      // Log detailed error information for debugging
      console.error(`\n${'='.repeat(60)}`);
      console.error(`✗ AGENT FAILURE: ${agent.type}`);
      console.error(`${'='.repeat(60)}`);
      console.error(`Work Item ID: ${workItem.id}`);
      console.error(`Target Commit: ${targetCommitId ?? 'N/A (wiki-level agent)'}`);
      console.error(`Duration: ${durationMs}ms`);
      console.error(`Error: ${errorMessage}`);
      if (errorStack) {
        console.error(`Stack trace:\n${errorStack}`);
      }
      console.error(`${'='.repeat(60)}\n`);

      return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0, durationMs, agentRunId, error: errorMessage };
    }
  }
}

interface WorkItemResult {
  success: boolean;
  cost: number;
  pagesCreated: number;
  pagesUpdated: number;
  durationMs: number;
  agentRunId: string | null;
  error: string | null;
}

export interface ExecutionSummary {
  processingRunId: string;
  iterations: number;
  successful: number;
  failed: number;
  totalCost: number;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
  /** Cumulative count of work items filtered as duplicates (already in progress) */
  duplicatesFiltered: number;
}

/**
 * Create an executor instance.
 */
export function createExecutor(
  repos: Repositories,
  git: GitService,
  llm: LLMService,
  orchestrator: Orchestrator,
  repoServiceFactory?: RepositoryServiceFactory
): Executor {
  return new Executor(repos, git, llm, orchestrator, repoServiceFactory);
}
