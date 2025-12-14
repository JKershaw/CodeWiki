import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for deterministic directory sorting in context-gatherer.
 *
 * The sorting algorithm must be deterministic to ensure consistent
 * directory selection across orchestrator iterations. Without deterministic
 * sorting, directories with equal coverage ratios may be selected in
 * different orders, causing the "round-robin" problem where no directory
 * gets completed before others are started.
 */

// Import the sorting function once exported
import { sortUndocumentedDirectories } from '../../src/agents/orchestrator/context-gatherer.js';
import type { UndocumentedDirectory } from '../../src/agents/orchestrator/context-gatherer.js';

describe('Context Gatherer Directory Sorting', () => {
  describe('sortUndocumentedDirectories', () => {
    it('sorts by undocumented ratio descending (highest first)', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
        { path: 'src/b', totalFiles: 10, undocumentedCount: 8, undocumentedRatio: 0.8 },
        { path: 'src/c', totalFiles: 10, undocumentedCount: 3, undocumentedRatio: 0.3 },
      ];

      const sorted = sortUndocumentedDirectories(dirs);

      assert.strictEqual(sorted[0].path, 'src/b'); // 80% undocumented
      assert.strictEqual(sorted[1].path, 'src/a'); // 50% undocumented
      assert.strictEqual(sorted[2].path, 'src/c'); // 30% undocumented
    });

    it('uses alphabetical path as tie-breaker when ratios are equal', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/zebra', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/alpha', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/beta', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const sorted = sortUndocumentedDirectories(dirs);

      // All have same ratio, should be alphabetical
      assert.strictEqual(sorted[0].path, 'src/alpha');
      assert.strictEqual(sorted[1].path, 'src/beta');
      assert.strictEqual(sorted[2].path, 'src/zebra');
    });

    it('produces consistent ordering across multiple calls', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/services', totalFiles: 20, undocumentedCount: 20, undocumentedRatio: 1.0 },
        { path: 'src/agents', totalFiles: 15, undocumentedCount: 15, undocumentedRatio: 1.0 },
        { path: 'src/utils', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/domain', totalFiles: 12, undocumentedCount: 12, undocumentedRatio: 1.0 },
      ];

      // Call multiple times with different input orders
      const sorted1 = sortUndocumentedDirectories([...dirs]);
      const sorted2 = sortUndocumentedDirectories([...dirs].reverse());
      const sorted3 = sortUndocumentedDirectories([dirs[2], dirs[0], dirs[3], dirs[1]]);

      // All should produce the same order
      const paths1 = sorted1.map(d => d.path);
      const paths2 = sorted2.map(d => d.path);
      const paths3 = sorted3.map(d => d.path);

      assert.deepStrictEqual(paths1, paths2);
      assert.deepStrictEqual(paths2, paths3);

      // Should be alphabetical since all have same ratio
      assert.deepStrictEqual(paths1, [
        'src/agents',
        'src/domain',
        'src/services',
        'src/utils',
      ]);
    });

    it('handles mixed ratios with some equal values', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/z-module', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
        { path: 'src/a-module', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
        { path: 'src/high', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/low', totalFiles: 10, undocumentedCount: 2, undocumentedRatio: 0.2 },
      ];

      const sorted = sortUndocumentedDirectories(dirs);

      // Should be: 1.0 first, then 0.5s alphabetically, then 0.2
      assert.strictEqual(sorted[0].path, 'src/high');      // 1.0
      assert.strictEqual(sorted[1].path, 'src/a-module');  // 0.5, alphabetically first
      assert.strictEqual(sorted[2].path, 'src/z-module');  // 0.5, alphabetically second
      assert.strictEqual(sorted[3].path, 'src/low');       // 0.2
    });

    it('handles empty array', () => {
      const sorted = sortUndocumentedDirectories([]);
      assert.deepStrictEqual(sorted, []);
    });

    it('handles single directory', () => {
      const dirs: UndocumentedDirectory[] = [
        { path: 'src/only', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
      ];

      const sorted = sortUndocumentedDirectories(dirs);
      assert.strictEqual(sorted.length, 1);
      assert.strictEqual(sorted[0].path, 'src/only');
    });
  });
});
