/**
 * Quality Benchmark Runner - Executes quality evaluations in parallel.
 *
 * Selects pages using heuristics + random sampling, then evaluates
 * each page in parallel across all quality dimensions.
 */

import { randomUUID } from 'crypto';
import type { Repositories } from '../repositories/index.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { WikiPage } from '../domain/wiki-page.js';
import {
  type PageQualityResult,
  type QualityBenchmarkRun,
  createEmptyPageResult,
} from '../domain/quality-benchmark.js';
import {
  handleStartQualityBenchmark,
  handleCompleteQualityBenchmark,
  handleFailQualityBenchmark,
  createStartQualityBenchmarkCommand,
  createCompleteQualityBenchmarkCommand,
  createFailQualityBenchmarkCommand,
} from '../commands/quality-benchmark.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../queries/index.js';
import {
  PageEvaluator,
  buildWikiContext,
} from './page-evaluator.js';
import {
  selectPagesForEvaluation,
  type PageSelectionOptions,
} from './page-selector.js';
import {
  startQualityTracking,
  recordQualityResult,
  clearQualityTracking,
} from '../benchmark/benchmark-progress.js';

/**
 * Options for running a quality benchmark.
 */
export interface QualityBenchmarkOptions {
  /** Page selection options */
  selection?: PageSelectionOptions;
  /** Maximum concurrent evaluations (default: 5) */
  maxConcurrency?: number;
}

/**
 * Quality Benchmark Runner that evaluates wiki quality.
 */
export class QualityBenchmarkRunner {
  private readonly evaluator: PageEvaluator;

  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService
  ) {
    this.evaluator = new PageEvaluator(llm);
  }

  /**
   * Run a quality benchmark evaluation.
   */
  async run(
    repoId: string,
    wikiId: string,
    options: QualityBenchmarkOptions = {}
  ): Promise<QualityBenchmarkRun> {
    const runId = randomUUID();

    try {
      // Load all wiki pages
      const pagesQuery = createListWikiPagesQuery(wikiId);
      const pagesResult = await handleListWikiPages(pagesQuery, this.repos);

      if (!pagesResult.success || !pagesResult.data) {
        throw new Error('Failed to load wiki pages');
      }

      const allPages = pagesResult.data;

      if (allPages.length === 0) {
        throw new Error('No pages in wiki to evaluate');
      }

      // Select pages for evaluation
      const selection = selectPagesForEvaluation(allPages, options.selection);

      if (selection.pages.length === 0) {
        throw new Error('No eligible pages for evaluation (all too short)');
      }

      // Get current iteration count from wiki
      const iterationCount = await this.getIterationCount(wikiId);

      // Page count is already known from allPages
      const pageCount = allPages.length;

      // Start benchmark run
      const startResult = await handleStartQualityBenchmark(
        createStartQualityBenchmarkCommand({
          id: runId,
          repoId,
          wikiId,
          iterationCount,
          pageCount,
        }),
        this.repos
      );

      if (!startResult.success) {
        throw new Error(startResult.error);
      }

      // Start in-memory progress tracking
      startQualityTracking(runId, repoId, wikiId, selection.pages.length);

      // Execute evaluations in parallel with concurrency limit
      const maxConcurrency = options.maxConcurrency ?? 5;
      const results = await this.evaluatePagesParallel(
        runId,
        selection.pages,
        allPages,
        maxConcurrency
      );

      // Calculate total cost
      const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

      // Complete the benchmark
      await handleCompleteQualityBenchmark(
        createCompleteQualityBenchmarkCommand({
          benchmarkId: runId,
          results,
          totalCostUsd,
        }),
        this.repos
      );

      // Clear in-memory progress tracking
      clearQualityTracking(runId);

      // Fetch and return the completed run
      const completedRun = await this.repos.qualityBenchmarks.findById(runId);
      if (!completedRun) {
        throw new Error('Failed to retrieve completed quality benchmark run');
      }

      return completedRun;
    } catch (error) {
      // Clear in-memory progress tracking
      clearQualityTracking(runId);

      // Mark benchmark as failed
      await handleFailQualityBenchmark(
        createFailQualityBenchmarkCommand(runId, String(error)),
        this.repos
      );

      throw error;
    }
  }

  /**
   * Evaluate pages in parallel with concurrency limit.
   */
  private async evaluatePagesParallel(
    runId: string,
    pagesToEvaluate: WikiPage[],
    allPages: WikiPage[],
    maxConcurrency: number
  ): Promise<PageQualityResult[]> {
    const results: PageQualityResult[] = [];
    const pending = [...pagesToEvaluate];
    const inProgress: Promise<void>[] = [];

    const evaluateOne = async (page: WikiPage): Promise<void> => {
      let result: PageQualityResult;
      try {
        const context = buildWikiContext(allPages, page);
        result = await this.evaluator.evaluate(page, context);
      } catch (error) {
        // Create a failed result for this page
        result = createEmptyPageResult(
          page.id,
          page.path,
          page.title,
          String(error)
        );
      }
      results.push(result);
      // Record progress for live updates
      recordQualityResult(runId, result);
    };

    // Process pages with concurrency limit
    while (pending.length > 0 || inProgress.length > 0) {
      // Start new tasks up to concurrency limit
      while (pending.length > 0 && inProgress.length < maxConcurrency) {
        const page = pending.shift()!;
        const promise = evaluateOne(page).then(() => {
          // Remove from inProgress when done
          const idx = inProgress.indexOf(promise);
          if (idx >= 0) inProgress.splice(idx, 1);
        });
        inProgress.push(promise);
      }

      // Wait for at least one to complete
      if (inProgress.length > 0) {
        await Promise.race(inProgress);
      }
    }

    return results;
  }

  /**
   * Get the cumulative iteration count for a wiki.
   */
  private async getIterationCount(wikiId: string): Promise<number> {
    const wiki = await this.repos.wikis.findById(wikiId);
    if (!wiki) {
      return 0;
    }

    return wiki.totalIterations ?? 0;
  }
}

/**
 * Create a quality benchmark runner instance.
 */
export function createQualityBenchmarkRunner(
  repos: Repositories,
  llm: LLMService
): QualityBenchmarkRunner {
  return new QualityBenchmarkRunner(repos, llm);
}
