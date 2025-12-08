/**
 * Benchmark Runner - Executes benchmark evaluations in parallel.
 *
 * Runs all benchmark questions simultaneously, collecting results
 * and generating a summary of wiki quality.
 */

import { randomUUID } from 'crypto';
import type { Repositories } from '../repositories/index.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { GitService } from '../services/git/git-service.js';
import type { RepositoryServiceFactory } from '../services/repository/repository-service.js';
import {
  createUnifiedRepoAccessFactory,
  type UnifiedRepoAccessFactory,
} from '../services/repository/unified-repo-access.js';
import { ResearchAgent } from '../agents/research/research-agent.js';
import { GraderAgent, type GradeContext } from './grader-agent.js';
import { loadQuestions, loadQuestionsByIds } from './question-loader.js';
import {
  handleStartBenchmark,
  handleCompleteBenchmark,
  handleFailBenchmark,
  createStartBenchmarkCommand,
  createCompleteBenchmarkCommand,
  createFailBenchmarkCommand,
} from '../commands/benchmark.js';
import type {
  BenchmarkQuestion,
  BenchmarkResult,
  BenchmarkRun,
} from '../domain/benchmark.js';
import {
  startAccuracyTracking,
  recordAccuracyResult,
  clearAccuracyTracking,
} from './benchmark-progress.js';

/**
 * Options for running a benchmark.
 */
export interface BenchmarkOptions {
  /** Specific question IDs to run (default: all) */
  questionIds?: string[];
  /** Maximum concurrent evaluations (default: 5) */
  maxConcurrency?: number;
}

/**
 * Benchmark Runner that evaluates wiki quality.
 */
