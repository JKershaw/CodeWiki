import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for the "focus strategy" in phased-orchestrator.
 *
 * The focus strategy addresses the "breadth over depth" problem by:
 * 1. Prioritizing "in-progress" directories (started but not at threshold)
 * 2. Limiting the number of directories explored per batch
 *
 * This ensures directories are completed to the phase threshold before
 * new directories are started, creating depth-first behavior within
 * the breadth-first phase structure.
 */

import {
  prioritizeDirectoriesForPhase,
  MAX_FOCUS_DIRECTORIES,
} from '../../src/agents/orchestrator/phased-orchestrator.js';
import type { UndocumentedDirectory } from '../../src/agents/orchestrator/context-gatherer.js';

describe('Phased Orchestrator Focus Strategy', () => {
  describe('prioritizeDirectoriesForPhase', () => {
    it('prioritizes in-progress directories over not-started ones', () => {
      const dirs: UndocumentedDirectory[] = [
        // Not started (100% undocumented)
        { path: 'src/new1', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/new2', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        // In progress (some work done, not at 30% threshold)
        { path: 'src/inprog1', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 }, // 20% coverage
        { path: 'src/inprog2', totalFiles: 10, undocumentedCount: 9, undocumentedRatio: 0.9 }, // 10% coverage
      ];

      // Phase 2 threshold is 30% coverage (70% undocumented ratio)
      const phaseThreshold = 0.70;
      const result = prioritizeDirectoriesForPhase(dirs, phaseThreshold);

      // In-progress directories should come first
      assert.strictEqual(result[0].path, 'src/inprog1');
      assert.strictEqual(result[1].path, 'src/inprog2');
      // Then not-started
      assert.strictEqual(result[2].path, 'src/new1');
      assert.strictEqual(result[3].path, 'src/new2');
    });

    it('excludes directories already at or above threshold', () => {
      const dirs: UndocumentedDirectory[] = [
        // At threshold (30% coverage = 70% undocumented)
        { path: 'src/done1', totalFiles: 10, undocumentedCount: 7, undocumentedRatio: 0.7 },
        // Above threshold (40% coverage)
        { path: 'src/done2', totalFiles: 10, undocumentedCount: 6, undocumentedRatio: 0.6 },
        // Below threshold
        { path: 'src/needswork', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 },
      ];

      const phaseThreshold = 0.70;
      const result = prioritizeDirectoriesForPhase(dirs, phaseThreshold);

      // Only directories below threshold should be included
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, 'src/needswork');
    });

    it('sorts in-progress directories by coverage (closest to threshold first)', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/far', totalFiles: 10, undocumentedCount: 9, undocumentedRatio: 0.9 },   // 10% coverage
        { path: 'src/close', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 }, // 20% coverage
        { path: 'src/closer', totalFiles: 10, undocumentedCount: 7.5, undocumentedRatio: 0.75 }, // 25% coverage
      ];

      const phaseThreshold = 0.70; // 30% coverage target
      const result = prioritizeDirectoriesForPhase(dirs, phaseThreshold);

      // Closest to threshold should come first (lowest undocumented ratio among in-progress)
      assert.strictEqual(result[0].path, 'src/closer'); // 25% - closest to 30%
      assert.strictEqual(result[1].path, 'src/close');  // 20%
      assert.strictEqual(result[2].path, 'src/far');    // 10%
    });

    it('handles all directories being not-started', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/b', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/c', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const phaseThreshold = 0.70;
      const result = prioritizeDirectoriesForPhase(dirs, phaseThreshold);

      // All should be included, alphabetically sorted (from deterministic sorting)
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].path, 'src/a');
      assert.strictEqual(result[1].path, 'src/b');
      assert.strictEqual(result[2].path, 'src/c');
    });

    it('handles all directories being at or above threshold', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 10, undocumentedCount: 7, undocumentedRatio: 0.7 },
        { path: 'src/b', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
      ];

      const phaseThreshold = 0.70;
      const result = prioritizeDirectoriesForPhase(dirs, phaseThreshold);

      // None should be included
      assert.strictEqual(result.length, 0);
    });

    it('handles empty input', () => {
      const result = prioritizeDirectoriesForPhase([], 0.70);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('MAX_FOCUS_DIRECTORIES constant', () => {
    it('is defined and reasonable', () => {
      assert.ok(MAX_FOCUS_DIRECTORIES > 0, 'MAX_FOCUS_DIRECTORIES should be positive');
      assert.ok(MAX_FOCUS_DIRECTORIES <= 5, 'MAX_FOCUS_DIRECTORIES should not be too high');
    });
  });
});
