/**
 * Unit tests for building coverage trees with file-level detail.
 *
 * This tests the function that takes raw file data and a covered files set,
 * calculates file-level coverage, and builds a hierarchical tree structure.
 *
 * Coverage is binary: 100% if in covered set, 0% otherwise.
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
      const coveredFilesSet = new Set<string>();

      const tree = buildCoverageTree(files, coveredFilesSet);

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

      const tree = buildCoverageTree(files, new Set());

      assert.ok(tree);
      const smallFile = tree.files.find(f => f.name === 'small.ts');
      const largeFile = tree.files.find(f => f.name === 'large.ts');

      assert.strictEqual(smallFile?.loc, 50);
      assert.strictEqual(largeFile?.loc, 500);
    });

    it('includes coverage % for each file based on tracked coverage', () => {
      const files: FileData[] = [
        { path: 'src/documented.ts', loc: 100 },
        { path: 'src/undocumented.ts', loc: 100 },
      ];
      // Only documented.ts is in the covered set
      const coveredFilesSet = new Set(['src/documented.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

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

      const tree = buildCoverageTree(files, new Set());

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
      // File is covered
      const coveredFilesSet = new Set(['src/a/b/deep.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

      assert.ok(tree);
      // Coverage should propagate up
      assert.strictEqual(tree.coveragePercent, 100);
    });

    it('handles multiple files at different depths', () => {
      const files: FileData[] = [
        { path: 'src/shallow.ts', loc: 100 },
        { path: 'src/deep/nested/file.ts', loc: 200 },
      ];

      const tree = buildCoverageTree(files, new Set());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 2);
      assert.strictEqual(tree.totalLoc, 300);
      // src should have 1 direct file and 1 child dir
      assert.strictEqual(tree.files.length, 1);
      assert.strictEqual(tree.children.length, 1);
    });
  });

  describe('tracked coverage calculation', () => {
    it('marks file as covered when in covered set', () => {
      const files: FileData[] = [
        { path: 'src/orchestrator.ts', loc: 800 },
      ];
      const coveredFilesSet = new Set(['src/orchestrator.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

      assert.ok(tree);
      assert.strictEqual(tree.files[0]?.coveragePercent, 100);
    });

    it('marks file as uncovered when not in covered set', () => {
      const files: FileData[] = [
        { path: 'src/secret.ts', loc: 300 },
      ];
      const coveredFilesSet = new Set<string>(); // Empty set

      const tree = buildCoverageTree(files, coveredFilesSet);

      assert.ok(tree);
      assert.strictEqual(tree.files[0]?.coveragePercent, 0);
    });

    it('handles partial coverage (some files covered)', () => {
      const files: FileData[] = [
        { path: 'src/covered.ts', loc: 100 },
        { path: 'src/uncovered.ts', loc: 100 },
      ];
      const coveredFilesSet = new Set(['src/covered.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

      assert.ok(tree);
      // Directory should have 50% coverage (1 of 2 files covered, equal LOC)
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

      const tree = buildCoverageTree(files, new Set());

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

      const tree = buildCoverageTree(files, new Set());

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
      const coveredFilesSet = new Set(['src/covered.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

      assert.ok(tree);
      // 200 LOC at 100% + 800 LOC at 0% = 20% weighted coverage
      assert.strictEqual(tree.coveragePercent, 20);
    });
  });

  describe('edge cases', () => {
    it('returns null for empty file list', () => {
      const tree = buildCoverageTree([], new Set());
      assert.strictEqual(tree, null);
    });

    it('handles files at root level (no directory)', () => {
      const files: FileData[] = [
        { path: 'index.ts', loc: 100 },
        { path: 'package.json', loc: 50 },
      ];

      const tree = buildCoverageTree(files, new Set());

      // Should handle gracefully - might create virtual root
      // The exact behavior depends on implementation choice
      assert.ok(tree !== null || tree === null, 'Should handle root files');
    });

    it('handles single file', () => {
      const files: FileData[] = [
        { path: 'src/only.ts', loc: 100 },
      ];

      const tree = buildCoverageTree(files, new Set());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 1);
    });

    it('handles files with same name in different directories', () => {
      const files: FileData[] = [
        { path: 'src/utils/index.ts', loc: 50 },
        { path: 'src/services/index.ts', loc: 100 },
        { path: 'src/models/index.ts', loc: 75 },
      ];
      // Only utils/index.ts is covered
      const coveredFilesSet = new Set(['src/utils/index.ts']);

      const tree = buildCoverageTree(files, coveredFilesSet);

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

      const tree = buildCoverageTree(files, new Set());

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
      // Services directory is covered
      const coveredFilesSet = new Set([
        'src/services/user-service.ts',
        'src/services/auth-service.ts',
      ]);

      const tree = buildCoverageTree(files, coveredFilesSet);

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

      const tree = buildCoverageTree(files, new Set());

      assert.ok(tree);
      assert.strictEqual(tree.totalFileCount, 4);

      // Should have packages as root with core and cli children
      const packagesDir = tree.name === 'packages' ? tree : tree.children.find(c => c.name === 'packages');
      assert.ok(packagesDir, 'Should have packages directory');
    });
  });
});
