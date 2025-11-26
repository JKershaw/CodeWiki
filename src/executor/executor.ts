import { v4 as uuid } from 'uuid';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { Agent, AgentContext } from '../agents/base-agent.js';
import type { WorkItem } from '../domain/work-item.js';
import { createAgentRun, type AgentRun } from '../domain/agent-run.js';
import { Orchestrator } from '../agents/orchestrator/orchestrator.js';
import { CodeChangeAgent } from '../agents/analysis/code-change-agent.js';
import { NarrativeAgent } from '../agents/analysis/narrative-agent.js';
import { SecurityAgent } from '../agents/analysis/security-agent.js';
import { PatternAgent } from '../agents/analysis/pattern-agent.js';
import { DependencyAgent } from '../agents/analysis/dependency-agent.js';
import { LinkAgent } from '../agents/meta/link-agent.js';
import { StructureAgent } from '../agents/meta/structure-agent.js';

/**
 * Executor - The inner loop that runs agents from the work queue.
 *
 * Takes work items and fires off agents, respecting throttle limits.
 * When the work list is exhausted, it triggers the orchestrator again.
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
    this.registerAgent(new PatternAgent());
    this.registerAgent(new DependencyAgent());

    // Register meta agents
    this.registerAgent(new LinkAgent());
    this.registerAgent(new StructureAgent());
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
      iterations: 0,
      successful: 0,
      failed: 0,
      totalCost: 0,
      wikiPagesCreated: 0,
      wikiPagesUpdated: 0,
    };

    this.running = true;
    this.shouldStop = false;

    try {
      for (let i = 0; i < iterations && !this.shouldStop; i++) {
        // Check rate limits
        if (this.llm.isRateLimited()) {
          console.log('Rate limited, waiting...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        // Get work to do
        let workItem = await this.repos.workQueue.claimNext(repoId);

        // If no work, generate more
        if (!workItem) {
          const newWork = await this.orchestrator.generateWorkList(repoId, 10);
          if (newWork.length === 0) {
            console.log('No more work to do');
            break;
          }

          await this.repos.workQueue.saveMany(newWork);
          workItem = await this.repos.workQueue.claimNext(repoId);

          if (!workItem) {
            break;
          }
        }

        // Execute the work item
        const result = await this.executeWorkItem(workItem, repoId);

        summary.iterations++;
        if (result.success) {
          summary.successful++;
          summary.totalCost += result.cost;
          summary.wikiPagesCreated += result.pagesCreated;
          summary.wikiPagesUpdated += result.pagesUpdated;
        } else {
          summary.failed++;
        }
      }
    } finally {
      this.running = false;
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
    repoId: string
  ): Promise<WorkItemResult> {
    const agent = this.agents.get(workItem.agentType);
    if (!agent) {
      console.error(`Unknown agent type: ${workItem.agentType}`);
      await this.repos.workQueue.fail(workItem.id);
      return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0 };
    }

    // Create agent run record
    const agentRun = createAgentRun({
      id: uuid(),
      repoId,
      agentType: workItem.agentType,
      ...(workItem.targetCommitId ? { targetCommitId: workItem.targetCommitId } : {}),
    });
    agentRun.status = 'running';
    await this.repos.agentRuns.save(agentRun);

    const context: AgentContext = {
      repoId,
      repos: this.repos,
      git: this.git,
      llm: this.llm,
    };

    const startTime = Date.now();

    try {
      let result;

      if (workItem.targetCommitId) {
        result = await agent.runOnCommit(workItem.targetCommitId, context);
      } else if (agent.runOnWiki) {
        result = await agent.runOnWiki(context);
      } else {
        throw new Error(`Agent ${agent.type} cannot run without a commit target`);
      }

      const durationMs = Date.now() - startTime;

      // Complete the agent run
      await this.repos.agentRuns.complete(
        agentRun.id,
        result.result,
        durationMs,
        result.costUsd
      );

      // Process wiki updates
      let pagesCreated = 0;
      let pagesUpdated = 0;

      for (const update of result.updates) {
        update.agentRunId = agentRun.id;

        const existingPage = await this.repos.wikiPages.findByPath(repoId, update.path);

        if (existingPage) {
          await this.repos.wikiPages.updateContent(existingPage.id, {
            content: update.type === 'merge'
              ? `${existingPage.content}\n\n---\n\n${update.content}`
              : update.content,
            confidence: Math.min(1, existingPage.confidence + update.confidenceDelta),
            sourceCommitId: update.sourceCommitId,
          });
          pagesUpdated++;
        } else {
          const { createWikiPage } = await import('../domain/wiki-page.js');
          const newPage = createWikiPage({
            id: uuid(),
            repoId,
            path: update.path,
            title: extractTitle(update.content),
            content: update.content,
            sourceCommitId: update.sourceCommitId,
          });
          await this.repos.wikiPages.save(newPage);
          pagesCreated++;
        }
      }

      // Mark commit as processed
      if (workItem.targetCommitId) {
        await this.repos.commits.addProcessingRecord(workItem.targetCommitId, {
          agentType: agent.type,
          agentRunId: agentRun.id,
          processedAt: new Date(),
        });
      }

      // Complete the work item
      await this.repos.workQueue.complete(workItem.id, agentRun.id);

      console.log(`✓ ${agent.type} completed (${durationMs}ms, $${result.costUsd.toFixed(4)})`);

      return {
        success: true,
        cost: result.costUsd,
        pagesCreated,
        pagesUpdated,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.repos.agentRuns.fail(agentRun.id, errorMessage, durationMs);
      await this.repos.workQueue.fail(workItem.id);

      console.error(`✗ ${agent.type} failed: ${errorMessage}`);

      return { success: false, cost: 0, pagesCreated: 0, pagesUpdated: 0 };
    }
  }
}

interface WorkItemResult {
  success: boolean;
  cost: number;
  pagesCreated: number;
  pagesUpdated: number;
}

export interface ExecutionSummary {
  iterations: number;
  successful: number;
  failed: number;
  totalCost: number;
  wikiPagesCreated: number;
  wikiPagesUpdated: number;
}

/**
 * Extract title from markdown content.
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1]! : 'Untitled';
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
