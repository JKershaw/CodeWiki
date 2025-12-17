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
    it('returns true when >50% of files are touched', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/agents',
        totalFiles: 10,
        undocumentedCount: 4, // 6 documented = 60%
        undocumentedRatio: 0.4,
      };

      assert.strictEqual(isDirectoryCovered(dir), true);
    });

    it('returns false when <=50% of files are touched', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/agents',
        totalFiles: 10,
        undocumentedCount: 5, // 5 documented = 50%
        undocumentedRatio: 0.5,
      };

      assert.strictEqual(isDirectoryCovered(dir), false);
    });

    it('returns false for completely undocumented directories', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/new',
        totalFiles: 10,
        undocumentedCount: 10, // 0 documented = 0%
        undocumentedRatio: 1.0,
      };

      assert.strictEqual(isDirectoryCovered(dir), false);
    });

    it('returns true for fully documented directories', () => {
      const dir: UndocumentedDirectory = {
        path: 'src/done',
        totalFiles: 10,
        undocumentedCount: 0, // 10 documented = 100%
        undocumentedRatio: 0.0,
      };

      assert.strictEqual(isDirectoryCovered(dir), true);
    });

    it('uses 50% threshold by default', () => {
      // Just at 50% - should be false (<=50%)
      const at50: UndocumentedDirectory = {
        path: 'src/half',
        totalFiles: 10,
        undocumentedCount: 5,
        undocumentedRatio: 0.5,
      };
      assert.strictEqual(isDirectoryCovered(at50), false);

      // Just above 50% - should be true (>50%)
      const above50: UndocumentedDirectory = {
        path: 'src/half',
        totalFiles: 10,
        undocumentedCount: 4,
        undocumentedRatio: 0.4,
      };
      assert.strictEqual(isDirectoryCovered(above50), true);
    });
  });

  describe('selectDirectoriesForBreadthWork', () => {
    it('selects uncovered top-level directories first', () => {
      const directories: UndocumentedDirectory[] = [
        { path: 'src', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 8, undocumentedCount: 8, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should select 'src' first (top-level, uncovered)
      assert.strictEqual(result[0], 'src');
    });

    it('descends into covered directories to find uncovered children', () => {
      const directories: UndocumentedDirectory[] = [
        // src is covered (>50%)
        { path: 'src', totalFiles: 10, undocumentedCount: 4, undocumentedRatio: 0.4 },
        // children are not covered
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should descend into src and select its uncovered children
      assert.ok(result.includes('src/agents'));
      assert.ok(result.includes('src/services'));
      assert.ok(!result.includes('src')); // src is covered, shouldn't be selected
    });

    it('respects MAX_FOCUS_DIRECTORIES limit', () => {
      const directories: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/b', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/c', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/d', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/e', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      assert.strictEqual(result.length, MAX_FOCUS_DIRECTORIES);
    });

    it('returns directories in BFS order (alphabetical at each level)', () => {
      const directories: UndocumentedDirectory[] = [
        { path: 'src/zebra', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/alpha', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/beta', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should be alphabetically sorted since they're all at same level
      assert.strictEqual(result[0], 'src/alpha');
      assert.strictEqual(result[1], 'src/beta');
      assert.strictEqual(result[2], 'src/zebra');
    });

    it('handles deeply nested structures', () => {
      const directories: UndocumentedDirectory[] = [
        // All parent directories covered
        { path: 'src', totalFiles: 10, undocumentedCount: 2, undocumentedRatio: 0.2 },
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 3, undocumentedRatio: 0.3 },
        { path: 'src/agents/orchestrator', totalFiles: 10, undocumentedCount: 4, undocumentedRatio: 0.4 },
        // Deep uncovered directory
        { path: 'src/agents/orchestrator/deep', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should descend through covered directories to find the uncovered one
      assert.ok(result.includes('src/agents/orchestrator/deep'));
    });

    it('handles empty input', () => {
      const result = selectDirectoriesForBreadthWork([]);
      assert.deepStrictEqual(result, []);
    });

    it('handles all directories being covered', () => {
      const directories: UndocumentedDirectory[] = [
        { path: 'src', totalFiles: 10, undocumentedCount: 2, undocumentedRatio: 0.2 },
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 3, undocumentedRatio: 0.3 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // No uncovered directories to select
      assert.deepStrictEqual(result, []);
    });

    it('handles mixed coverage at same level', () => {
      const directories: UndocumentedDirectory[] = [
        // src is covered, should descend
        { path: 'src', totalFiles: 10, undocumentedCount: 2, undocumentedRatio: 0.2 },
        // src/agents is NOT covered, should select
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 },
        // src/services is covered, should descend
        { path: 'src/services', totalFiles: 10, undocumentedCount: 3, undocumentedRatio: 0.3 },
        // src/services/api is NOT covered, should select
        { path: 'src/services/api', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const result = selectDirectoriesForBreadthWork(directories);

      // Should select uncovered ones from BFS traversal
      assert.ok(result.includes('src/agents'));
      assert.ok(result.includes('src/services/api'));
    });

    it('processes siblings before children (true BFS)', () => {
      const directories: UndocumentedDirectory[] = [
        // src is covered
        { path: 'src', totalFiles: 10, undocumentedCount: 2, undocumentedRatio: 0.2 },
        // src/agents is NOT covered
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 },
        // src/agents has an uncovered child too
        { path: 'src/agents/orchestrator', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        // src/services is NOT covered (sibling of src/agents)
        { path: 'src/services', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 },
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
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'lib/utils', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
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
