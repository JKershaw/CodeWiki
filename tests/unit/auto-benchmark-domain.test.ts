/**
 * Unit tests for AutoBenchmark domain model.
 * Tests the domain types and factory functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createAutoBenchmarkRun,
  type AutoBenchmarkRun,
  type AutoBenchmarkConfig,
  type AutoBenchmarkPhase,
  type AutoBenchmarkStatus,
} from '../../src/domain/auto-benchmark.js';

describe('AutoBenchmark Domain', () => {
  describe('createAutoBenchmarkRun', () => {
    it('creates a new auto-benchmark run with default values', () => {
      const run = createAutoBenchmarkRun({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: {
          iterationsPerCycle: 5,
          maxCycles: 10,
          includeQuality: false,
        },
      });

      assert.strictEqual(run.id, 'run-1');
      assert.strictEqual(run.repoId, 'repo-1');
      assert.strictEqual(run.wikiId, 'wiki-1');
      assert.strictEqual(run.status, 'running');
      assert.strictEqual(run.currentCycle, 1);
      assert.strictEqual(run.currentPhase, 'iterations');
      assert.strictEqual(run.config.iterationsPerCycle, 5);
      assert.strictEqual(run.config.maxCycles, 10);
      assert.strictEqual(run.config.includeQuality, false);
      assert.ok(run.startedAt instanceof Date);
      assert.strictEqual(run.completedAt, null);
      assert.strictEqual(run.error, null);
    });

    it('creates a run with includeQuality enabled', () => {
      const run = createAutoBenchmarkRun({
        id: 'run-2',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        config: {
          iterationsPerCycle: 3,
          maxCycles: 5,
          includeQuality: true,
        },
      });

      assert.strictEqual(run.config.includeQuality, true);
    });

    it('validates iterationsPerCycle is positive', () => {
      assert.throws(
        () => createAutoBenchmarkRun({
          id: 'run-3',
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          config: {
            iterationsPerCycle: 0,
            maxCycles: 10,
            includeQuality: false,
          },
        }),
        /iterationsPerCycle must be positive/
      );

      assert.throws(
        () => createAutoBenchmarkRun({
          id: 'run-3',
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          config: {
            iterationsPerCycle: -1,
            maxCycles: 10,
            includeQuality: false,
          },
        }),
        /iterationsPerCycle must be positive/
      );
    });

    it('validates maxCycles is positive', () => {
      assert.throws(
        () => createAutoBenchmarkRun({
          id: 'run-4',
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          config: {
            iterationsPerCycle: 5,
            maxCycles: 0,
            includeQuality: false,
          },
        }),
        /maxCycles must be positive/
      );
    });
  });

  describe('AutoBenchmarkPhase type', () => {
    it('supports all expected phase values', () => {
      const phases: AutoBenchmarkPhase[] = ['iterations', 'accuracy', 'quality', 'complete'];
      assert.strictEqual(phases.length, 4);
    });
  });

  describe('AutoBenchmarkStatus type', () => {
    it('supports all expected status values', () => {
      const statuses: AutoBenchmarkStatus[] = ['running', 'completed', 'failed', 'stopped'];
      assert.strictEqual(statuses.length, 4);
    });
  });

  describe('AutoBenchmarkConfig type', () => {
    it('allows valid configuration', () => {
      const config: AutoBenchmarkConfig = {
        iterationsPerCycle: 5,
        maxCycles: 10,
        includeQuality: true,
      };
      assert.strictEqual(config.iterationsPerCycle, 5);
      assert.strictEqual(config.maxCycles, 10);
      assert.strictEqual(config.includeQuality, true);
    });
  });
});
