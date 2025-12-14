/**
 * Unit tests for QualityBenchmarkRepository.
 * Tests quality benchmark run storage, querying, and wiki isolation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection, type QualityBenchmarkRepository } from '../../src/repositories/index.js';
import { createQualityBenchmarkRun, type QualityBenchmarkRun, type QualityBenchmarkRunStatus } from '../../src/domain/quality-benchmark.js';

describe('QualityBenchmarkRepository', () => {
  let connection: RepositoryConnection;
  let repo: QualityBenchmarkRepository;

  beforeEach(async () => {
    connection = await createRepositories({ mongoDbName: `test-quality-benchmark-${uuid()}` });
    repo = connection.repositories.qualityBenchmarks;
  });

  afterEach(async () => {
    await connection.close();
  });

  /**
   * Helper to create a quality benchmark run with sensible defaults.
   */
  function createTestQualityBenchmarkRun(overrides: Partial<{
    id: string;
    repoId: string;
    wikiId: string;
    iterationCount: number;
    pageCount: number;
    status: QualityBenchmarkRunStatus;
    startedAt: Date;
  }> = {}): QualityBenchmarkRun {
    const run = createQualityBenchmarkRun({
      id: overrides.id ?? uuid(),
      repoId: overrides.repoId ?? 'repo-1',
      wikiId: overrides.wikiId ?? 'wiki-1',
      iterationCount: overrides.iterationCount ?? 10,
      pageCount: overrides.pageCount ?? 5,
    });

    if (overrides.status && overrides.status !== 'running') {
      (run as any).status = overrides.status;
    }
    if (overrides.startedAt) {
      (run as any).startedAt = overrides.startedAt;
    }

    return run;
  }

  describe('save and findById', () => {
    it('saves and retrieves a quality benchmark run by id', async () => {
      const run = createTestQualityBenchmarkRun({ id: 'qbench-1' });

      await repo.save(run);
      const retrieved = await repo.findById('qbench-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'qbench-1');
      assert.strictEqual(retrieved.status, 'running');
      assert.strictEqual(retrieved.repoId, 'repo-1');
      assert.strictEqual(retrieved.wikiId, 'wiki-1');
    });

    it('returns null for non-existent quality benchmark run', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      const run = createTestQualityBenchmarkRun({ startedAt });

      await repo.save(run);
      const retrieved = await repo.findById(run.id);

      assert.ok(retrieved);
      assert.ok(retrieved.startedAt instanceof Date);
      assert.strictEqual(retrieved.startedAt.getTime(), startedAt.getTime());
    });
  });

  describe('findByWiki', () => {
    it('returns only quality benchmark runs for the specified wiki', async () => {
      const wiki1Run1 = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      const wiki1Run2 = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      const wiki2Run = createTestQualityBenchmarkRun({ wikiId: 'wiki-2' });

      await repo.save(wiki1Run1);
      await repo.save(wiki1Run2);
      await repo.save(wiki2Run);

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.wikiId === 'wiki-1'));
    });

    it('returns empty array when no runs for wiki', async () => {
      const wiki1Run = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      await repo.save(wiki1Run);

      const results = await repo.findByWiki('wiki-2');
      assert.strictEqual(results.length, 0);
    });

    it('filters by status when provided', async () => {
      const running = createTestQualityBenchmarkRun({ wikiId: 'wiki-1', status: 'running' });
      const completed = createTestQualityBenchmarkRun({ wikiId: 'wiki-1', status: 'completed' });
      const failed = createTestQualityBenchmarkRun({ wikiId: 'wiki-1', status: 'failed' });

      await repo.save(running);
      await repo.save(completed);
      await repo.save(failed);

      const results = await repo.findByWiki('wiki-1', { status: 'completed' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.status, 'completed');
    });

    it('respects limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.save(createTestQualityBenchmarkRun({ wikiId: 'wiki-1' }));
      }

      const results = await repo.findByWiki('wiki-1', { limit: 3 });
      assert.strictEqual(results.length, 3);
    });

    it('respects offset option', async () => {
      const runs: QualityBenchmarkRun[] = [];
      for (let i = 0; i < 5; i++) {
        const run = createTestQualityBenchmarkRun({
          wikiId: 'wiki-1',
          startedAt: new Date(Date.now() - i * 1000), // Different times for sorting
        });
        runs.push(run);
        await repo.save(run);
      }

      const results = await repo.findByWiki('wiki-1', { offset: 2, limit: 2 });
      assert.strictEqual(results.length, 2);
    });

    it('sorts by start time (newest first)', async () => {
      const older = createTestQualityBenchmarkRun({
        wikiId: 'wiki-1',
        startedAt: new Date('2024-01-01T10:00:00Z'),
      });
      const newer = createTestQualityBenchmarkRun({
        wikiId: 'wiki-1',
        startedAt: new Date('2024-01-15T10:00:00Z'),
      });
      const middle = createTestQualityBenchmarkRun({
        wikiId: 'wiki-1',
        startedAt: new Date('2024-01-10T10:00:00Z'),
      });

      await repo.save(older);
      await repo.save(newer);
      await repo.save(middle);

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0]!.startedAt.getTime(), newer.startedAt.getTime());
      assert.strictEqual(results[1]!.startedAt.getTime(), middle.startedAt.getTime());
      assert.strictEqual(results[2]!.startedAt.getTime(), older.startedAt.getTime());
    });
  });

  describe('findLatestByWiki', () => {
    it('returns latest quality benchmark runs for a wiki', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.save(createTestQualityBenchmarkRun({ wikiId: 'wiki-1' }));
      }
      await repo.save(createTestQualityBenchmarkRun({ wikiId: 'wiki-2' }));

      const results = await repo.findLatestByWiki('wiki-1', 3);
      assert.strictEqual(results.length, 3);
      assert.ok(results.every(r => r.wikiId === 'wiki-1'));
    });

    it('defaults to limit of 10', async () => {
      for (let i = 0; i < 15; i++) {
        await repo.save(createTestQualityBenchmarkRun({ wikiId: 'wiki-1' }));
      }

      const results = await repo.findLatestByWiki('wiki-1');
      assert.strictEqual(results.length, 10);
    });

    it('returns empty array when no runs for wiki', async () => {
      await repo.save(createTestQualityBenchmarkRun({ wikiId: 'wiki-1' }));

      const results = await repo.findLatestByWiki('wiki-2');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('findRunningByWiki', () => {
    it('returns running quality benchmark for a specific wiki', async () => {
      const wiki1Running = createTestQualityBenchmarkRun({ wikiId: 'wiki-1', status: 'running' });
      const wiki2Running = createTestQualityBenchmarkRun({ wikiId: 'wiki-2', status: 'running' });

      await repo.save(wiki1Running);
      await repo.save(wiki2Running);

      const result = await repo.findRunningByWiki('wiki-1');
      assert.ok(result);
      assert.strictEqual(result.wikiId, 'wiki-1');
      assert.strictEqual(result.status, 'running');
    });

    it('returns null when no running quality benchmark for wiki', async () => {
      const wiki1Completed = createTestQualityBenchmarkRun({ wikiId: 'wiki-1', status: 'completed' });
      const wiki2Running = createTestQualityBenchmarkRun({ wikiId: 'wiki-2', status: 'running' });

      await repo.save(wiki1Completed);
      await repo.save(wiki2Running);

      const result = await repo.findRunningByWiki('wiki-1');
      assert.strictEqual(result, null);
    });

    it('returns null when wiki has no quality benchmarks', async () => {
      const result = await repo.findRunningByWiki('wiki-1');
      assert.strictEqual(result, null);
    });
  });

  describe('findByRepo (existing method - ensure no regression)', () => {
    it('returns all quality benchmark runs for a repo regardless of wiki', async () => {
      const wiki1Run = createTestQualityBenchmarkRun({ repoId: 'repo-1', wikiId: 'wiki-1' });
      const wiki2Run = createTestQualityBenchmarkRun({ repoId: 'repo-1', wikiId: 'wiki-2' });
      const otherRepoRun = createTestQualityBenchmarkRun({ repoId: 'repo-2', wikiId: 'wiki-3' });

      await repo.save(wiki1Run);
      await repo.save(wiki2Run);
      await repo.save(otherRepoRun);

      const results = await repo.findByRepo('repo-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.repoId === 'repo-1'));
    });
  });

  describe('deleteByWiki', () => {
    it('deletes all quality benchmark runs for a wiki', async () => {
      const wiki1Run1 = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      const wiki1Run2 = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      const wiki2Run = createTestQualityBenchmarkRun({ wikiId: 'wiki-2' });

      await repo.save(wiki1Run1);
      await repo.save(wiki1Run2);
      await repo.save(wiki2Run);

      await repo.deleteByWiki('wiki-1');

      const wiki1Results = await repo.findByWiki('wiki-1');
      const wiki2Results = await repo.findByWiki('wiki-2');

      assert.strictEqual(wiki1Results.length, 0);
      assert.strictEqual(wiki2Results.length, 1);
    });

    it('does nothing when wiki has no quality benchmarks', async () => {
      const wiki1Run = createTestQualityBenchmarkRun({ wikiId: 'wiki-1' });
      await repo.save(wiki1Run);

      // Should not throw
      await repo.deleteByWiki('wiki-2');

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 1);
    });
  });
});
