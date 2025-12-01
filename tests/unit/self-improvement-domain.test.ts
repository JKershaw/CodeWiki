/**
 * Unit tests for Self-Improvement domain types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createSelfImprovementRun,
  completeSelfImprovementRun,
  failSelfImprovementRun,
  type SelfImprovementRun,
} from '../../src/domain/self-improvement.js';

describe('Self-Improvement Domain', () => {
  describe('createSelfImprovementRun', () => {
    it('creates a run in running state', () => {
      const run = createSelfImprovementRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['bench-1', 'bench-2', 'bench-3'],
        iterationRange: [10, 100],
      });

      assert.strictEqual(run.id, 'run-1');
      assert.strictEqual(run.repoId, 'repo-1');
      assert.strictEqual(run.wikiId, 'wiki-1');
      assert.strictEqual(run.status, 'running');
      assert.deepStrictEqual(run.benchmarkRunIds, ['bench-1', 'bench-2', 'bench-3']);
      assert.deepStrictEqual(run.iterationRange, [10, 100]);
      assert.strictEqual(run.report, '');
      assert.strictEqual(run.costUsd, 0);
      assert.strictEqual(run.error, null);
      assert.strictEqual(run.completedAt, null);
      assert.ok(run.startedAt instanceof Date);
    });

    it('handles empty benchmark run IDs', () => {
      const run = createSelfImprovementRun({
        id: 'run-2',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: [],
        iterationRange: [0, 0],
      });

      assert.deepStrictEqual(run.benchmarkRunIds, []);
      assert.deepStrictEqual(run.iterationRange, [0, 0]);
    });
  });

  describe('completeSelfImprovementRun', () => {
    it('marks run as completed with report', () => {
      const run = createSelfImprovementRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['bench-1'],
        iterationRange: [1, 50],
      });

      const report = '# Analysis Report\n\nThis is the report content.';
      const completed = completeSelfImprovementRun(run, report, 0.15);

      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.report, report);
      assert.strictEqual(completed.costUsd, 0.15);
      assert.ok(completed.completedAt instanceof Date);
      assert.strictEqual(completed.error, null);
      // Original fields preserved
      assert.strictEqual(completed.id, 'run-1');
      assert.strictEqual(completed.repoId, 'repo-1');
      assert.deepStrictEqual(completed.benchmarkRunIds, ['bench-1']);
    });

    it('does not mutate original run', () => {
      const run = createSelfImprovementRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['bench-1'],
        iterationRange: [1, 50],
      });

      completeSelfImprovementRun(run, 'report', 0.1);

      assert.strictEqual(run.status, 'running');
      assert.strictEqual(run.report, '');
      assert.strictEqual(run.completedAt, null);
    });
  });

  describe('failSelfImprovementRun', () => {
    it('marks run as failed with error', () => {
      const run = createSelfImprovementRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['bench-1'],
        iterationRange: [1, 50],
      });

      const failed = failSelfImprovementRun(run, 'LLM rate limit exceeded');

      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.error, 'LLM rate limit exceeded');
      assert.ok(failed.completedAt instanceof Date);
      assert.strictEqual(failed.report, '');
    });

    it('does not mutate original run', () => {
      const run = createSelfImprovementRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['bench-1'],
        iterationRange: [1, 50],
      });

      failSelfImprovementRun(run, 'error');

      assert.strictEqual(run.status, 'running');
      assert.strictEqual(run.error, null);
    });
  });
});
