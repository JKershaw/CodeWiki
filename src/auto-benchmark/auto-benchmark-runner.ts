/**
 * Auto-Benchmark Runner - Orchestrates multi-cycle benchmark runs.
 *
 * Runs multiple cycles of wiki generation iterations followed by benchmark
 * evaluations, persisting state server-side to survive page refreshes
 * and server restarts.
 */

import type { Repositories } from '../repositories/index.js';
import {
  createAutoBenchmarkRun,
  type AutoBenchmarkConfig,
  type AutoBenchmarkPhase,
} from '../domain/auto-benchmark.js';

/**
 * Dependencies for the AutoBenchmarkRunner.
 * These are injected to allow testing with mocks.
 */
export interface AutoBenchmarkDependencies {
  repos: Repositories;
  /** Run wiki generation iterations */
  runIterations: (repoId: string, iterations: number) => Promise<void>;
  /** Run accuracy benchmark */
  runAccuracyBenchmark: (repoId: string, wikiId: string) => Promise<void>;
  /** Run quality benchmark */
  runQualityBenchmark: (repoId: string, wikiId: string) => Promise<void>;
}

/**
 * Orchestrates multi-cycle benchmark runs server-side.
 */
export class AutoBenchmarkRunner {
  constructor(private readonly deps: AutoBenchmarkDependencies) {}

  /**
   * Run an auto-benchmark with the given configuration.
   *
   * @param runId - Pre-generated ID for the run
   * @param repoId - Repository ID
   * @param wikiId - Wiki ID
   * @param config - Auto-benchmark configuration
   */
  async run(
    runId: string,
    repoId: string,
    wikiId: string,
    config: AutoBenchmarkConfig
  ): Promise<void> {
    // Create and save the run record
    const run = createAutoBenchmarkRun({
      id: runId,
      repoId,
      wikiId,
      config,
    });
    await this.deps.repos.autoBenchmarks.save(run);

    try {
      for (let cycle = 1; cycle <= config.maxCycles; cycle++) {
        // Check if stopped before each cycle
        if (await this.isStopped(runId)) {
          console.log(`[AutoBenchmark] Run ${runId} stopped before cycle ${cycle}`);
          return;
        }

        // Phase 1: Run iterations
        await this.updateProgress(runId, cycle, 'iterations');
        console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running ${config.iterationsPerCycle} iterations`);
        await this.deps.runIterations(repoId, config.iterationsPerCycle);

        // Check if stopped after iterations
        if (await this.isStopped(runId)) {
          console.log(`[AutoBenchmark] Run ${runId} stopped after iterations in cycle ${cycle}`);
          return;
        }

        // Phase 2: Run accuracy benchmark
        await this.updateProgress(runId, cycle, 'accuracy');
        console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running accuracy benchmark`);
        await this.deps.runAccuracyBenchmark(repoId, wikiId);

        // Check if stopped after accuracy benchmark
        if (await this.isStopped(runId)) {
          console.log(`[AutoBenchmark] Run ${runId} stopped after accuracy benchmark in cycle ${cycle}`);
          return;
        }

        // Phase 3: Run quality benchmark (if enabled)
        if (config.includeQuality) {
          await this.updateProgress(runId, cycle, 'quality');
          console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running quality benchmark`);
          await this.deps.runQualityBenchmark(repoId, wikiId);

          // Check if stopped after quality benchmark
          if (await this.isStopped(runId)) {
            console.log(`[AutoBenchmark] Run ${runId} stopped after quality benchmark in cycle ${cycle}`);
            return;
          }
        }
      }

      // Mark as completed
      await this.deps.repos.autoBenchmarks.complete(runId);
      console.log(`[AutoBenchmark] Run ${runId} completed successfully`);
    } catch (error) {
      // Mark as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deps.repos.autoBenchmarks.fail(runId, errorMessage);
      console.error(`[AutoBenchmark] Run ${runId} failed: ${errorMessage}`);
    }
  }

  /**
   * Resume from a specific cycle and phase.
   * Used when recovering from server restart.
   */
  async resumeFromState(
    runId: string,
    repoId: string,
    wikiId: string,
    config: AutoBenchmarkConfig,
    startCycle: number,
    startPhase: AutoBenchmarkPhase
  ): Promise<void> {
    try {
      // Determine where to start based on phase
      let skipIterations = false;
      let skipAccuracy = false;

      if (startPhase === 'accuracy') {
        skipIterations = true;
      } else if (startPhase === 'quality') {
        skipIterations = true;
        skipAccuracy = true;
      }

      for (let cycle = startCycle; cycle <= config.maxCycles; cycle++) {
        // Check if stopped before each cycle
        if (await this.isStopped(runId)) {
          console.log(`[AutoBenchmark] Run ${runId} stopped before cycle ${cycle}`);
          return;
        }

        // Phase 1: Run iterations (skip if resuming mid-cycle)
        if (!skipIterations) {
          await this.updateProgress(runId, cycle, 'iterations');
          console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running ${config.iterationsPerCycle} iterations`);
          await this.deps.runIterations(repoId, config.iterationsPerCycle);

          if (await this.isStopped(runId)) return;
        }
        skipIterations = false; // Only skip for first cycle

        // Phase 2: Run accuracy benchmark (skip if resuming mid-cycle)
        if (!skipAccuracy) {
          await this.updateProgress(runId, cycle, 'accuracy');
          console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running accuracy benchmark`);
          await this.deps.runAccuracyBenchmark(repoId, wikiId);

          if (await this.isStopped(runId)) return;
        }
        skipAccuracy = false; // Only skip for first cycle

        // Phase 3: Run quality benchmark (if enabled)
        if (config.includeQuality) {
          await this.updateProgress(runId, cycle, 'quality');
          console.log(`[AutoBenchmark] Cycle ${cycle}/${config.maxCycles}: Running quality benchmark`);
          await this.deps.runQualityBenchmark(repoId, wikiId);

          if (await this.isStopped(runId)) return;
        }
      }

      // Mark as completed
      await this.deps.repos.autoBenchmarks.complete(runId);
      console.log(`[AutoBenchmark] Run ${runId} completed successfully (resumed)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deps.repos.autoBenchmarks.fail(runId, errorMessage);
      console.error(`[AutoBenchmark] Run ${runId} failed (resumed): ${errorMessage}`);
    }
  }

  /**
   * Resume all incomplete auto-benchmark runs.
   * Called on server startup to recover from restart.
   */
  async resumeIncomplete(): Promise<void> {
    const running = await this.deps.repos.autoBenchmarks.findAllRunning();
    console.log(`[AutoBenchmark] Found ${running.length} incomplete runs to resume`);

    for (const run of running) {
      console.log(`[AutoBenchmark] Resuming run ${run.id} from cycle ${run.currentCycle}, phase ${run.currentPhase}`);

      // Don't await - run in background
      this.resumeFromState(
        run.id,
        run.repoId,
        run.wikiId,
        run.config,
        run.currentCycle,
        run.currentPhase
      ).catch(error => {
        console.error(`[AutoBenchmark] Failed to resume run ${run.id}: ${error}`);
      });
    }
  }

  /**
   * Check if the run has been stopped.
   */
  private async isStopped(runId: string): Promise<boolean> {
    const run = await this.deps.repos.autoBenchmarks.findById(runId);
    return run?.status === 'stopped';
  }

  /**
   * Update progress for a run.
   */
  private async updateProgress(
    runId: string,
    cycle: number,
    phase: AutoBenchmarkPhase
  ): Promise<void> {
    await this.deps.repos.autoBenchmarks.updateProgress(runId, cycle, phase);
  }
}
