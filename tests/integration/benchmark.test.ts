/**
 * Integration tests for Benchmark system.
 * Tests the repository implementations and benchmark execution.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { createBenchmarkRun, calculateSummary, type BenchmarkResult, type BenchmarkQuestion } from '../../src/domain/benchmark.js';
import { v4 as uuid } from 'uuid';
import {
  handleStartBenchmark,
  handleCompleteBenchmark,
  createStartBenchmarkCommand,
  createCompleteBenchmarkCommand,
} from '../../src/commands/benchmark.js';
import {
  handleGetBenchmarkRun,
  handleGetBenchmarkHistory,
  handleCompareBenchmarks,
  createGetBenchmarkRunQuery,
  createGetBenchmarkHistoryQuery,
  createCompareBenchmarksQuery,
} from '../../src/queries/benchmark.js';

describe('Benchmark System', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('BenchmarkRepository', () => {
    it('saves and retrieves a benchmark run', async () => {
      const repoId = 'bench-test-1';
      await createTestRepo(ctx, repoId);

      const run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-1',
        iterationCount: 50,
      });

      await ctx.repos.benchmarks.save(run);
      const retrieved = await ctx.repos.benchmarks.findById(run.id);

      assert.ok(retrieved, 'Should retrieve saved benchmark run');
      assert.strictEqual(retrieved.repoId, repoId);
      assert.strictEqual(retrieved.iterationCount, 50);
      assert.strictEqual(retrieved.status, 'running');
    });

    it('finds running benchmark for a repo', async () => {
      const repoId = 'bench-test-2';
      await createTestRepo(ctx, repoId);

      const run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-2',
        iterationCount: 25,
      });

      await ctx.repos.benchmarks.save(run);
      const running = await ctx.repos.benchmarks.findRunning(repoId);

      assert.ok(running, 'Should find running benchmark');
      assert.strictEqual(running.id, run.id);
    });

    it('returns null when no running benchmark', async () => {
      const repoId = 'bench-test-3';
      await createTestRepo(ctx, repoId);

      const running = await ctx.repos.benchmarks.findRunning(repoId);
      assert.strictEqual(running, null, 'Should return null when no running benchmark');
    });

    it('completes benchmark with results', async () => {
      const repoId = 'bench-test-4';
      await createTestRepo(ctx, repoId);

      const run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-4',
        iterationCount: 10,
      });
      await ctx.repos.benchmarks.save(run);

      const results: BenchmarkResult[] = [
        {
          questionId: 'q1',
          wikiAnswer: 'Answer 1',
          grade: 'accurate',
          confidence: 0.9,
          reasoning: 'Good',
          codeReferences: ['src/index.ts'],
          durationMs: 1000,
          costUsd: 0.01,
        },
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
      ];

      const summary = calculateSummary(results, questions);

      await ctx.repos.benchmarks.complete(run.id, results, summary, 0.01);

      const completed = await ctx.repos.benchmarks.findById(run.id);
      assert.ok(completed, 'Should retrieve completed benchmark');
      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.results.length, 1);
      assert.strictEqual(completed.summary.score, 100);
      assert.ok(completed.completedAt, 'Should have completedAt');
    });

    it('fails benchmark with error', async () => {
      const repoId = 'bench-test-5';
      await createTestRepo(ctx, repoId);

      const run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-5',
        iterationCount: 10,
      });
      await ctx.repos.benchmarks.save(run);

      await ctx.repos.benchmarks.fail(run.id, 'Network error');

      const failed = await ctx.repos.benchmarks.findById(run.id);
      assert.ok(failed, 'Should retrieve failed benchmark');
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.error, 'Network error');
    });

    it('finds latest benchmarks for a repo', async () => {
      const repoId = 'bench-test-6';
      await createTestRepo(ctx, repoId);

      // Create multiple benchmarks
      for (let i = 0; i < 3; i++) {
        const run = createBenchmarkRun({
          id: uuid(),
          repoId,
          wikiId: 'wiki-6',
          iterationCount: 10 + i,
        });
        await ctx.repos.benchmarks.save(run);
        await ctx.repos.benchmarks.complete(run.id, [], {
          totalQuestions: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0,
          score: 50 + i * 10, byCategory: {}, byDifficulty: { easy: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 }, medium: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 }, hard: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 } }
        }, 0.01 * i);
        // Small delay to ensure different timestamps
        await new Promise(r => setTimeout(r, 10));
      }

      const latest = await ctx.repos.benchmarks.findLatest(repoId, 2);
      assert.strictEqual(latest.length, 2, 'Should return limited results');
    });
  });

  describe('Benchmark CQRS Integration', () => {
    it('starts benchmark via command', async () => {
      const repoId = 'bench-cqrs-1';
      await createTestRepo(ctx, repoId);

      const runId = uuid();
      const command = createStartBenchmarkCommand({
        id: runId,
        repoId,
        wikiId: 'wiki-cqrs-1',
        iterationCount: 30,
      });

      const result = await handleStartBenchmark(command, ctx.repos);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.status, 'running');
    });

    it('completes benchmark via command and query', async () => {
      const repoId = 'bench-cqrs-2';
      await createTestRepo(ctx, repoId);

      // Start
      const runId = uuid();
      await handleStartBenchmark(
        createStartBenchmarkCommand({ id: runId, repoId, wikiId: 'wiki-cqrs-2', iterationCount: 20 }),
        ctx.repos
      );

      // Complete
      const results: BenchmarkResult[] = [
        { questionId: 'q1', wikiAnswer: 'A', grade: 'accurate', confidence: 0.9, reasoning: 'R', codeReferences: [], durationMs: 100, costUsd: 0.01 },
      ];
      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q?', category: 'architecture', difficulty: 'easy' },
      ];

      await handleCompleteBenchmark(
        createCompleteBenchmarkCommand({ benchmarkId: runId, results, questions, totalCostUsd: 0.01 }),
        ctx.repos
      );

      // Query
      const queryResult = await handleGetBenchmarkRun(createGetBenchmarkRunQuery(runId), ctx.repos);
      assert.strictEqual(queryResult.success, true);
      assert.strictEqual(queryResult.data?.status, 'completed');
      assert.strictEqual(queryResult.data?.summary.accurate, 1);
    });

    it('gets benchmark history', async () => {
      const repoId = 'bench-cqrs-3';
      await createTestRepo(ctx, repoId);

      // Create and complete a benchmark
      const runId = uuid();
      await handleStartBenchmark(
        createStartBenchmarkCommand({ id: runId, repoId, wikiId: 'wiki-cqrs-3', iterationCount: 10 }),
        ctx.repos
      );
      await handleCompleteBenchmark(
        createCompleteBenchmarkCommand({ benchmarkId: runId, results: [], questions: [], totalCostUsd: 0 }),
        ctx.repos
      );

      const historyResult = await handleGetBenchmarkHistory(
        createGetBenchmarkHistoryQuery(repoId),
        ctx.repos
      );

      assert.strictEqual(historyResult.success, true);
      assert.ok(historyResult.data!.length >= 1);
    });

    it('compares benchmarks', async () => {
      const repoId = 'bench-cqrs-4';
      await createTestRepo(ctx, repoId);

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
      ];

      // First run - partial answer
      const run1Id = uuid();
      await handleStartBenchmark(
        createStartBenchmarkCommand({ id: run1Id, repoId, wikiId: 'wiki-cqrs-4', iterationCount: 10 }),
        ctx.repos
      );
      await handleCompleteBenchmark(
        createCompleteBenchmarkCommand({
          benchmarkId: run1Id,
          results: [{ questionId: 'q1', wikiAnswer: 'A', grade: 'partial', confidence: 0.6, reasoning: 'R', codeReferences: [], durationMs: 100, costUsd: 0.01 }],
          questions,
          totalCostUsd: 0.01,
        }),
        ctx.repos
      );

      // Second run - accurate answer (improved)
      const run2Id = uuid();
      await handleStartBenchmark(
        createStartBenchmarkCommand({ id: run2Id, repoId, wikiId: 'wiki-cqrs-4', iterationCount: 20 }),
        ctx.repos
      );
      await handleCompleteBenchmark(
        createCompleteBenchmarkCommand({
          benchmarkId: run2Id,
          results: [{ questionId: 'q1', wikiAnswer: 'A', grade: 'accurate', confidence: 0.9, reasoning: 'R', codeReferences: [], durationMs: 100, costUsd: 0.01 }],
          questions,
          totalCostUsd: 0.01,
        }),
        ctx.repos
      );

      const compResult = await handleCompareBenchmarks(
        createCompareBenchmarksQuery([run1Id, run2Id]),
        ctx.repos
      );

      assert.strictEqual(compResult.success, true);
      assert.strictEqual(compResult.data!.runs.length, 2);
      assert.ok(compResult.data!.scoreChange! > 0, 'Score should have improved');
      assert.ok(compResult.data!.improvements.includes('q1'), 'q1 should be in improvements');
    });
  });
});
