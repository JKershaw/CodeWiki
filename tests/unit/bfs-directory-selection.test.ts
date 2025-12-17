import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for BFS-based directory selection in Phase 2 (Breadth).
 *
 * The BFS approach replaces the previous "focus strategy" with a simpler
 * breadth-first traversal that:
 * 1. Processes directories level by level
 * 2. Descends into covered directories to find uncovered children
 * 3. Naturally avoids the "round-robin" problem without complex prioritization
 */

import {
  getChildDirectories,
  isDirectoryCovered,
  selectDirectoriesForBreadthWork,
  MAX_FOCUS_DIRECTORIES,
} from '../../src/agents/orchestrator/phased-orchestrator.js';
import type { UndocumentedDirectory } from '../../src/agents/orchestrator/context-gatherer.js';

describe('BFS Directory Selection', () => {
  describe('getChildDirectories', () => {
    it('returns immediate children of root', () => {
      const allDirs = ['src', 'src/agents', 'src/services', 'src/agents/orchestrator'];
      const children = getChildDirectories('', allDirs);

      assert.deepStrictEqual(children, ['src']);
    });

    it('returns immediate children of a directory', () => {
      const allDirs = ['src', 'src/agents', 'src/services', 'src/utils', 'src/agents/orchestrator'];
      const children = getChildDirectories('src', allDirs);

      // Should be sorted alphabetically
      assert.deepStrictEqual(children, ['src/agents', 'src/services', 'src/utils']);
    });

    it('returns empty array for leaf directories', () => {
      const allDirs = ['src', 'src/agents', 'src/services'];
      const children = getChildDirectories('src/agents', allDirs);

      assert.deepStrictEqual(children, []);
    });

    it('does not return grandchildren', () => {
      const allDirs = ['src', 'src/agents', 'src/agents/orchestrator', 'src/agents/orchestrator/deep'];
      const children = getChildDirectories('src', allDirs);

      // Should only return src/agents, not deeper paths
      assert.deepStrictEqual(children, ['src/agents']);
    });

    it('handles multiple nested levels correctly', () => {
      const allDirs = [
        'src',
        'src/agents',
        'src/agents/orchestrator',
        'src/agents/explorer',
        'src/services',
        'src/services/api',
      ];

      // Children of src/agents should be orchestrator and explorer
      const agentsChildren = getChildDirectories('src/agents', allDirs);
      assert.deepStrictEqual(agentsChildren, ['src/agents/explorer', 'src/agents/orchestrator']);
    });

    it('sorts children alphabetically for determinism', () => {
      const allDirs = ['src', 'src/zebra', 'src/alpha', 'src/middle'];
      const children = getChildDirectories('src', allDirs);

      assert.deepStrictEqual(children, ['src/alpha', 'src/middle', 'src/zebra']);
    });

    it('handles empty directory list', () => {
      const children = getChildDirectories('src', []);
      assert.deepStrictEqual(children, []);
    });
  });

  describe('isDirectoryCovered', () => {
    it('returns true when >50% of files are touched (binary check)', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/agents',
        totalFiles: 10,
        untouchedCount: 4, // 6 touched = 60%
        untouchedRatio: 0.4,
        undocumentedCount: 4,
        undocumentedRatio: 0.4,
      };

      // useBinaryCheck=true uses untouchedRatio
      assert.strictEqual(isDirectoryCovered(dir, true), true);
    });

    it('returns false when <=50% of files are touched (binary check)', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/agents',
        totalFiles: 10,
        untouchedCount: 5, // 5 touched = 50%
        untouchedRatio: 0.5,
        undocumentedCount: 5,
        undocumentedRatio: 0.5,
      };

      assert.strictEqual(isDirectoryCovered(dir, true), false);
    });

    it('returns false for completely untouched directories', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/new',
        totalFiles: 10,
        untouchedCount: 10,
        untouchedRatio: 1.0,
        undocumentedCount: 10,
        undocumentedRatio: 1.0,
      };

      assert.strictEqual(isDirectoryCovered(dir, true), false);
    });

    it('returns true for fully touched directories', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/done',
        totalFiles: 10,
        untouchedCount: 0,
        untouchedRatio: 0.0,
        undocumentedCount: 0,
        undocumentedRatio: 0.0,
      };

      assert.strictEqual(isDirectoryCovered(dir, true), true);
    });

    it('uses graduated check when useBinaryCheck=false', () => {
      // Directory is touched but has low coverage (< 40% threshold)
      const dir: UndocumentedDirectory = {
        path: 'src/shallow',
        totalFiles: 10,
        untouchedCount: 0, // All touched
        untouchedRatio: 0.0,
        undocumentedCount: 8, // But only 20% have good coverage
        undocumentedRatio: 0.8,
      };

      // Binary check: covered (all files touched)
      assert.strictEqual(isDirectoryCovered(dir, true), true);
      // Graduated check: not covered (< 40% have good coverage)
      assert.strictEqual(isDirectoryCovered(dir, false), false);
    });
  });

  describe('selectDirectoriesForBreadthWork', () => {
    // Helper to create directory with both binary and graduated coverage
    const dir = (path: string, total: number, untouched: number, lowCov: number): UndocumentedDirectory => ({
      path,
      totalFiles: total,
      untouchedCount: untouched,
      untouchedRatio: untouched / total,
      undocumentedCount: lowCov,
      undocumentedRatio: lowCov / total,
    });

    it('selects untouched top-level directories first', () => {
      const directories: UndocumentedDirectory[] = [
        dir('src', 5, 5, 5),           // untouched
        dir('src/agents', 10, 10, 10), // untouched
        dir('src/services', 8, 8, 8),  // untouched
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should select 'src' first (top-level, untouched)
      assert.strictEqual(result[0], 'src');
    });

    it('descends into touched directories to find untouched children', () => {
      const directories: UndocumentedDirectory[] = [
        // src is touched (>50% files accessed)
        dir('src', 10, 4, 4),
        // children are NOT touched
        dir('src/agents', 10, 10, 10),
        dir('src/services', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should descend into src and select its untouched children
      assert.ok(result.includes('src/agents'));
      assert.ok(result.includes('src/services'));
      assert.ok(!result.includes('src')); // src is touched, shouldn't be selected
    });

    it('respects MAX_FOCUS_DIRECTORIES limit', () => {
      const directories: UndocumentedDirectory[] = [
        dir('src/a', 10, 10, 10),
        dir('src/b', 10, 10, 10),
        dir('src/c', 10, 10, 10),
        dir('src/d', 10, 10, 10),
        dir('src/e', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      assert.strictEqual(result.length, MAX_FOCUS_DIRECTORIES);
    });

    it('returns directories in BFS order (alphabetical at each level)', () => {
      const directories: UndocumentedDirectory[] = [
        dir('src/zebra', 10, 10, 10),
        dir('src/alpha', 10, 10, 10),
        dir('src/beta', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should be alphabetically sorted since they're all at same level
      assert.strictEqual(result[0], 'src/alpha');
      assert.strictEqual(result[1], 'src/beta');
      assert.strictEqual(result[2], 'src/zebra');
    });

    it('handles deeply nested structures', () => {
      const directories: UndocumentedDirectory[] = [
        // All parent directories touched (>50%)
        dir('src', 10, 2, 2),
        dir('src/agents', 10, 3, 3),
        dir('src/agents/orchestrator', 10, 4, 4),
        // Deep untouched directory
        dir('src/agents/orchestrator/deep', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should descend through touched directories to find the untouched one
      assert.ok(result.includes('src/agents/orchestrator/deep'));
    });

    it('handles empty input', () => {
      const result = selectDirectoriesForBreadthWork([]);
      assert.deepStrictEqual(result, []);
    });

    it('handles all directories being mostly touched via fallback', () => {
      const directories: UndocumentedDirectory[] = [
        dir('src', 10, 2, 2),        // 80% touched but still has 2 untouched
        dir('src/agents', 10, 3, 3), // 70% touched but still has 3 untouched
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Fallback selects directories with ANY untouched files, sorted by count
      assert.deepStrictEqual(result, ['src/agents', 'src']);
    });

    it('returns empty when all files are completely touched', () => {
      const directories: UndocumentedDirectory[] = [
        dir('src', 10, 0, 0),        // 100% touched, 0 untouched
        dir('src/agents', 10, 0, 0), // 100% touched, 0 untouched
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // No untouched files anywhere, return empty
      assert.deepStrictEqual(result, []);
    });

    it('handles mixed coverage at same level', () => {
      const directories: UndocumentedDirectory[] = [
        // src is touched, should descend
        dir('src', 10, 2, 2),
        // src/agents is NOT touched, should select
        dir('src/agents', 10, 8, 8),
        // src/services is touched, should descend
        dir('src/services', 10, 3, 3),
        // src/services/api is NOT touched, should select
        dir('src/services/api', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should select untouched ones from BFS traversal
      assert.ok(result.includes('src/agents'));
      assert.ok(result.includes('src/services/api'));
    });

    it('processes siblings before children (true BFS)', () => {
      const directories: UndocumentedDirectory[] = [
        // src is touched
        dir('src', 10, 2, 2),
        // src/agents is NOT touched
        dir('src/agents', 10, 8, 8),
        // src/agents has an untouched child too
        dir('src/agents/orchestrator', 10, 10, 10),
        // src/services is NOT touched (sibling of src/agents)
        dir('src/services', 10, 8, 8),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should select src/agents and src/services (siblings) before src/agents/orchestrator (child)
      const agentsIndex = result.indexOf('src/agents');
      const servicesIndex = result.indexOf('src/services');
      const orchestratorIndex = result.indexOf('src/agents/orchestrator');

      // Both siblings should be selected
      assert.ok(agentsIndex >= 0, 'src/agents should be selected');
      assert.ok(servicesIndex >= 0, 'src/services should be selected');

      // Orchestrator might not be selected due to MAX_FOCUS_DIRECTORIES limit
      // but if it is, it should come after the siblings
      if (orchestratorIndex >= 0) {
        assert.ok(orchestratorIndex > agentsIndex);
        assert.ok(orchestratorIndex > servicesIndex);
      }
    });

    it('identifies source roots correctly from directory paths', () => {
      // Directories without a common parent in the list
      const directories: UndocumentedDirectory[] = [
        dir('src/agents', 10, 10, 10),
        dir('src/services', 10, 10, 10),
        dir('lib/utils', 10, 10, 10),
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should treat src/agents, src/services, lib/utils as top-level since no 'src' or 'lib' parent exists
      assert.strictEqual(result.length, 3);
    });
  });

  describe('MAX_FOCUS_DIRECTORIES constant', () => {
    it('is defined and reasonable', () => {
      assert.ok(MAX_FOCUS_DIRECTORIES > 0, 'MAX_FOCUS_DIRECTORIES should be positive');
      assert.ok(MAX_FOCUS_DIRECTORIES <= 5, 'MAX_FOCUS_DIRECTORIES should not be too high');
    });
  });
});
