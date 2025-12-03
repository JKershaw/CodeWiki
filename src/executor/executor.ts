import { v4 as uuid } from 'uuid';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { AgentContext, WorkTarget } from '../agents/base-agent.js';
import type { WorkItem } from '../domain/work-item.js';
import { getTargetCommitId, getTargetPath } from '../domain/work-item.js';
import { Orchestrator } from '../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';
import { getAgent } from '../agents/registry.js';
import type { RepositoryServiceFactory } from '../services/repository/repository-service.js';

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
  createClaimWorkItemBatchCommand,
  handleClaimWorkItemBatch,
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
import { createEditRequest } from '../domain/edit-request.js';

// Import agent type definitions from central registry
import { ANALYSIS_AGENTS, type AgentType } from '../agents/registry.js';

/**
 * Queue water marks for proactive refill.
 * Low water mark: trigger refill when queue drops to this level
 * High water mark: target queue size, request items to reach this level
 */
const QUEUE_LOW_WATER_MARK = 12;
const QUEUE_HIGH_WATER_MARK = 50;

/**
 * Executor - The inner loop that runs agents from the work queue.
 *
 * Takes work items and fires off agents, respecting throttle limits.
 * When the work list is exhausted, it triggers the orchestrator again.
 * Proactively refills the queue in the background to avoid blocking.
 *
 * All state changes flow through CQRS commands for clean separation.
 */
export class Executor {
  private running = false;
  private shouldStop = false;
  private refillInProgress = false;
  private refillPromise: Promise<void> | null = null;

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

