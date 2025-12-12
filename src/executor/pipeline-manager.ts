/**
 * PipelineManager - Orchestrates phased wiki generation.
 *
 * Instead of mixing all work types in a single queue, the PipelineManager
 * runs phases sequentially. Each phase completes before the next begins,
 * enabling focused, tree-like wiki growth.
 *
 * Phases:
 * 1. Bootstrap - Initial wiki setup
 * 2. Exploration - Document current codebase (depth-first)
 * 3. Synthesis - Create structural pages (overview, guides)
 * 4. Quality - Run meta agents (link, quality, consistency)
 * 5. History - Process historical commits (LLM orchestrator)
 * 6. Continuous - Ongoing improvement
 */

import type { Repositories } from '../repositories/index.js';
import type { ProcessingPhase } from '../domain/processing-run.js';
import { getNextPhase } from '../domain/processing-run.js';
import {
  createAdvancePhaseCommand,
  handleAdvancePhase,
  createUpdatePhaseProgressCommand,
  handleUpdatePhaseProgress,
} from '../commands/processing-run.js';

/**
 * Context passed to phase runners.
 */
export interface PhaseContext {
  processingRunId: string;
  repoId: string;
  wikiId: string;
  phase: ProcessingPhase;
  phaseProgress: number;
  phaseTarget: number | null;
}

/**
 * Result from running a phase.
 */
export interface PhaseResult {
  /** Whether the phase is complete and ready to advance */
  completed: boolean;
  /** Number of work items processed in this run */
  workItemsProcessed: number;
  /** LLM cost incurred */
  costUsd: number;
  /** Pages created */
  pagesCreated: number;
  /** Pages updated */
  pagesUpdated: number;
}

/**
 * Interface for phase-specific runners.
 * Each phase has its own runner that knows how to execute that phase's work.
 */
export interface PhaseRunner {
  run(context: PhaseContext): Promise<PhaseResult>;
}

/**
 * Options for running phases.
 */
export interface RunOptions {
  /** Maximum iterations before stopping (for safety) */
  maxIterations?: number;
}

/**
 * PipelineManager coordinates phase execution.
 */
export class PipelineManager {
  constructor(
    private readonly repos: Repositories,
    private readonly phaseRunners: Partial<Record<ProcessingPhase, PhaseRunner>>
  ) {}

  /**
   * Run a single iteration of the current phase.
   * Returns the result of the phase runner.
   */
  async runPhase(processingRunId: string): Promise<PhaseResult> {
    const run = await this.repos.processingRuns.findById(processingRunId);
    if (!run) {
      throw new Error(`Processing run not found: ${processingRunId}`);
    }

    const runner = this.phaseRunners[run.currentPhase];
    if (!runner) {
      // No runner for this phase - mark as complete
      return {
        completed: true,
        workItemsProcessed: 0,
        costUsd: 0,
        pagesCreated: 0,
        pagesUpdated: 0,
      };
    }

    const context: PhaseContext = {
      processingRunId,
      repoId: run.repoId,
      wikiId: run.wikiId,
      phase: run.currentPhase,
      phaseProgress: run.phaseProgress,
      phaseTarget: run.phaseTarget,
    };

    return runner.run(context);
  }

  /**
   * Run the current phase until it completes or hits the iteration limit.
   * Returns aggregated results from all iterations.
   */
  async runUntilPhaseComplete(
    processingRunId: string,
    options: RunOptions = {}
  ): Promise<PhaseResult> {
    const maxIterations = options.maxIterations ?? 1000;
    let iterations = 0;

    const aggregateResult: PhaseResult = {
      completed: false,
      workItemsProcessed: 0,
      costUsd: 0,
      pagesCreated: 0,
      pagesUpdated: 0,
    };

    while (iterations < maxIterations) {
      const result = await this.runPhase(processingRunId);

      // Aggregate results
      aggregateResult.workItemsProcessed += result.workItemsProcessed;
      aggregateResult.costUsd += result.costUsd;
      aggregateResult.pagesCreated += result.pagesCreated;
      aggregateResult.pagesUpdated += result.pagesUpdated;

      if (result.completed) {
        aggregateResult.completed = true;
        break;
      }

      iterations++;
    }

    return aggregateResult;
  }

  /**
   * Advance to the next phase in the pipeline.
   * Returns true if advanced, false if already at final phase.
   */
  async advanceToNextPhase(processingRunId: string): Promise<boolean> {
    const run = await this.repos.processingRuns.findById(processingRunId);
    if (!run) {
      throw new Error(`Processing run not found: ${processingRunId}`);
    }

    const nextPhase = getNextPhase(run.currentPhase);
    if (!nextPhase) {
      return false; // Already at final phase
    }

    const command = createAdvancePhaseCommand(processingRunId, nextPhase);
    const result = await handleAdvancePhase(command, this.repos);

    if (!result.success) {
      throw new Error(`Failed to advance phase: ${result.error}`);
    }

    return true;
  }

  /**
   * Get the current phase for a processing run.
   */
  async getCurrentPhase(processingRunId: string): Promise<ProcessingPhase> {
    const run = await this.repos.processingRuns.findById(processingRunId);
    if (!run) {
      throw new Error(`Processing run not found: ${processingRunId}`);
    }
    return run.currentPhase;
  }

  /**
   * Update phase progress.
   */
  async updatePhaseProgress(
    processingRunId: string,
    progress: number,
    target?: number
  ): Promise<void> {
    const command = createUpdatePhaseProgressCommand(processingRunId, progress, target);
    const result = await handleUpdatePhaseProgress(command, this.repos);

    if (!result.success) {
      throw new Error(`Failed to update phase progress: ${result.error}`);
    }
  }

  /**
   * Check if a phase runner is registered for a phase.
   */
  hasRunner(phase: ProcessingPhase): boolean {
    return !!this.phaseRunners[phase];
  }

  /**
   * Register a phase runner.
   */
  registerRunner(phase: ProcessingPhase, runner: PhaseRunner): void {
    this.phaseRunners[phase] = runner;
  }
}

/**
 * Create a PipelineManager instance.
 */
export function createPipelineManager(
  repos: Repositories,
  phaseRunners: Partial<Record<ProcessingPhase, PhaseRunner>> = {}
): PipelineManager {
  return new PipelineManager(repos, phaseRunners);
}
