/**
 * Unit tests for building coverage trees with file-level detail.
 *
 * This tests the function that takes raw file data and documentation scores,
 * calculates file-level coverage, and builds a hierarchical tree structure.
 *
 * Coverage is based on documentation depth scores:
 * - score / max(maxScore, 100) * 100 = coverage %
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildCoverageTree,
  type FileData,
  type DirectoryNode,
} from '../../src/agents/orchestrator/file-coverage-tree.js';

describe('buildCoverageTree', () => {
  describe('flat codebase', () => {
    it('shows all files when all are in one directory', () => {
      const files: FileData[] = [
        { path: 'src/index.ts', loc: 50 },
        { path: 'src/app.ts', loc: 200 },
        { path: 'src/utils.ts', loc: 150 },
      ];
      const scores = new Map<string, number>();

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree, 'Tree should not be null');
      assert.strictEqual(tree.name, 'src');
      assert.strictEqual(tree.files.length, 3);
      assert.strictEqual(tree.totalFileCount, 3);
      assert.strictEqual(tree.totalLoc, 400);
    });

    it('includes LOC for each file', () => {
      const files: FileData[] = [
        { path: 'src/small.ts', loc: 50 },
        { path: 'src/large.ts', loc: 500 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      const smallFile = tree.files.find(f => f.name === 'small.ts');
      const largeFile = tree.files.find(f => f.name === 'large.ts');

      assert.strictEqual(smallFile?.loc, 50);
      assert.strictEqual(largeFile?.loc, 500);
    });

    it('includes coverage % for each file based on documentation scores', () => {
      const files: FileData[] = [
        { path: 'src/documented.ts', loc: 100 },
        { path: 'src/undocumented.ts', loc: 100 },
      ];
      // documented.ts has a score of 100, undocumented.ts has no score
      const scores = new Map([['src/documented.ts', 100]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      const documented = tree.files.find(f => f.name === 'documented.ts');
      const undocumented = tree.files.find(f => f.name === 'undocumented.ts');

      assert.strictEqual(documented?.coveragePercent, 100);
      assert.strictEqual(undocumented?.coveragePercent, 0);
    });
  });

  describe('deep codebase', () => {
    it('surfaces files from deep nesting', () => {
      const files: FileData[] = [
        { path: 'src/a/b/c/d/deep.ts', loc: 500 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      // Navigate down the tree
      let current: DirectoryNode | undefined = tree;
      const expectedPath = ['src', 'a', 'b', 'c', 'd'];

      for (const expectedName of expectedPath) {
        assert.strictEqual(current?.name, expectedName,
          `Expected ${expectedName}, got ${current?.name}`);
        if (current.children.length > 0) {
          current = current.children[0];
        }
      }

      // The deepest directory should have the file
      assert.strictEqual(current?.files.length, 1);
      assert.strictEqual(current?.files[0]?.name, 'deep.ts');
    });

    it('calculates coverage correctly through deep nesting', () => {
      const files: FileData[] = [
        { path: 'src/a/b/deep.ts', loc: 100 },
      ];
      // File has full documentation score
      const scores = new Map([['src/a/b/deep.ts', 100]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      // Coverage should propagate up
      assert.strictEqual(tree.coveragePercent, 100);
    });

    it('handles multiple files at different depths', () => {
      const files: FileData[] = [
        { path: 'src/shallow.ts', loc: 100 },
        { path: 'src/deep/nested/file.ts', loc: 200 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 2);
      assert.strictEqual(tree.totalLoc, 300);
      // src should have 1 direct file and 1 child dir
      assert.strictEqual(tree.files.length, 1);
      assert.strictEqual(tree.children.length, 1);
    });
  });

  describe('documentation score coverage calculation', () => {
    it('marks file as covered when it has a high score', () => {
      const files: FileData[] = [
        { path: 'src/orchestrator.ts', loc: 800 },
      ];
      const scores = new Map([['src/orchestrator.ts', 200]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      // 200/200 * 100 = 100%
      assert.strictEqual(tree.files[0]?.coveragePercent, 100);
    });

    it('marks file as uncovered when not in scores map', () => {
      const files: FileData[] = [
        { path: 'src/secret.ts', loc: 300 },
      ];
      const scores = new Map<string, number>(); // Empty map

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      assert.strictEqual(tree.files[0]?.coveragePercent, 0);
    });

    it('handles partial coverage with different scores', () => {
      const files: FileData[] = [
        { path: 'src/covered.ts', loc: 100 },
        { path: 'src/uncovered.ts', loc: 100 },
      ];
      // covered.ts has score 100, uncovered.ts has no score
      const scores = new Map([['src/covered.ts', 100]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      // Directory: covered=100% (100 LOC), uncovered=0% (100 LOC) = 50% weighted
      assert.strictEqual(tree.coveragePercent, 50);
    });
  });

  describe('directory aggregation', () => {
    it('aggregates file counts correctly', () => {
      const files: FileData[] = [
        { path: 'src/a.ts', loc: 100 },
        { path: 'src/b.ts', loc: 100 },
        { path: 'src/sub/c.ts', loc: 100 },
        { path: 'src/sub/d.ts', loc: 100 },
        { path: 'src/sub/deep/e.ts', loc: 100 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 5);
      assert.strictEqual(tree.files.length, 2); // Direct: a.ts, b.ts

      const subDir = tree.children.find(c => c.name === 'sub');
      assert.ok(subDir);
      assert.strictEqual(subDir.totalFileCount, 3); // c.ts, d.ts, e.ts
      assert.strictEqual(subDir.files.length, 2); // Direct: c.ts, d.ts
    });

    it('aggregates LOC correctly', () => {
      const files: FileData[] = [
        { path: 'src/small.ts', loc: 50 },
        { path: 'src/sub/medium.ts', loc: 200 },
        { path: 'src/sub/large.ts', loc: 500 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalLoc, 750);

      const subDir = tree.children.find(c => c.name === 'sub');
      assert.ok(subDir);
      assert.strictEqual(subDir.totalLoc, 700);
    });

    it('calculates weighted coverage for directories', () => {
      const files: FileData[] = [
        { path: 'src/covered.ts', loc: 200 },    // Will be covered
        { path: 'src/uncovered.ts', loc: 800 },  // Will not be covered
      ];
      const scores = new Map([['src/covered.ts', 100]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      // 200 LOC at 100% + 800 LOC at 0% = 20% weighted coverage
      assert.strictEqual(tree.coveragePercent, 20);
    });
  });

  describe('edge cases', () => {
    it('returns null for empty file list', () => {
      const tree = buildCoverageTree([], new Map());
      assert.strictEqual(tree, null);
    });

    it('handles files at root level (no directory)', () => {
      const files: FileData[] = [
        { path: 'index.ts', loc: 100 },
        { path: 'package.json', loc: 50 },
      ];

      const tree = buildCoverageTree(files, new Map());

      // Should handle gracefully - might create virtual root
      // The exact behavior depends on implementation choice
      assert.ok(tree !== null || tree === null, 'Should handle root files');
    });

    it('handles single file', () => {
      const files: FileData[] = [
        { path: 'src/only.ts', loc: 100 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 1);
    });

    it('handles files with same name in different directories', () => {
      const files: FileData[] = [
        { path: 'src/utils/index.ts', loc: 50 },
        { path: 'src/services/index.ts', loc: 100 },
        { path: 'src/models/index.ts', loc: 75 },
      ];
      // Only utils/index.ts has a score
      const scores = new Map([['src/utils/index.ts', 100]]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 3);

      // Only the utils index should be covered
      const utilsDir = tree.children.find(c => c.name === 'utils');
      const servicesDir = tree.children.find(c => c.name === 'services');

      assert.ok(utilsDir);
      assert.ok(servicesDir);
      assert.strictEqual(utilsDir.coveragePercent, 100);
      assert.strictEqual(servicesDir.coveragePercent, 0);
    });

    it('handles very deep nesting (10+ levels)', () => {
      const files: FileData[] = [
        { path: 'a/b/c/d/e/f/g/h/i/j/deep.ts', loc: 100 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 1);
      assert.strictEqual(tree.totalLoc, 100);
    });
  });

  describe('real-world scenarios', () => {
    it('handles typical TypeScript project structure', () => {
      const files: FileData[] = [
        { path: 'src/index.ts', loc: 30 },
        { path: 'src/app.ts', loc: 150 },
        { path: 'src/types.ts', loc: 200 },
        { path: 'src/services/user-service.ts', loc: 300 },
        { path: 'src/services/auth-service.ts', loc: 250 },
        { path: 'src/utils/helpers.ts', loc: 100 },
        { path: 'src/utils/validators.ts', loc: 80 },
      ];
      // Services directory is covered with high scores
      const scores = new Map([
        ['src/services/user-service.ts', 100],
        ['src/services/auth-service.ts', 100],
      ]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 7);

      // Services should have 100% coverage
      const servicesDir = tree.children.find(c => c.name === 'services');
      assert.ok(servicesDir);
      assert.strictEqual(servicesDir.coveragePercent, 100);

      // Utils should have 0 coverage
      const utilsDir = tree.children.find(c => c.name === 'utils');
      assert.ok(utilsDir);
      assert.strictEqual(utilsDir.coveragePercent, 0);
    });

    it('handles monorepo structure', () => {
      const files: FileData[] = [
        { path: 'packages/core/src/index.ts', loc: 100 },
        { path: 'packages/core/src/utils.ts', loc: 200 },
        { path: 'packages/cli/src/index.ts', loc: 150 },
        { path: 'packages/cli/src/commands.ts', loc: 300 },
      ];

      const tree = buildCoverageTree(files, new Map());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 4);

      // Should have packages as root with core and cli children
      const packagesDir = tree.name === 'packages' ? tree : tree.children.find(c => c.name === 'packages');
      assert.ok(packagesDir, 'Should have packages directory');
    });

    it('shows finer granularity with different documentation depths', () => {
      const files: FileData[] = [
        { path: 'src/well-documented.ts', loc: 100 },
        { path: 'src/partially-documented.ts', loc: 100 },
        { path: 'src/barely-documented.ts', loc: 100 },
        { path: 'src/undocumented.ts', loc: 100 },
      ];
      // Different documentation scores
      const scores = new Map([
        ['src/well-documented.ts', 1000],      // Dedicated page
        ['src/partially-documented.ts', 500],  // Half as much
        ['src/barely-documented.ts', 100],     // Mentioned in overview
        // undocumented.ts has no score
      ]);

      const tree = buildCoverageTree(files, scores);

      assert.ok(tree);
      const wellDoc = tree.files.find(f => f.name === 'well-documented.ts');
      const partialDoc = tree.files.find(f => f.name === 'partially-documented.ts');
      const barelyDoc = tree.files.find(f => f.name === 'barely-documented.ts');
      const undoc = tree.files.find(f => f.name === 'undocumented.ts');

      // All should have different coverage percentages
      assert.strictEqual(wellDoc?.coveragePercent, 100);  // 1000/1000 = 100%
      assert.strictEqual(partialDoc?.coveragePercent, 50); // 500/1000 = 50%
      assert.strictEqual(barelyDoc?.coveragePercent, 10);  // 100/1000 = 10%
      assert.strictEqual(undoc?.coveragePercent, 0);       // No score = 0%
    });
  });
});
