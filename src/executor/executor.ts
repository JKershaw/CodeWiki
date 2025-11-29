import { v4 as uuid } from 'uuid';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { Agent, AgentContext } from '../agents/base-agent.js';
import type { WorkItem } from '../domain/work-item.js';
import { Orchestrator } from '../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';
import { CodeChangeAgent } from '../agents/analysis/code-change-agent.js';
import { NarrativeAgent } from '../agents/analysis/narrative-agent.js';
import { SecurityAgent } from '../agents/analysis/security-agent.js';
import { TechnicalDebtAgent } from '../agents/analysis/technical-debt-agent.js';
import { PatternAgent } from '../agents/analysis/pattern-agent.js';
import { DependencyAgent } from '../agents/analysis/dependency-agent.js';
import { LinkAgent } from '../agents/meta/link-agent.js';
import { StructureAgent } from '../agents/meta/structure-agent.js';
import { QualityAgent } from '../agents/meta/quality-agent.js';
import { ConsistencyAgent } from '../agents/meta/consistency-agent.js';
import { OverviewAgent } from '../agents/synthesis/overview-agent.js';
import { WriterAgent } from '../agents/synthesis/writer-agent.js';
import { ProjectOverviewAgent } from '../agents/synthesis/project-overview-agent.js';
import { GettingStartedAgent } from '../agents/synthesis/getting-started-agent.js';
import { BootstrapAgent } from '../agents/synthesis/bootstrap-agent.js';

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
  createSkipIterationCommand,
  handleSkipIteration,
} from '../commands/iteration.js';
import {
  createClaimWorkItemCommand,
  handleClaimWorkItem,
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

/**
 * Executor - The inner loop that runs agents from the work queue.
 *
 * Takes work items and fires off agents, respecting throttle limits.
 * When the work list is exhausted, it triggers the orchestrator again.
 *
 * All state changes flow through CQRS commands for clean separation.
 */
export class Executor {
  private agents: Map<string, Agent> = new Map();
  private running = false;
  private shouldStop = false;

  constructor(
    private readonly repos: Repositories,
    private readonly git: GitService,
    private readonly llm: LLMService,
    private readonly orchestrator: Orchestrator
  ) {
    // Register built-in analysis agents
    this.registerAgent(new CodeChangeAgent());
    this.registerAgent(new NarrativeAgent());
    this.registerAgent(new SecurityAgent());
    this.registerAgent(new TechnicalDebtAgent());
    this.registerAgent(new PatternAgent());
    this.registerAgent(new DependencyAgent());

    // Register meta agents
    this.registerAgent(new LinkAgent());
    this.registerAgent(new StructureAgent());
    this.registerAgent(new QualityAgent());
    this.registerAgent(new ConsistencyAgent());

    // Register synthesis agents
    this.registerAgent(new OverviewAgent());
    this.registerAgent(new WriterAgent());
    this.registerAgent(new ProjectOverviewAgent());
    this.registerAgent(new GettingStartedAgent());
    this.registerAgent(new BootstrapAgent());
  }

  /**
   * Register an agent for execution.
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.type, agent);
  }

  /**
   * Run a fixed number of iterations.
   * Each iteration processes one work item.
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
      for (let i = 0; i < iterations && !this.shouldStop; i++) {
        const iterationNumber = i + 1;

        // Create an iteration record (via CQRS command)
        const iterationId = uuid();
        const startIterResult = await handleStartIteration(
          createStartIterationCommand({
            id: iterationId,
            processingRunId,
            iterationNumber,
          }),
          this.repos
        );

        if (!startIterResult.success) {
          console.error(`Failed to start iteration: ${startIterResult.error}`);
          continue;
        }

        // Check rate limits
        if (this.llm.isRateLimited()) {
          console.log('Rate limited, waiting...');
          await handleSkipIteration(
            createSkipIterationCommand(iterationId, 'Rate limited'),
            this.repos
          );
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Get work to do (work queue is per-repo) via CQRS command
        let claimResult = await handleClaimWorkItem(
          createClaimWorkItemCommand(repoId),
          this.repos
        );
        let workItem = claimResult.success ? claimResult.data : null;

        // If no work, generate more
        if (!workItem) {
          // Show orchestrator status while generating work (can take time with LLM)
          await handleUpdateIterationWorkItem(
            createUpdateIterationWorkItemCommand(iterationId, {
              workItemId: 'orchestrating',
              agentType: 'orchestrator',
            }),
            this.repos
          );

          const newWork = await this.orchestrator.generateWorkList(repoId, wikiId, 10);
          if (newWork.length === 0) {
            console.log('No more work to do');
            await handleSkipIteration(
              createSkipIterationCommand(iterationId, 'No more work available'),
              this.repos
            );
            break;
          }

          // Save new work items via CQRS command
          await handleSaveWorkItems(
            createSaveWorkItemsCommand(newWork),
            this.repos
          );

          // Try claiming again
          claimResult = await handleClaimWorkItem(
            createClaimWorkItemCommand(repoId),
            this.repos
          );
          workItem = claimResult.success ? claimResult.data : null;

          if (!workItem) {
            await handleSkipIteration(
              createSkipIterationCommand(iterationId, 'No work item claimed'),
              this.repos
            );
            break;
          }
        }

        // Update iteration with work item details via CQRS command
        await handleUpdateIterationWorkItem(
          createUpdateIterationWorkItemCommand(iterationId, {
            workItemId: workItem.id,
            agentType: workItem.agentType,
          }),
          this.repos
        );

        // Execute the work item
        const result = await this.executeWorkItem(workItem, repoId, wikiId);

        // Update iteration with results via CQRS command
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

      // If stopped manually, mark as stopped via CQRS command
      if (this.shouldStop) {
        await handleStopProcessingRun(
          createStopProcessingRunCommand(processingRunId),
          this.repos
        );
      }
    }

    return summary;
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
    const agent = this.agents.get(workItem.agentType);
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

    // Translate SHA to internal commit ID if we have a target commit
    // The orchestrator returns Git SHAs, but agents expect internal UUIDs
    let internalCommitId: string | undefined;
    if (workItem.targetCommitId) {
      const commit = await this.repos.commits.findBySha(repoId, workItem.targetCommitId);
      if (!commit) {
        const errorMsg = `Commit not found for SHA: ${workItem.targetCommitId}`;
        console.error(errorMsg);
        // Fail work item via CQRS command
        await handleFailWorkItem(
          createFailWorkItemCommand(workItem.id),
          this.repos
        );
        return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0, durationMs: 0, agentRunId: null, error: errorMsg };
      }
      internalCommitId = commit.id;
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

    const context: AgentContext = {
      repoId,
      wikiId,
      repos: this.repos,
      git: this.git,
      llm: this.llm,
    };

    const startTime = Date.now();

    try {
      let result;

      if (internalCommitId) {
        result = await agent.runOnCommit(internalCommitId, context);
      } else if (agent.runOnWiki) {
        result = await agent.runOnWiki(context);
      } else {
        throw new Error(`Agent ${agent.type} cannot run without a commit target`);
      }

      const durationMs = Date.now() - startTime;

      // Complete the agent run via CQRS command
      await handleCompleteAgentRun(
        createCompleteAgentRunCommand(agentRunId, result.result, durationMs, result.costUsd),
        this.repos
      );

      // Process wiki updates via CQRS command
      let pagesCreated = 0;
      let pagesUpdated = 0;

      for (const update of result.updates) {
        update.agentRunId = agentRunId;

        // Use UpdateWikiPage CQRS command
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
      console.error(`Target Commit: ${workItem.targetCommitId ?? 'N/A (wiki-level agent)'}`);
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
  orchestrator: Orchestrator
): Executor {
  return new Executor(repos, git, llm, orchestrator);
}
