/**
 * QualityPhaseRunner - Runs meta agents for wiki quality improvement.
 *
 * This phase runs after synthesis to improve wiki quality:
 * - Link agent: Cross-references between pages
 * - Quality agent: Content quality review
 * - Consistency agent: Cross-page consistency check
 * - Consolidation: Address any issues found
 *
 * By running after all content exists, these agents have
 * full context to make better suggestions.
 */

import type { PhaseRunner, PhaseContext, PhaseResult } from '../pipeline-manager.js';

/**
 * Result from running a meta agent.
 */
export interface MetaAgentResult {
  success: boolean;
  costUsd: number;
  pagesCreated: number;
  pagesUpdated: number;
  findingsCount?: number;
  error?: string;
}

/**
 * Meta agent types in order of execution.
 */
export const META_AGENTS = [
  'link',
  'quality',
  'consistency',
  'consolidation',
] as const;

export type MetaAgentType = typeof META_AGENTS[number];

/**
 * Dependencies injected into the quality phase runner.
 */
export interface QualityDependencies {
  /**
   * Check if a meta agent has already run in this processing run.
   */
  hasAgentRunInSession: (agentType: MetaAgentType, processingRunId: string) => Promise<boolean>;

  /**
   * Run a meta agent.
   */
  runMetaAgent: (
    agentType: MetaAgentType,
    repoId: string,
    wikiId: string
  ) => Promise<MetaAgentResult>;

  /**
   * Update phase progress in the processing run.
   */
  updatePhaseProgress: (processingRunId: string, progress: number, target: number) => Promise<void>;

  /**
   * Check if there are pending findings to consolidate.
   */
  hasPendingFindings: (wikiId: string) => Promise<boolean>;
}

/**
 * Quality phase runner - improves wiki quality through meta agents.
 */
export class QualityPhaseRunner implements PhaseRunner {
  constructor(private readonly deps: QualityDependencies) {}

  /**
   * Run one iteration of the quality phase.
   * Runs the next meta agent that hasn't been run yet.
   */
  async run(context: PhaseContext): Promise<PhaseResult> {
    const { processingRunId, repoId, wikiId } = context;

    // Update phase target
    await this.deps.updatePhaseProgress(processingRunId, 0, META_AGENTS.length);

    // Find the next agent that hasn't run in this session
    let agentToRun: MetaAgentType | null = null;
    let completedCount = 0;

    for (const agent of META_AGENTS) {
      // Skip consolidation if no pending findings
      if (agent === 'consolidation') {
        const hasFindings = await this.deps.hasPendingFindings(wikiId);
        if (!hasFindings) {
          completedCount++;
          continue;
        }
      }

      const hasRun = await this.deps.hasAgentRunInSession(agent, processingRunId);
      if (hasRun) {
        completedCount++;
      } else if (!agentToRun) {
        agentToRun = agent;
      }
    }

    // Update progress
    await this.deps.updatePhaseProgress(processingRunId, completedCount, META_AGENTS.length);

    // If all agents have run, phase is complete
    if (!agentToRun) {
      return {
        completed: true,
        workItemsProcessed: 0,
        costUsd: 0,
        pagesCreated: 0,
        pagesUpdated: 0,
      };
    }

    // Run the agent
    const result = await this.deps.runMetaAgent(agentToRun, repoId, wikiId);

    // Check if all agents are now complete
    const allComplete = completedCount + 1 >= META_AGENTS.length;

    return {
      completed: allComplete,
      workItemsProcessed: 1,
      costUsd: result.costUsd,
      pagesCreated: result.pagesCreated,
      pagesUpdated: result.pagesUpdated,
    };
  }
}