export class BenchmarkRunner {
  private readonly research: ResearchAgent;
  private readonly grader: GraderAgent;
  private readonly repoAccessFactory?: UnifiedRepoAccessFactory;

  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService,
    private readonly git: GitService,
    private readonly repoServiceFactory?: RepositoryServiceFactory
  ) {
    this.research = new ResearchAgent(repos, llm);
    this.grader = new GraderAgent(llm);

    // Create unified repo access factory if we have the required dependencies
    if (repoServiceFactory) {
      this.repoAccessFactory = createUnifiedRepoAccessFactory({
        repos,
        repoServiceFactory,
        gitService: git,
      });
    }
  }

  /**
   * Run a benchmark evaluation.
   */
  async run(
    repoId: string,
    wikiId: string,
    options: BenchmarkOptions = {}
  ): Promise<BenchmarkRun> {
    const runId = randomUUID();

    try {
      // Get repo name for loading questions
      const repo = await this.repos.repos.findById(repoId);
      console.log(`[Benchmark] Repo lookup: ${repo ? `found ${repo.fullName}` : 'NOT FOUND'}`);
      if (repo) {
        console.log(`[Benchmark] Repo details - isGitHubRepo: ${repo.isGitHubRepo}, owner: ${repo.owner ?? 'NOT SET'}, repoName: ${repo.repoName ?? 'NOT SET'}, userId: ${repo.userId ?? 'NOT SET'}`);
      }
      const repoName = repo?.fullName?.split('/').pop();

      // Load questions (repo-specific or default fallback)
      const questions = options.questionIds?.length
        ? await loadQuestionsByIds(options.questionIds, repoName)
        : await loadQuestions(repoName);

      if (questions.length === 0) {
        throw new Error('No benchmark questions found');
      }

      // Get current iteration count from wiki
      const iterationCount = await this.getIterationCount(wikiId);

      // Get current page count from wiki
      const pageCount = await this.getPageCount(wikiId);

      // Build grading context using unified repo access
      let gradeContext: GradeContext | null = null;
      if (this.repoAccessFactory) {
        try {
          const repoAccess = await this.repoAccessFactory.create(repoId);
          gradeContext = { repoAccess };
          console.log(`[Benchmark] Created unified repo access (isLocal: ${repoAccess.isLocal()})`);
        } catch (err) {
          console.warn(`[Benchmark] Failed to create unified repo access: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!gradeContext) {
        throw new Error('Unable to access repository for benchmarking. No repository access factory available.');
      }

      // Start benchmark run
      const startResult = await handleStartBenchmark(
        createStartBenchmarkCommand({
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
      startAccuracyTracking(runId, repoId, wikiId, questions.length);

      // Execute all questions in parallel with concurrency limit
      const maxConcurrency = options.maxConcurrency ?? 15;
      const results = await this.executeQuestionsParallel(
        runId,
        questions,
        wikiId,
        gradeContext,
        maxConcurrency
      );

      // Calculate total cost
      const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

      // Complete the benchmark
      await handleCompleteBenchmark(
        createCompleteBenchmarkCommand({
          benchmarkId: runId,
          results,
          questions,
          totalCostUsd,
        }),
        this.repos
      );

      // Clear in-memory progress tracking
      clearAccuracyTracking(runId);

      // Fetch and return the completed run
      const completedRun = await this.repos.benchmarks.findById(runId);
      if (!completedRun) {
        throw new Error('Failed to retrieve completed benchmark run');
      }

      return completedRun;
    } catch (error) {
      // Clear in-memory progress tracking
      clearAccuracyTracking(runId);

      // Mark benchmark as failed
      await handleFailBenchmark(
        createFailBenchmarkCommand(runId, String(error)),
        this.repos
      );

      throw error;
    }
  }

  /**
   * Execute questions in parallel with concurrency limit.
   */
  private async executeQuestionsParallel(
    runId: string,
    questions: BenchmarkQuestion[],
    wikiId: string,
    gradeContext: GradeContext,
    maxConcurrency: number
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const pending = [...questions];
    const inProgress: Promise<void>[] = [];

    const executeOne = async (question: BenchmarkQuestion): Promise<void> => {
      let result: BenchmarkResult;
      try {
        result = await this.evaluateQuestion(question, wikiId, gradeContext);
      } catch (error) {
        // Create a failed result for this question
        result = {
          questionId: question.id,
          wikiAnswer: '',
          grade: 'no_answer',
          confidence: 0,
          reasoning: `Evaluation failed: ${error}`,
          codeReferences: [],
          durationMs: 0,
          costUsd: 0,
        };
      }
      results.push(result);
      // Record progress for live updates
      recordAccuracyResult(runId, result);
    };

    // Process questions with concurrency limit
    while (pending.length > 0 || inProgress.length > 0) {
      // Start new tasks up to concurrency limit
      while (pending.length > 0 && inProgress.length < maxConcurrency) {
        const question = pending.shift()!;
        const promise = executeOne(question).then(() => {
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
   * Evaluate a single question.
   */
  private async evaluateQuestion(
    question: BenchmarkQuestion,
    wikiId: string,
    gradeContext: GradeContext
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();

    // Ask the wiki
    const researchResult = await this.research.query(wikiId, question.question);

    // Grade the answer
    const gradeResult = await this.grader.grade(
      question,
      researchResult.answer,
      gradeContext
    );

    const durationMs = Date.now() - startTime;
    const costUsd = (researchResult.costUsd ?? 0) + gradeResult.costUsd;

    return {
      questionId: question.id,
      wikiAnswer: researchResult.answer,
      grade: gradeResult.grade,
      confidence: gradeResult.confidence,
      reasoning: gradeResult.reasoning,
      codeReferences: gradeResult.filesChecked,
      durationMs,
      costUsd,
    };
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

  /**
   * Get the current page count for a wiki.
   */
  private async getPageCount(wikiId: string): Promise<number> {
    const pages = await this.repos.wikiPages.findByWiki(wikiId);
    return pages.length;
  }
}

/**
 * Create a benchmark runner instance.
 */
export function createBenchmarkRunner(
  repos: Repositories,
  llm: LLMService,
  git: GitService,
  repoServiceFactory?: RepositoryServiceFactory
): BenchmarkRunner {
  return new BenchmarkRunner(repos, llm, git, repoServiceFactory);
}