        // Check rate limits before claiming work
        if (this.llm.isRateLimited()) {
          console.log('Rate limited, waiting...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Check pending count and trigger proactive async refill if low
        const pendingCount = await this.repos.workQueue.countPending(repoId);
        if (pendingCount <= QUEUE_LOW_WATER_MARK && !this.refillInProgress) {
          this.triggerAsyncRefill(repoId, wikiId, pendingCount);
        }

        // Get commits already processed by code-change agent (for ordering constraints)
        const processedCommits = await this.getCodeChangeProcessedCommits(repoId);

        // Calculate how many items we can process in this batch
        // With a larger queue, we have more candidates to choose from after filtering
        const remainingIterations = iterations - summary.iterations;
        const batchSize = Math.min(maxConcurrency, remainingIterations);

        // Try to claim a batch of work items
        let claimResult = await handleClaimWorkItemBatch(
          createClaimWorkItemBatchCommand(repoId, batchSize, processedCommits),
          this.repos
        );
        let workItems = claimResult.success ? claimResult.data ?? [] : [];

        // If no work, wait for async refill or do synchronous generation
        if (workItems.length === 0) {
          // If async refill is in progress, wait for it
          if (this.refillPromise) {
            console.log('Waiting for async refill to complete...');
            await this.refillPromise;

            // Try claiming again after refill
            const freshProcessedCommits = await this.getCodeChangeProcessedCommits(repoId);
            claimResult = await handleClaimWorkItemBatch(
              createClaimWorkItemBatchCommand(repoId, batchSize, freshProcessedCommits),
              this.repos
            );
            workItems = claimResult.success ? claimResult.data ?? [] : [];
          }

          // Still no work? Do synchronous generation as fallback
          if (workItems.length === 0) {
            console.log('No work items claimed, generating more...');
            // Request enough items to reach high water mark
            const itemsToRequest = Math.max(10, QUEUE_HIGH_WATER_MARK);
            const newWork = await this.orchestrator.generateWorkList(repoId, wikiId, itemsToRequest);
            if (newWork.length === 0) {
              console.log('No more work to do');
              break;
            }

            // Save new work items via CQRS command
            await handleSaveWorkItems(
              createSaveWorkItemsCommand(newWork),
              this.repos
            );

            // Try claiming again with fresh processedCommits
            const freshProcessedCommits = await this.getCodeChangeProcessedCommits(repoId);
            claimResult = await handleClaimWorkItemBatch(
              createClaimWorkItemBatchCommand(repoId, batchSize, freshProcessedCommits),
              this.repos
            );
            workItems = claimResult.success ? claimResult.data ?? [] : [];

            if (workItems.length === 0) {
              console.log('Still no work items after generation, stopping');
              break;
            }
          }
        }

        // Log batch info
        const agentTypes = workItems.map(w => w.agentType).join(', ');
        console.log(`\n▶ Processing batch of ${workItems.length} items: [${agentTypes}]`);

        // Create iteration records for each work item in the batch
        const iterationContexts: Array<{ iterationId: string; workItem: WorkItem }> = [];
        for (const workItem of workItems) {
          iterationNumber++;
          const iterationId = uuid();

          const startIterResult = await handleStartIteration(
            createStartIterationCommand({
              id: iterationId,
              processingRunId,
              iterationNumber,
            }),
            this.repos
          );

          if (startIterResult.success) {
            // Update iteration with work item details
            await handleUpdateIterationWorkItem(
              createUpdateIterationWorkItemCommand(iterationId, {
                workItemId: workItem.id,
                agentType: workItem.agentType,
              }),
              this.repos
            );
            iterationContexts.push({ iterationId, workItem });
          } else {
            console.error(`Failed to start iteration: ${startIterResult.error}`);
          }
        }

        // Execute all work items in parallel
        const results = await Promise.allSettled(
          iterationContexts.map(async ({ iterationId, workItem }) => {
            const result = await this.executeWorkItem(workItem, repoId, wikiId);
            return { iterationId, workItem, result };
          })
        );

        // Process results and update iteration records
        for (const settledResult of results) {
          if (settledResult.status === 'fulfilled') {
            const { iterationId, result } = settledResult.value;

            if (result.success) {
              await handleCompleteIteration(
                createCompleteIterationCommand(iterationId, {
                  agentRunId: result.agentRunId!,
                  durationMs: result.durationMs,
                  costUsd: result.cost,
                  pagesCreated: result.pagesCreated,
                  pagesUpdated: result.pagesUpdated,
                }),
                this.repos
              );
              summary.successful++;
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
          } else {
            // Promise rejected - unexpected error
            console.error(`Unexpected error in parallel execution: ${settledResult.reason}`);
            summary.failed++;
            summary.iterations++;
          }
        }

        // Update processing run progress via CQRS command
        await handleUpdateProcessingProgress(
          createUpdateProcessingProgressCommand(processingRunId, {
            completedIterations: summary.iterations,
            successfulIterations: summary.successful,
            failedIterations: summary.failed,
            totalCostUsd: summary.totalCost,
            wikiPagesCreated: summary.wikiPagesCreated,
            wikiPagesUpdated: summary.wikiPagesUpdated,
          }),
          this.repos
        );
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
   * Trigger an asynchronous refill of the work queue.
   * Runs in the background while execution continues.
   * Requests enough items to reach the high water mark.
   */
  private triggerAsyncRefill(repoId: string, wikiId: string, currentPending: number): void {
    if (this.refillInProgress) return;

    this.refillInProgress = true;

    // Calculate how many items to request to reach high water mark
    const itemsToRequest = Math.max(10, QUEUE_HIGH_WATER_MARK - currentPending);
    console.log(`🔄 Triggering async queue refill (requesting ${itemsToRequest} items)...`);

    this.refillPromise = this.orchestrator
      .generateWorkList(repoId, wikiId, itemsToRequest)
      .then(async (newWork) => {
        if (newWork.length > 0) {
          await handleSaveWorkItems(
            createSaveWorkItemsCommand(newWork),
            this.repos
          );
          console.log(`🔄 Async refill complete: ${newWork.length} items added (target was ${itemsToRequest})`);
        } else {
          console.log('🔄 Async refill complete: no new work generated');
        }
      })
      .catch((err) => {
        console.error('🔄 Async refill failed:', err);
      })
      .finally(() => {
        this.refillInProgress = false;
        this.refillPromise = null;
      });
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

    // Extract target info using helpers
    const targetCommitId = getTargetCommitId(workItem);
    const targetPath = getTargetPath(workItem);

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

    // Look up the repo entity for the agent context
    const repo = await this.repos.repos.findById(repoId);

    // Create repository service if factory is available
    const repoService = repo && this.repoServiceFactory
      ? this.repoServiceFactory.getService(repo)
      : undefined;

    // Build agent context, only including optional properties if they have values
    const context: AgentContext = {
      repoId,
      wikiId,
      repos: this.repos,
      git: this.git,
      llm: this.llm,
      ...(repoService && { repoService }),
      ...(repo && { repo }),
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

        if (shouldQueueEdits) {
          // Route analysis agent updates through EditRequest queue
          // This enables the WikiEditorAgent to handle out-of-order commits intelligently
          const editRequestParams: Parameters<typeof createEditRequest>[0] = {
            id: uuid(),
            repoId,
            wikiId,
            sourceCommitSha: commitData!.sha,
            sourceCommitTimestamp: commitData!.committedAt,
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
