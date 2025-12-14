/**
 * Unit tests for AutoBenchmarkRepository.
 * Tests auto-benchmark run storage, querying, and status management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection, type AutoBenchmarkRepository } from '../../src/repositories/index.js';
import { createAutoBenchmarkRun, type AutoBenchmarkRun, type AutoBenchmarkStatus } from '../../src/domain/auto-benchmark.js';

describe('AutoBenchmarkRepository', () => {
  let connection: RepositoryConnection;
  let repo: AutoBenchmarkRepository;

  beforeEach(async () => {
    connection = await createRepositories({ mongoDbName: `test-auto-benchmark-${uuid()}` });
    repo = connection.repositories.autoBenchmarks;
  });

  afterEach(async () => {
    await connection.close();
  });

  /**
   * Helper to create an auto-benchmark run with sensible defaults.
   */
  function createTestRun(overrides: Partial<{
    id: string;
    repoId: string;
    wikiId: string;
    iterationsPerCycle: number;
    maxCycles: number;
    includeQuality: boolean;
    status: AutoBenchmarkStatus;
    currentCycle: number;
    startedAt: Date;
  }> = {}): AutoBenchmarkRun {
    const run = createAutoBenchmarkRun({
      id: overrides.id ?? uuid(),
      repoId: overrides.repoId ?? 'repo-1',
      wikiId: overrides.wikiId ?? 'wiki-1',
      config: {
        iterationsPerCycle: overrides.iterationsPerCycle ?? 5,
        maxCycles: overrides.maxCycles ?? 10,
        includeQuality: overrides.includeQuality ?? false,
      },
    });

    if (overrides.status && overrides.status !== 'running') {
      (run as any).status = overrides.status;
    }
    if (overrides.currentCycle) {
      (run as any).currentCycle = overrides.currentCycle;
    }
    if (overrides.startedAt) {
      (run as any).startedAt = overrides.startedAt;
    }

    return run;
  }

  describe('save and findById', () => {
    it('saves and retrieves an auto-benchmark run by id', async () => {
      const run = createTestRun({ id: 'auto-bench-1' });

      await repo.save(run);
      const retrieved = await repo.findById('auto-bench-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'auto-bench-1');
      assert.strictEqual(retrieved.status, 'running');
      assert.strictEqual(retrieved.repoId, 'repo-1');
      assert.strictEqual(retrieved.wikiId, 'wiki-1');
      assert.strictEqual(retrieved.config.iterationsPerCycle, 5);
      assert.strictEqual(retrieved.config.maxCycles, 10);
    });

    it('returns null for non-existent run', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      const run = createTestRun({ startedAt });

      await repo.save(run);
      const retrieved = await repo.findById(run.id);

      assert.ok(retrieved);
      assert.ok(retrieved.startedAt instanceof Date);
      assert.strictEqual(retrieved.startedAt.getTime(), startedAt.getTime());
    });
  });

  describe('findByWiki', () => {
    it('returns only runs for the specified wiki', async () => {
      const wiki1Run1 = createTestRun({ wikiId: 'wiki-1' });
      const wiki1Run2 = createTestRun({ wikiId: 'wiki-1' });
      const wiki2Run = createTestRun({ wikiId: 'wiki-2' });

      await repo.save(wiki1Run1);
      await repo.save(wiki1Run2);
      await repo.save(wiki2Run);

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.wikiId === 'wiki-1'));
    });

    it('returns empty array when no runs for wiki', async () => {
      const wiki1Run = createTestRun({ wikiId: 'wiki-1' });
      await repo.save(wiki1Run);

      const results = await repo.findByWiki('wiki-2');
      assert.strictEqual(results.length, 0);
    });

    it('filters by status when provided', async () => {
      const running = createTestRun({ wikiId: 'wiki-1', status: 'running' });
      const completed = createTestRun({ wikiId: 'wiki-1', status: 'completed' });
      const failed = createTestRun({ wikiId: 'wiki-1', status: 'failed' });

      await repo.save(running);
      await repo.save(completed);
      await repo.save(failed);

      const results = await repo.findByWiki('wiki-1', { status: 'completed' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.status, 'completed');
    });

    it('respects limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.save(createTestRun({ wikiId: 'wiki-1' }));
      }

      const results = await repo.findByWiki('wiki-1', { limit: 3 });
      assert.strictEqual(results.length, 3);
    });
  });

  describe('findRunning', () => {
    it('returns running auto-benchmark for a repo', async () => {
      const running = createTestRun({ repoId: 'repo-1', status: 'running' });
      const completed = createTestRun({ repoId: 'repo-1', status: 'completed' });

      await repo.save(running);
      await repo.save(completed);

      const result = await repo.findRunning('repo-1');
      assert.ok(result);
      assert.strictEqual(result.status, 'running');
    });

    it('returns null when no running auto-benchmark', async () => {
      const completed = createTestRun({ repoId: 'repo-1', status: 'completed' });
      await repo.save(completed);

      const result = await repo.findRunning('repo-1');
      assert.strictEqual(result, null);
    });
  });

  describe('findRunningByWiki', () => {
    it('returns running auto-benchmark for a specific wiki', async () => {
      const wiki1Running = createTestRun({ wikiId: 'wiki-1', status: 'running' });
      const wiki2Running = createTestRun({ wikiId: 'wiki-2', status: 'running' });

      await repo.save(wiki1Running);
      await repo.save(wiki2Running);

      const result = await repo.findRunningByWiki('wiki-1');
      assert.ok(result);
      assert.strictEqual(result.wikiId, 'wiki-1');
      assert.strictEqual(result.status, 'running');
    });

    it('returns null when no running auto-benchmark for wiki', async () => {
      const wiki1Completed = createTestRun({ wikiId: 'wiki-1', status: 'completed' });
      await repo.save(wiki1Completed);

      const result = await repo.findRunningByWiki('wiki-1');
      assert.strictEqual(result, null);
    });
  });

  describe('findAllRunning', () => {
    it('returns all running auto-benchmarks across repos', async () => {
      const running1 = createTestRun({ repoId: 'repo-1', status: 'running' });
      const running2 = createTestRun({ repoId: 'repo-2', status: 'running' });
      const completed = createTestRun({ repoId: 'repo-3', status: 'completed' });

      await repo.save(running1);
      await repo.save(running2);
      await repo.save(completed);

      const results = await repo.findAllRunning();
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.status === 'running'));
    });

    it('returns empty array when no running auto-benchmarks', async () => {
      const completed = createTestRun({ status: 'completed' });
      await repo.save(completed);

      const results = await repo.findAllRunning();
      assert.strictEqual(results.length, 0);
    });
  });

  describe('updateProgress', () => {
    it('updates cycle and phase', async () => {
      const run = createTestRun({ id: 'run-1' });
      await repo.save(run);

      await repo.updateProgress('run-1', 3, 'accuracy');

      const updated = await repo.findById('run-1');
      assert.ok(updated);
      assert.strictEqual(updated.currentCycle, 3);
      assert.strictEqual(updated.currentPhase, 'accuracy');
    });

    it('preserves other fields when updating progress', async () => {
      const run = createTestRun({ id: 'run-1', maxCycles: 15 });
      await repo.save(run);

      await repo.updateProgress('run-1', 2, 'quality');

      const updated = await repo.findById('run-1');
      assert.ok(updated);
      assert.strictEqual(updated.config.maxCycles, 15);
      assert.strictEqual(updated.status, 'running');
    });
  });

  describe('complete', () => {
    it('marks run as completed', async () => {
      const run = createTestRun({ id: 'run-1' });
      await repo.save(run);

      await repo.complete('run-1');

      const completed = await repo.findById('run-1');
      assert.ok(completed);
      assert.strictEqual(completed.status, 'completed');
      assert.ok(completed.completedAt instanceof Date);
    });
  });

  describe('fail', () => {
    it('marks run as failed with error', async () => {
      const run = createTestRun({ id: 'run-1' });
      await repo.save(run);

      await repo.fail('run-1', 'Something went wrong');

      const failed = await repo.findById('run-1');
      assert.ok(failed);
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.error, 'Something went wrong');
      assert.ok(failed.completedAt instanceof Date);
    });
  });

  describe('stop', () => {
    it('marks run as stopped', async () => {
      const run = createTestRun({ id: 'run-1' });
      await repo.save(run);

      await repo.stop('run-1');

      const stopped = await repo.findById('run-1');
      assert.ok(stopped);
      assert.strictEqual(stopped.status, 'stopped');
      assert.ok(stopped.completedAt instanceof Date);
    });
  });

  describe('delete', () => {
    it('deletes a run by id', async () => {
      const run = createTestRun({ id: 'run-1' });
      await repo.save(run);

      await repo.delete('run-1');

      const deleted = await repo.findById('run-1');
      assert.strictEqual(deleted, null);
    });
  });

  describe('deleteByWiki', () => {
    it('deletes all runs for a wiki', async () => {
      const wiki1Run1 = createTestRun({ wikiId: 'wiki-1' });
      const wiki1Run2 = createTestRun({ wikiId: 'wiki-1' });
      const wiki2Run = createTestRun({ wikiId: 'wiki-2' });

      await repo.save(wiki1Run1);
      await repo.save(wiki1Run2);
      await repo.save(wiki2Run);

      await repo.deleteByWiki('wiki-1');

      const wiki1Results = await repo.findByWiki('wiki-1');
      const wiki2Results = await repo.findByWiki('wiki-2');

      assert.strictEqual(wiki1Results.length, 0);
      assert.strictEqual(wiki2Results.length, 1);
    });
  });

  describe('findByRepo', () => {
    it('returns all runs for a repo regardless of wiki', async () => {
      const wiki1Run = createTestRun({ repoId: 'repo-1', wikiId: 'wiki-1' });
      const wiki2Run = createTestRun({ repoId: 'repo-1', wikiId: 'wiki-2' });
      const otherRepoRun = createTestRun({ repoId: 'repo-2', wikiId: 'wiki-3' });

      await repo.save(wiki1Run);
      await repo.save(wiki2Run);
      await repo.save(otherRepoRun);

      const results = await repo.findByRepo('repo-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.repoId === 'repo-1'));
    });
  });
});
