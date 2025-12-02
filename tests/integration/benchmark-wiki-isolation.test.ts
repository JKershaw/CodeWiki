/**
 * Integration tests for Benchmark wiki isolation.
 * Tests that benchmarks are properly isolated between different wikis.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { createBenchmarkRun, calculateSummary, createEmptySummary, type BenchmarkResult, type BenchmarkQuestion } from '../../src/domain/benchmark.js';
import { createQualityBenchmarkRun, createEmptyQualitySummary } from '../../src/domain/quality-benchmark.js';
import { v4 as uuid } from 'uuid';
import {
  handleGetBenchmarkHistory,
  handleCompareBenchmarks,
  createGetBenchmarkHistoryQuery,
  createCompareBenchmarksQuery,
} from '../../src/queries/benchmark.js';
import {
  handleGetQualityBenchmarkHistory,
  handleCompareQualityBenchmarks,
  createGetQualityBenchmarkHistoryQuery,
  createCompareQualityBenchmarksQuery,
} from '../../src/queries/quality-benchmark.js';

describe('Benchmark Wiki Isolation', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('Standard Benchmarks', () => {
    it('findByWiki returns only benchmarks for the specified wiki', async () => {
      const repoId = 'wiki-iso-1';
      await createTestRepo(ctx, repoId);

      // Create benchmarks for two different wikis in the same repo
      const wiki1Run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-a',
        iterationCount: 10,
        pageCount: 5,
      });
      const wiki2Run = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-b',
        iterationCount: 20,
        pageCount: 10,
      });

      await ctx.repos.benchmarks.save(wiki1Run);
      await ctx.repos.benchmarks.save(wiki2Run);

      // Query by wiki should only return that wiki's benchmarks
      const wiki1Results = await ctx.repos.benchmarks.findByWiki('wiki-a');
      const wiki2Results = await ctx.repos.benchmarks.findByWiki('wiki-b');

      assert.strictEqual(wiki1Results.length, 1);
      assert.strictEqual(wiki1Results[0]!.wikiId, 'wiki-a');

      assert.strictEqual(wiki2Results.length, 1);
      assert.strictEqual(wiki2Results[0]!.wikiId, 'wiki-b');
    });

    it('findLatestByWiki returns only benchmarks for the specified wiki', async () => {
      const repoId = 'wiki-iso-2';
      await createTestRepo(ctx, repoId);

      // Create multiple benchmarks for two different wikis
      for (let i = 0; i < 3; i++) {
        await ctx.repos.benchmarks.save(createBenchmarkRun({
          id: uuid(),
          repoId,
          wikiId: 'wiki-c',
          iterationCount: i * 10,
          pageCount: 5,
        }));
        await ctx.repos.benchmarks.save(createBenchmarkRun({
          id: uuid(),
          repoId,
          wikiId: 'wiki-d',
          iterationCount: i * 10,
          pageCount: 5,
        }));
      }

      const wikiCLatest = await ctx.repos.benchmarks.findLatestByWiki('wiki-c', 10);
      const wikiDLatest = await ctx.repos.benchmarks.findLatestByWiki('wiki-d', 10);

      assert.strictEqual(wikiCLatest.length, 3);
      assert.ok(wikiCLatest.every(r => r.wikiId === 'wiki-c'));

      assert.strictEqual(wikiDLatest.length, 3);
      assert.ok(wikiDLatest.every(r => r.wikiId === 'wiki-d'));
    });

    it('findRunningByWiki returns only running benchmark for specific wiki', async () => {
      const repoId = 'wiki-iso-3';
      await createTestRepo(ctx, repoId);

      // Create running benchmarks for two wikis
      const wikiERunning = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-e',
        iterationCount: 10,
        pageCount: 5,
      });
      const wikiFRunning = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-f',
        iterationCount: 20,
        pageCount: 10,
      });

      await ctx.repos.benchmarks.save(wikiERunning);
      await ctx.repos.benchmarks.save(wikiFRunning);

      const wikiEResult = await ctx.repos.benchmarks.findRunningByWiki('wiki-e');
      const wikiFResult = await ctx.repos.benchmarks.findRunningByWiki('wiki-f');

      assert.ok(wikiEResult);
      assert.strictEqual(wikiEResult.wikiId, 'wiki-e');

      assert.ok(wikiFResult);
      assert.strictEqual(wikiFResult.wikiId, 'wiki-f');
    });

    it('handleGetBenchmarkHistory with wikiId filters correctly', async () => {
      const repoId = 'wiki-iso-4';
      await createTestRepo(ctx, repoId);

      // Create completed benchmarks for two wikis
      const wikiGRun = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-g',
        iterationCount: 10,
        pageCount: 5,
      });
      (wikiGRun as any).status = 'completed';
      (wikiGRun as any).summary = createEmptySummary();

      const wikiHRun = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-h',
        iterationCount: 20,
        pageCount: 10,
      });
      (wikiHRun as any).status = 'completed';
      (wikiHRun as any).summary = createEmptySummary();

      await ctx.repos.benchmarks.save(wikiGRun);
      await ctx.repos.benchmarks.save(wikiHRun);

      // Query with wikiId should filter
      const wikiGHistory = await handleGetBenchmarkHistory(
        createGetBenchmarkHistoryQuery(repoId, { wikiId: 'wiki-g' }),
        ctx.repos
      );

      assert.strictEqual(wikiGHistory.success, true);
      assert.strictEqual(wikiGHistory.data!.length, 1);

      // Query without wikiId should return all (backward compatibility)
      const allHistory = await handleGetBenchmarkHistory(
        createGetBenchmarkHistoryQuery(repoId),
        ctx.repos
      );

      assert.strictEqual(allHistory.success, true);
      assert.ok(allHistory.data!.length >= 2);
    });

    it('handleCompareBenchmarks rejects cross-wiki comparison', async () => {
      const repoId = 'wiki-iso-5';
      await createTestRepo(ctx, repoId);

      // Create completed benchmarks in different wikis
      const wikiIRun = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-i',
        iterationCount: 10,
        pageCount: 5,
      });
      (wikiIRun as any).status = 'completed';
      (wikiIRun as any).summary = createEmptySummary();

      const wikiJRun = createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-j',
        iterationCount: 20,
        pageCount: 10,
      });
      (wikiJRun as any).status = 'completed';
      (wikiJRun as any).summary = createEmptySummary();

      await ctx.repos.benchmarks.save(wikiIRun);
      await ctx.repos.benchmarks.save(wikiJRun);

      // Attempt cross-wiki comparison
      const result = await handleCompareBenchmarks(
        createCompareBenchmarksQuery([wikiIRun.id, wikiJRun.id]),
        ctx.repos
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('different wikis'));
    });

    it('deleteByWiki removes only benchmarks for the specified wiki', async () => {
      const repoId = 'wiki-iso-6';
      await createTestRepo(ctx, repoId);

      // Create benchmarks for two wikis
      await ctx.repos.benchmarks.save(createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-k',
        iterationCount: 10,
        pageCount: 5,
      }));
      await ctx.repos.benchmarks.save(createBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'wiki-l',
        iterationCount: 20,
        pageCount: 10,
      }));

      // Delete wiki-k benchmarks
      await ctx.repos.benchmarks.deleteByWiki('wiki-k');

      const wikiKResults = await ctx.repos.benchmarks.findByWiki('wiki-k');
      const wikiLResults = await ctx.repos.benchmarks.findByWiki('wiki-l');

      assert.strictEqual(wikiKResults.length, 0);
      assert.strictEqual(wikiLResults.length, 1);
    });
  });

  describe('Quality Benchmarks', () => {
    it('findByWiki returns only quality benchmarks for the specified wiki', async () => {
      const repoId = 'qwiki-iso-1';
      await createTestRepo(ctx, repoId);

      // Create quality benchmarks for two different wikis
      const wiki1Run = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-a',
        iterationCount: 10,
        pageCount: 5,
      });
      const wiki2Run = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-b',
        iterationCount: 20,
        pageCount: 10,
      });

      await ctx.repos.qualityBenchmarks.save(wiki1Run);
      await ctx.repos.qualityBenchmarks.save(wiki2Run);

      const wiki1Results = await ctx.repos.qualityBenchmarks.findByWiki('qwiki-a');
      const wiki2Results = await ctx.repos.qualityBenchmarks.findByWiki('qwiki-b');

      assert.strictEqual(wiki1Results.length, 1);
      assert.strictEqual(wiki1Results[0]!.wikiId, 'qwiki-a');

      assert.strictEqual(wiki2Results.length, 1);
      assert.strictEqual(wiki2Results[0]!.wikiId, 'qwiki-b');
    });

    it('handleGetQualityBenchmarkHistory with wikiId filters correctly', async () => {
      const repoId = 'qwiki-iso-2';
      await createTestRepo(ctx, repoId);

      // Create completed quality benchmarks for two wikis
      const wikiCRun = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-c',
        iterationCount: 10,
        pageCount: 5,
      });
      (wikiCRun as any).status = 'completed';
      (wikiCRun as any).summary = createEmptyQualitySummary();

      const wikiDRun = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-d',
        iterationCount: 20,
        pageCount: 10,
      });
      (wikiDRun as any).status = 'completed';
      (wikiDRun as any).summary = createEmptyQualitySummary();

      await ctx.repos.qualityBenchmarks.save(wikiCRun);
      await ctx.repos.qualityBenchmarks.save(wikiDRun);

      // Query with wikiId should filter
      const wikiCHistory = await handleGetQualityBenchmarkHistory(
        createGetQualityBenchmarkHistoryQuery(repoId, { wikiId: 'qwiki-c' }),
        ctx.repos
      );

      assert.strictEqual(wikiCHistory.success, true);
      assert.strictEqual(wikiCHistory.data!.length, 1);
    });

    it('handleCompareQualityBenchmarks rejects cross-wiki comparison', async () => {
      const repoId = 'qwiki-iso-3';
      await createTestRepo(ctx, repoId);

      // Create completed quality benchmarks in different wikis
      const wikiERun = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-e',
        iterationCount: 10,
        pageCount: 5,
      });
      (wikiERun as any).status = 'completed';
      (wikiERun as any).summary = createEmptyQualitySummary();

      const wikiFRun = createQualityBenchmarkRun({
        id: uuid(),
        repoId,
        wikiId: 'qwiki-f',
        iterationCount: 20,
        pageCount: 10,
      });
      (wikiFRun as any).status = 'completed';
      (wikiFRun as any).summary = createEmptyQualitySummary();

      await ctx.repos.qualityBenchmarks.save(wikiERun);
      await ctx.repos.qualityBenchmarks.save(wikiFRun);

      // Attempt cross-wiki comparison
      const result = await handleCompareQualityBenchmarks(
        createCompareQualityBenchmarksQuery([wikiERun.id, wikiFRun.id]),
        ctx.repos
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('different wikis'));
    });
  });
});
