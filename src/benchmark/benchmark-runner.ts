/**
 * Benchmark Runner - Executes benchmark evaluations in parallel.
 *
 * Runs all benchmark questions simultaneously, collecting results
 * and generating a summary of wiki quality.
 */

import { randomUUID } from 'crypto';
import { access } from 'fs/promises';
import type { Repositories } from '../repositories/index.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { GitService } from '../services/git/git-service.js';
import type { RepositoryServiceFactory, RepositoryService } from '../services/repository/repository-service.js';
import type { Repo } from '../domain/repo.js';
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

  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService,
    private readonly git: GitService,
    private readonly repoServiceFactory?: RepositoryServiceFactory
  ) {
    this.research = new ResearchAgent(repos, llm);
    this.grader = new GraderAgent(llm);
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

      // Build grading context - supports both local repos and GitHub repos
      const gradeContext = await this.buildGradeContext(repoId, repo);
      if (!gradeContext) {
        throw new Error('Unable to access repository for benchmarking. No local path or repository service available.');
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

      // Execute all questions in parallel with concurrency limit
      const maxConcurrency = options.maxConcurrency ?? 5;
      const results = await this.executeQuestionsParallel(
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

      // Fetch and return the completed run
      const completedRun = await this.repos.benchmarks.findById(runId);
      if (!completedRun) {
        throw new Error('Failed to retrieve completed benchmark run');
      }

      return completedRun;
    } catch (error) {
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
    questions: BenchmarkQuestion[],
    wikiId: string,
    gradeContext: GradeContext,
    maxConcurrency: number
  ): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const pending = [...questions];
    const inProgress: Promise<void>[] = [];

    const executeOne = async (question: BenchmarkQuestion): Promise<void> => {
      try {
        const result = await this.evaluateQuestion(question, wikiId, gradeContext);
        results.push(result);
      } catch (error) {
        // Create a failed result for this question
        results.push({
          questionId: question.id,
          wikiAnswer: '',
          grade: 'no_answer',
          confidence: 0,
          reasoning: `Evaluation failed: ${error}`,
          codeReferences: [],
          durationMs: 0,
          costUsd: 0,
        });
      }
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

  /**
   * Build the grading context for a repository.
   * Supports both local repos (via filesystem) and GitHub repos (via API).
   */
  private async buildGradeContext(repoId: string, repo: Repo | null): Promise<GradeContext | null> {
    // Try local filesystem first - but only if it's not a GitHub repo
    // and the path actually exists on the filesystem
    if (repo && !repo.isGitHubRepo) {
      try {
        const repoPath = this.git.getRepoPath(repoId);
        // Verify the path actually exists before using it
        await access(repoPath);
        console.log(`[Benchmark] Using local filesystem for grading: ${repoPath}`);
        return { repoPath };
      } catch (error) {
        // Path doesn't exist or isn't accessible
        console.log(`[Benchmark] Local path not accessible for repo ${repoId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (repo?.isGitHubRepo) {
      console.log(`[Benchmark] Repo ${repoId} is a GitHub repo, skipping local filesystem check`);
    }

    // Try GitHub API if we have a repo service factory and repo entity
    if (this.repoServiceFactory && repo) {
      console.log(`[Benchmark] Attempting GitHub API access for repo: ${repo.fullName} (isGitHubRepo: ${repo.isGitHubRepo}, userId: ${repo.userId ?? 'none'})`);

      // For GitHub repos, create an authenticated service if possible
      let repoService: RepositoryService;
      if (repo.isGitHubRepo && repo.userId) {
        // Look up user's access token for authenticated GitHub access
        const user = await this.repos.users.findById(repo.userId);
        if (user?.accessToken) {
          console.log(`[Benchmark] Using authenticated GitHub access for user ${repo.userId}`);
          repoService = this.repoServiceFactory.getServiceWithToken(repo, user.accessToken);
        } else {
          // Fall back to unauthenticated access
          console.warn(`[Benchmark] No access token found for user ${repo.userId}, using unauthenticated GitHub access`);
          repoService = this.repoServiceFactory.getService(repo);
        }
      } else {
        console.log(`[Benchmark] Using default repository service (isGitHubRepo: ${repo.isGitHubRepo})`);
        repoService = this.repoServiceFactory.getService(repo);
      }

      return { repoService, repo };
    }

    // No access method available
    console.error(`[Benchmark] No access method available for repo ${repoId} (repoServiceFactory: ${!!this.repoServiceFactory}, repo: ${!!repo})`);
    return null;
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
