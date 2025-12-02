/**
 * Unit tests for Benchmark CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createStartBenchmarkCommand,
  handleStartBenchmark,
  createCompleteBenchmarkCommand,
  handleCompleteBenchmark,
  createFailBenchmarkCommand,
  handleFailBenchmark,
} from '../../src/commands/benchmark.js';
import {
  createGetBenchmarkHistoryQuery,
  handleGetBenchmarkHistory,
  createCompareBenchmarksQuery,
  handleCompareBenchmarks,
} from '../../src/queries/benchmark.js';
import {
  type BenchmarkRun,
  type BenchmarkResult,
  type BenchmarkQuestion,
  createBenchmarkRun,
  createEmptySummary,
} from '../../src/domain/benchmark.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const benchmarks = new Map<string, BenchmarkRun>();

  const mockBenchmarks: Repositories['benchmarks'] = {
    findById: async (id) => benchmarks.get(id) ?? null,
    findByRepo: async (repoId) => {
      return Array.from(benchmarks.values()).filter(b => b.repoId === repoId);
    },
    findByWiki: async (wikiId) => {
      return Array.from(benchmarks.values())
        .filter(b => b.wikiId === wikiId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    },
    findLatest: async (repoId, limit = 10) => {
      return Array.from(benchmarks.values())
        .filter(b => b.repoId === repoId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);
    },
    findLatestByWiki: async (wikiId, limit = 10) => {
      return Array.from(benchmarks.values())
        .filter(b => b.wikiId === wikiId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit);
    },
    findRunning: async (repoId) => {
      for (const benchmark of benchmarks.values()) {
        if (benchmark.repoId === repoId && benchmark.status === 'running') {
          return benchmark;
        }
      }
      return null;
    },
    findRunningByWiki: async (wikiId) => {
      for (const benchmark of benchmarks.values()) {
        if (benchmark.wikiId === wikiId && benchmark.status === 'running') {
          return benchmark;
        }
      }
      return null;
    },
    save: async (run) => { benchmarks.set(run.id, run); },
    delete: async (id) => { benchmarks.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, benchmark] of benchmarks) {
        if (benchmark.repoId === repoId) benchmarks.delete(id);
      }
    },
    deleteByWiki: async (wikiId) => {
      for (const [id, benchmark] of benchmarks) {
        if (benchmark.wikiId === wikiId) benchmarks.delete(id);
      }
    },
    complete: async (id, results, summary, totalCostUsd) => {
      const run = benchmarks.get(id);
      if (run) {
        run.status = 'completed';
        run.completedAt = new Date();
        run.results = results;
        run.summary = summary;
        run.totalCostUsd = totalCostUsd;
      }
    },
    fail: async (id, error) => {
      const run = benchmarks.get(id);
      if (run) {
        run.status = 'failed';
        run.completedAt = new Date();
        run.error = error;
      }
    },
  };

  return {
    benchmarks: mockBenchmarks,
  } as Repositories;
}

describe('Benchmark Commands', () => {
  describe('StartBenchmark', () => {
    it('creates a new benchmark run in running state', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const command = createStartBenchmarkCommand({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        iterationCount: 50,
      });
      const result = await handleStartBenchmark(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.id, runId);
      assert.strictEqual(result.data?.status, 'running');
      assert.strictEqual(result.data?.iterationCount, 50);

      const saved = await repos.benchmarks.findById(runId);
      assert.strictEqual(saved?.status, 'running');
    });

    it('fails if a benchmark is already running', async () => {
      const repos = createMockRepos();

      // Create an existing running benchmark
      const existingRun = createBenchmarkRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        iterationCount: 10,
      });
      await repos.benchmarks.save(existingRun);

      // Try to start another
      const command = createStartBenchmarkCommand({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        iterationCount: 20,
      });
      const result = await handleStartBenchmark(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('already running'));
    });
  });

  describe('CompleteBenchmark', () => {
    it('marks benchmark as completed with results', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running benchmark
      const run = createBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        iterationCount: 10,
      });
      await repos.benchmarks.save(run);

      const results: BenchmarkResult[] = [
        {
          questionId: 'q1',
          wikiAnswer: 'The answer',
          grade: 'accurate',
          confidence: 0.9,
          reasoning: 'Correct',
          codeReferences: ['src/index.ts'],
          durationMs: 1000,
          costUsd: 0.01,
        },
        {
          questionId: 'q2',
          wikiAnswer: 'Partial answer',
          grade: 'partial',
          confidence: 0.7,
          reasoning: 'Missing details',
          codeReferences: ['src/lib.ts'],
          durationMs: 1500,
          costUsd: 0.02,
        },
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'patterns', difficulty: 'medium' },
      ];

      const command = createCompleteBenchmarkCommand({
        benchmarkId: runId,
        results,
        questions,
        totalCostUsd: 0.03,
      });
      const result = await handleCompleteBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const completed = await repos.benchmarks.findById(runId);
      assert.strictEqual(completed?.status, 'completed');
      assert.strictEqual(completed?.results.length, 2);
      assert.strictEqual(completed?.totalCostUsd, 0.03);
      // Summary should be calculated
      assert.strictEqual(completed?.summary.totalQuestions, 2);
      assert.strictEqual(completed?.summary.accurate, 1);
      assert.strictEqual(completed?.summary.partial, 1);
    });

    it('fails for non-existent benchmark', async () => {
      const repos = createMockRepos();

      const command = createCompleteBenchmarkCommand({
        benchmarkId: 'non-existent',
        results: [],
        questions: [],
        totalCostUsd: 0,
      });
      const result = await handleCompleteBenchmark(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });
  });

  describe('FailBenchmark', () => {
    it('marks benchmark as failed with error', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // Create a running benchmark
      const run = createBenchmarkRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        iterationCount: 10,
      });
      await repos.benchmarks.save(run);

      const command = createFailBenchmarkCommand(runId, 'Something went wrong');
      const result = await handleFailBenchmark(command, repos);

      assert.strictEqual(result.success, true);

      const failed = await repos.benchmarks.findById(runId);
      assert.strictEqual(failed?.status, 'failed');
      assert.strictEqual(failed?.error, 'Something went wrong');
    });
  });
});

describe('Benchmark Queries - Wiki Isolation', () => {
  /**
   * Helper to create a completed benchmark run.
   */
  function createCompletedBenchmark(overrides: {
    id?: string;
    repoId?: string;
    wikiId?: string;
    iterationCount?: number;
  } = {}): BenchmarkRun {
    const run = createBenchmarkRun({
      id: overrides.id ?? uuid(),
      repoId: overrides.repoId ?? 'repo-1',
      wikiId: overrides.wikiId ?? 'wiki-1',
      iterationCount: overrides.iterationCount ?? 10,
      pageCount: 5,
    });
    // Mark as completed
    (run as any).status = 'completed';
    (run as any).completedAt = new Date();
    (run as any).summary = createEmptySummary();
    return run;
  }

  describe('GetBenchmarkHistory', () => {
    it('returns only benchmarks for specified wiki when wikiId provided', async () => {
      const repos = createMockRepos();

      // Create benchmarks for different wikis in same repo
      const wiki1Bench = createCompletedBenchmark({ wikiId: 'wiki-1', repoId: 'repo-1' });
      const wiki2Bench = createCompletedBenchmark({ wikiId: 'wiki-2', repoId: 'repo-1' });
      await repos.benchmarks.save(wiki1Bench);
      await repos.benchmarks.save(wiki2Bench);

      // Query with wikiId
      const query = createGetBenchmarkHistoryQuery('repo-1', { wikiId: 'wiki-1' });
      const result = await handleGetBenchmarkHistory(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 1);
      assert.strictEqual(result.data?.[0]?.id, wiki1Bench.id);
    });

    it('returns all repo benchmarks when wikiId not provided (backward compatibility)', async () => {
      const repos = createMockRepos();

      // Create benchmarks for different wikis in same repo
      const wiki1Bench = createCompletedBenchmark({ wikiId: 'wiki-1', repoId: 'repo-1' });
      const wiki2Bench = createCompletedBenchmark({ wikiId: 'wiki-2', repoId: 'repo-1' });
      await repos.benchmarks.save(wiki1Bench);
      await repos.benchmarks.save(wiki2Bench);

      // Query without wikiId (uses number overload)
      const query = createGetBenchmarkHistoryQuery('repo-1', 10);
      const result = await handleGetBenchmarkHistory(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 2);
    });
  });

  describe('CompareBenchmarks', () => {
    it('rejects comparison of benchmarks from different wikis', async () => {
      const repos = createMockRepos();

      // Create completed benchmarks for different wikis
      const wiki1Bench = createCompletedBenchmark({ wikiId: 'wiki-1', repoId: 'repo-1' });
      const wiki2Bench = createCompletedBenchmark({ wikiId: 'wiki-2', repoId: 'repo-1' });
      await repos.benchmarks.save(wiki1Bench);
      await repos.benchmarks.save(wiki2Bench);

      // Try to compare cross-wiki
      const query = createCompareBenchmarksQuery([wiki1Bench.id, wiki2Bench.id]);
      const result = await handleCompareBenchmarks(query, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('different wikis'));
    });

    it('allows comparison of benchmarks from the same wiki', async () => {
      const repos = createMockRepos();

      // Create completed benchmarks for same wiki
      const bench1 = createCompletedBenchmark({ wikiId: 'wiki-1', repoId: 'repo-1', iterationCount: 10 });
      const bench2 = createCompletedBenchmark({ wikiId: 'wiki-1', repoId: 'repo-1', iterationCount: 20 });
      await repos.benchmarks.save(bench1);
      await repos.benchmarks.save(bench2);

      // Compare same-wiki benchmarks
      const query = createCompareBenchmarksQuery([bench1.id, bench2.id]);
      const result = await handleCompareBenchmarks(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.runs.length, 2);
    });
  });
});
