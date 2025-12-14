/**
 * Unit tests for the Self-Improvement Agent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SelfImprovementAgent } from '../../src/analysis/self-improvement-agent.js';
import type { BenchmarkRun } from '../../src/domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../src/domain/quality-benchmark.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { LLMService, ToolUseResult } from '../../src/services/llm/llm-service.js';
import type { GitService } from '../../src/services/git/git-service.js';
import type { RepositoryServiceFactory, RepositoryService } from '../../src/services/repository/repository-service.js';

// Helper to create a mock benchmark run
function createMockBenchmarkRun(
  id: string,
  iterationCount: number,
  score: number,
  results: Array<{ questionId: string; grade: string }>
): BenchmarkRun {
  return {
    id,
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    iterationCount,
    pageCount: iterationCount * 2,
    results: results.map(r => ({
      questionId: r.questionId,
      grade: r.grade as 'accurate' | 'partial' | 'inaccurate' | 'no_answer',
      confidence: 0.8,
      wikiAnswer: 'Test answer',
      reasoning: 'Test reasoning',
      codeReferences: [],
      durationMs: 1000,
      costUsd: 0.01,
    })),
    summary: {
      totalQuestions: results.length,
      accurate: results.filter(r => r.grade === 'accurate').length,
      partial: results.filter(r => r.grade === 'partial').length,
      inaccurate: results.filter(r => r.grade === 'inaccurate').length,
      noAnswer: results.filter(r => r.grade === 'no_answer').length,
      score,
      byCategory: {},
      byDifficulty: {
        easy: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        medium: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        hard: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
      },
    },
    totalCostUsd: 0.05,
    error: null,
  };
}

// Helper to create mock repositories
function createMockRepos(benchmarks: BenchmarkRun[]): Partial<Repositories> {
  const benchmarkMap = new Map(benchmarks.map(b => [b.id, b]));

  return {
    repos: {
      findById: async () => ({
        id: 'test-repo',
        name: 'test',
        fullName: 'test/test',
        isGitHubRepo: false,
        owner: null,
        repoName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
      }),
      findByFullName: async () => null,
      findAll: async () => [],
      save: async () => {},
      delete: async () => {},
      updateStatus: async () => {},
    },
    benchmarks: {
      findById: async (id: string) => benchmarkMap.get(id) ?? null,
      findByRepo: async () => benchmarks,
      findLatest: async () => benchmarks,
      findRunning: async () => null,
      save: async () => {},
      delete: async () => {},
      deleteByRepo: async () => {},
      complete: async () => {},
      fail: async () => {},
    },
    qualityBenchmarks: {
      findById: async () => null,
      findByRepo: async () => [],
      findByWiki: async () => [],
      findLatest: async () => [],
      findLatestByWiki: async () => [],
      findRunning: async () => null,
      findRunningByWiki: async () => null,
      save: async () => {},
      delete: async () => {},
      deleteByRepo: async () => {},
      deleteByWiki: async () => {},
      complete: async () => {},
      fail: async () => {},
    },
    wikiPages: {
      findByWiki: async () => [],
      findById: async () => null,
      findByPath: async () => null,
      save: async () => {},
      delete: async () => {},
      deleteByWiki: async () => {},
      count: async () => 0,
    },
    processingRuns: {
      findByRepo: async () => [],
      findById: async () => null,
      findActive: async () => null,
      findMostRecent: async () => null,
      save: async () => {},
      delete: async () => {},
      updateProgress: async () => {},
      complete: async () => {},
      fail: async () => {},
      requestStop: async () => {},
    },
    iterations: {
      findByProcessingRun: async () => [],
      findById: async () => null,
      findRunning: async () => null,
      save: async () => {},
      delete: async () => {},
      deleteByProcessingRun: async () => {},
      updateWorkItem: async () => {},
      complete: async () => {},
      fail: async () => {},
      skip: async () => {},
    },
  } as Partial<Repositories>;
}

// Helper to create a mock LLM service
function createMockLLM(responseContent: string): LLMService {
  return {
    complete: async () => ({
      content: responseContent,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      model: 'mock',
      truncated: false,
    }),
    completeWithTools: async () => ({
      content: responseContent,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      model: 'mock',
      truncated: false,
      toolCalls: [],
      toolRounds: 1,
    } as ToolUseResult),
    getUsageStats: () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
    }),
    resetUsageStats: () => {},
    isRateLimited: () => false,
    getModel: () => 'mock',
  };
}

// Helper to create a mock GitService
function createMockGitService(): GitService {
  return {
    registerLocalRepo: () => {},
    getRepoPath: () => '/mock/repo/path',
    cloneRepo: async () => '/mock/repo/path',
    pullRepo: async () => {},
    getCommitDiff: async () => 'mock diff',
    getCommitsBetween: async () => [],
    getLatestCommit: async () => null,
  };
}

// Helper to create a mock RepositoryService
function createMockRepositoryService(): RepositoryService {
  return {
    getFileContent: async () => 'mock file content',
    listDirectory: async () => [],
    getFileTree: async () => ['README.md', 'src/index.ts'],
    fileExists: async () => true,
    getCommitDiff: async () => 'mock diff',
  };
}

// Helper to create a mock RepositoryServiceFactory
function createMockRepoServiceFactory(): RepositoryServiceFactory {
  const mockService = createMockRepositoryService();
  return {
    getService: () => mockService,
    getServiceWithToken: () => mockService,
  };
}

describe('SelfImprovementAgent', () => {
  describe('analyze', () => {
    it('allows wiki-only analysis without benchmarks', async () => {
      const repos = createMockRepos([]) as Repositories;
      const llm = createMockLLM('Wiki quality report');
      const git = createMockGitService();
      const repoServiceFactory = createMockRepoServiceFactory();
      const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);

      // Wiki-quality-first approach doesn't require benchmarks
      const result = await agent.analyze('test-repo', 'test-wiki', []);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.report, 'Wiki quality report');
    });

    it('produces a report for valid benchmark runs', async () => {
      const benchmarks = [
        createMockBenchmarkRun('run-1', 10, 40, [
          { questionId: 'q1', grade: 'no_answer' },
          { questionId: 'q2', grade: 'partial' },
        ]),
        createMockBenchmarkRun('run-2', 50, 75, [
          { questionId: 'q1', grade: 'accurate' },
          { questionId: 'q2', grade: 'accurate' },
        ]),
      ];

      const expectedReport = `# Analysis Report

## Executive Summary
Score improved from 40% to 75%

## Recommendations
1. Keep doing what's working`;

      const repos = createMockRepos(benchmarks) as Repositories;
      const llm = createMockLLM(expectedReport);
      const git = createMockGitService();
      const repoServiceFactory = createMockRepoServiceFactory();
      const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);

      const result = await agent.analyze('test-repo', 'test-wiki', ['run-1', 'run-2']);

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.report, expectedReport);
      assert.ok(result.costUsd > 0);
      assert.deepStrictEqual(result.iterationRange, [10, 50]);
      assert.deepStrictEqual(result.benchmarkRunIds, ['run-1', 'run-2']);
    });

    it('handles LLM errors gracefully', async () => {
      const benchmarks = [
        createMockBenchmarkRun('run-1', 10, 40, [{ questionId: 'q1', grade: 'partial' }]),
        createMockBenchmarkRun('run-2', 50, 60, [{ questionId: 'q1', grade: 'accurate' }]),
      ];

      const repos = createMockRepos(benchmarks) as Repositories;
      const git = createMockGitService();
      const repoServiceFactory = createMockRepoServiceFactory();

      // Create an LLM that throws
      const llm: LLMService = {
        ...createMockLLM(''),
        completeWithTools: async () => {
          throw new Error('Rate limit exceeded');
        },
      };

      const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);
      const result = await agent.analyze('test-repo', 'test-wiki', ['run-1', 'run-2']);

      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error?.includes('Rate limit'));
      assert.strictEqual(result.report, '');
    });

    it('ignores non-completed benchmark runs', async () => {
      const completedRun1 = createMockBenchmarkRun('run-1', 10, 40, [{ questionId: 'q1', grade: 'partial' }]);
      const completedRun2 = createMockBenchmarkRun('run-2', 50, 60, [{ questionId: 'q1', grade: 'accurate' }]);
      const runningRun: BenchmarkRun = {
        ...createMockBenchmarkRun('run-3', 30, 0, []),
        status: 'running',
      };

      const allBenchmarks = [completedRun1, runningRun, completedRun2];
      const repos = createMockRepos(allBenchmarks) as Repositories;
      const llm = createMockLLM('Report');
      const git = createMockGitService();
      const repoServiceFactory = createMockRepoServiceFactory();
      const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);

      // Should work with just the completed runs
      const result = await agent.analyze('test-repo', 'test-wiki', ['run-1', 'run-2', 'run-3']);

      assert.strictEqual(result.status, 'completed');
      // The iteration range should only include completed runs
      assert.deepStrictEqual(result.iterationRange, [10, 50]);
    });

    it('sorts benchmark runs by iteration count', async () => {
      // Create runs out of order
      const benchmarks = [
        createMockBenchmarkRun('run-2', 50, 60, [{ questionId: 'q1', grade: 'accurate' }]),
        createMockBenchmarkRun('run-1', 10, 40, [{ questionId: 'q1', grade: 'partial' }]),
      ];

      const repos = createMockRepos(benchmarks) as Repositories;
      const llm = createMockLLM('Report');
      const git = createMockGitService();
      const repoServiceFactory = createMockRepoServiceFactory();
      const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);

      const result = await agent.analyze('test-repo', 'test-wiki', ['run-2', 'run-1']);

      // Should still have correct iteration range (sorted)
      assert.deepStrictEqual(result.iterationRange, [10, 50]);
    });
  });
});
