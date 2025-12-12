/**
 * SynthesisPhaseRunner - Creates structural wiki pages.
 *
 * This phase runs after exploration to create:
 * - Project overview
 * - Getting started guide
 * - Category overviews
 * - Wiki index and table of contents
 *
 * These synthesis agents create navigation and structure
 * for the wiki content generated during exploration.
 */

import type { PhaseRunner, PhaseContext, PhaseResult } from '../pipeline-manager.js';

/**
 * Result from running a synthesis agent.
 */
export interface SynthesisResult {
  success: boolean;
  costUsd: number;
  pagesCreated: number;
  pagesUpdated: number;
  error?: string;
}

/**
 * Synthesis agent types in order of execution.
 */
export const SYNTHESIS_AGENTS = [
  'project-overview',
  'getting-started',
  'overview',        // Category overviews
  'wiki-index',
  'toc',
] as const;

export type SynthesisAgentType = typeof SYNTHESIS_AGENTS[number];

/**
 * Dependencies injected into the synthesis phase runner.
 */
export interface SynthesisDependencies {
  /**
   * Check if a synthesis agent has already run for this wiki.
   */
  hasAgentRun: (agentType: SynthesisAgentType, wikiId: string) => Promise<boolean>;

  /**
   * Run a synthesis agent.
   */
  runSynthesisAgent: (
    agentType: SynthesisAgentType,
    repoId: string,
    wikiId: string
  ) => Promise<SynthesisResult>;

  /**
   * Update phase progress in the processing run.
   */
  updatePhaseProgress: (processingRunId: string, progress: number, target: number) => Promise<void>;

  /**
   * Check if wiki has minimum pages to run synthesis (default: 3).
   */
  getWikiPageCount: (wikiId: string) => Promise<number>;
}

/**
 * Options for the synthesis phase runner.
 */
export interface SynthesisOptions {
  /** Minimum pages before running synthesis (default: 3) */
  minPagesForSynthesis?: number;
}

/**
 * Synthesis phase runner - creates structural wiki pages.
 */
export class SynthesisPhaseRunner implements PhaseRunner {
  private readonly minPages: number;

  constructor(
    private readonly deps: SynthesisDependencies,
    options: SynthesisOptions = {}
  ) {
    this.minPages = options.minPagesForSynthesis ?? 3;
  }

  /**
   * Run one iteration of the synthesis phase.
   * Runs the next synthesis agent that hasn't been run yet.
   */
  async run(context: PhaseContext): Promise<PhaseResult> {
    const { processingRunId, repoId, wikiId } = context;

    // Check if wiki has enough pages for synthesis
    const pageCount = await this.deps.getWikiPageCount(wikiId);
    if (pageCount < this.minPages) {
      // Not enough pages yet - skip synthesis
      return {
        completed: true,
        workItemsProcessed: 0,
        costUsd: 0,
        pagesCreated: 0,
        pagesUpdated: 0,
      };
    }

    // Update phase target
    await this.deps.updatePhaseProgress(processingRunId, 0, SYNTHESIS_AGENTS.length);

    // Find the next agent that hasn't run
    let agentToRun: SynthesisAgentType | null = null;
    let completedCount = 0;

    for (const agent of SYNTHESIS_AGENTS) {
      const hasRun = await this.deps.hasAgentRun(agent, wikiId);
      if (hasRun) {
        completedCount++;
      } else if (!agentToRun) {
        agentToRun = agent;
      }
    }

    // Update progress
    await this.deps.updatePhaseProgress(processingRunId, completedCount, SYNTHESIS_AGENTS.length);

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
    const result = await this.deps.runSynthesisAgent(agentToRun, repoId, wikiId);

    // Check if all agents are now complete
    const allComplete = completedCount + 1 >= SYNTHESIS_AGENTS.length;

    return {
      completed: allComplete,
      workItemsProcessed: 1,
      costUsd: result.costUsd,
      pagesCreated: result.pagesCreated,
      pagesUpdated: result.pagesUpdated,
    };
  }
}
