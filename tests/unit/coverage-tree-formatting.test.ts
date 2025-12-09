/**
 * Unit tests for coverage tree formatting.
 *
 * The formatter converts the tree structure into a readable ASCII
 * representation with coverage percentages, LOC counts, and warning markers.
 *
 * TDD Phase 5: Define formatting behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatCoverageTreeWithFiles,
  createFileNode as createFileNodeImpl,
  createDirectoryNode,
  type FileNode,
  type DirectoryNode,
} from '../../src/agents/orchestrator/file-coverage-tree.js';

// Helper to create test nodes (wraps implementation)
function createFileNode(path: string, loc: number, coveragePercent: number): FileNode {
  return createFileNodeImpl(path, loc, coveragePercent);
}

function createDirNode(
  path: string,
  files: FileNode[] = [],
  children: DirectoryNode[] = []
): DirectoryNode {
  return createDirectoryNode(path, files, children);
}

describe('formatCoverageTreeWithFiles', () => {
  describe('basic formatting', () => {
    it('shows files with LOC and coverage', () => {
      const file = createFileNode('src/app.ts', 200, 30);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('app.ts'), 'Should include filename');
      assert.ok(output.includes('200 loc'), 'Should include LOC');
      assert.ok(output.includes('30%'), 'Should include coverage');
    });

    it('shows directories with aggregate stats', () => {
      const files = [
        createFileNode('src/a.ts', 100, 50),
        createFileNode('src/b.ts', 200, 50),
      ];
      const root = createDirNode('src', files);

      const output = formatCoverageTreeWithFiles(
        root,
        files,
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('src/'), 'Should include directory');
      assert.ok(output.includes('2 files'), 'Should include file count');
      assert.ok(output.includes('300 loc'), 'Should include total LOC');
      assert.ok(output.includes('50%'), 'Should include coverage');
    });

    it('marks low-coverage items with warning emoji', () => {
      const file = createFileNode('src/uncovered.ts', 500, 10);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('⚠️'), 'Should include warning emoji for low coverage');
    });

    it('does not mark high-coverage items with warning', () => {
      const file = createFileNode('src/covered.ts', 100, 80);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      // Count occurrences of warning - should be 0
      const warningCount = (output.match(/⚠️/g) ?? []).length;
      assert.strictEqual(warningCount, 0, 'Should not have warning for 80% coverage');
    });
  });

  describe('tree structure', () => {
    it('preserves ASCII tree structure', () => {
      const innerFile = createFileNode('src/agents/main.ts', 100, 0);
      const innerDir = createDirNode('src/agents', [innerFile]);
      const outerFile = createFileNode('src/index.ts', 50, 100);
      const root = createDirNode('src', [outerFile], [innerDir]);

      const output = formatCoverageTreeWithFiles(
        root,
        [innerFile, outerFile],
        ['src', 'src/agents'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      // Should have tree connectors
      assert.ok(output.includes('├──') || output.includes('└──'),
        'Should include tree connectors');
    });

    it('correctly nests multiple levels', () => {
      const deepFile = createFileNode('src/a/b/c.ts', 100, 0);
      const cDir = createDirNode('src/a/b', [deepFile]);
      const bDir = createDirNode('src/a', [], [cDir]);
      const root = createDirNode('src', [], [bDir]);

      const output = formatCoverageTreeWithFiles(
        root,
        [deepFile],
        ['src', 'src/a', 'src/a/b'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      // All levels should appear
      assert.ok(output.includes('src/'), 'Should include src/');
      assert.ok(output.includes('a/'), 'Should include a/');
      assert.ok(output.includes('b/'), 'Should include b/');
      assert.ok(output.includes('c.ts'), 'Should include c.ts');
    });

    it('sorts children by coverage ascending', () => {
      const files = [
        createFileNode('src/high.ts', 100, 80),
        createFileNode('src/low.ts', 100, 10),
        createFileNode('src/medium.ts', 100, 40),
      ];
      const root = createDirNode('src', files);

      const output = formatCoverageTreeWithFiles(
        root,
        files,
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      const lines = output.split('\n');
      const lowIndex = lines.findIndex(l => l.includes('low.ts'));
      const mediumIndex = lines.findIndex(l => l.includes('medium.ts'));
      const highIndex = lines.findIndex(l => l.includes('high.ts'));

      assert.ok(lowIndex < mediumIndex, 'low should appear before medium');
      assert.ok(mediumIndex < highIndex, 'medium should appear before high');
    });
  });

  describe('truncation summary', () => {
    it('shows truncation summary when files are hidden', () => {
      const file = createFileNode('src/shown.ts', 100, 0);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 5, hiddenDirCount: 0, effectiveThreshold: 30, wasTruncated: true }
      );

      assert.ok(output.includes('5 files'), 'Should mention hidden files');
      assert.ok(output.includes('hidden'), 'Should mention hidden');
      assert.ok(output.includes('30%'), 'Should show effective threshold');
    });

    it('shows directory count when directories are hidden', () => {
      const file = createFileNode('src/a.ts', 100, 0);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 3, hiddenDirCount: 2, effectiveThreshold: 40, wasTruncated: true }
      );

      assert.ok(output.includes('2 directories'), 'Should mention hidden directories');
    });

    it('does not show summary when nothing is hidden', () => {
      const file = createFileNode('src/a.ts', 100, 0);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(!output.includes('hidden'), 'Should not mention hidden');
    });
  });

  describe('edge cases', () => {
    it('handles null tree', () => {
      const output = formatCoverageTreeWithFiles(
        null,
        [],
        [],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('No source directory'), 'Should show placeholder');
    });

    it('handles empty directory', () => {
      const root = createDirNode('src', [], []);

      const output = formatCoverageTreeWithFiles(
        root,
        [],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('src/'), 'Should show directory');
      assert.ok(output.includes('0 files'), 'Should show 0 files');
    });

    it('rounds coverage percentages', () => {
      const file = createFileNode('src/a.ts', 100, 33.33);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      // Should round to 33%, not show 33.33%
      assert.ok(output.includes('33%'), 'Should round coverage');
      assert.ok(!output.includes('33.33'), 'Should not show decimal');
    });

    it('handles 0% coverage', () => {
      const file = createFileNode('src/uncovered.ts', 500, 0);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('0%'), 'Should show 0%');
    });

    it('handles 100% coverage', () => {
      const file = createFileNode('src/covered.ts', 100, 100);
      const root = createDirNode('src', [file]);

      const output = formatCoverageTreeWithFiles(
        root,
        [file],
        ['src'],
        { hiddenFileCount: 0, hiddenDirCount: 0, effectiveThreshold: 100, wasTruncated: false }
      );

      assert.ok(output.includes('100%'), 'Should show 100%');
    });
  });

  describe('real-world output', () => {
    it('produces expected output for typical structure', () => {
      // Build a realistic tree
      const orchestratorFile = createFileNode('src/agents/orchestrator/main.ts', 850, 0);
      const contextFile = createFileNode('src/agents/orchestrator/context.ts', 650, 0);
      const orchestratorDir = createDirNode('src/agents/orchestrator', [orchestratorFile, contextFile]);

      const baseAgentFile = createFileNode('src/agents/base.ts', 200, 100);
      const agentsDir = createDirNode('src/agents', [baseAgentFile], [orchestratorDir]);

      const indexFile = createFileNode('src/index.ts', 50, 100);
      const root = createDirNode('src', [indexFile], [agentsDir]);

      const selectedFiles = [orchestratorFile, contextFile];
      const selectedDirs = ['src', 'src/agents', 'src/agents/orchestrator'];

      const output = formatCoverageTreeWithFiles(
        root,
        selectedFiles,
        selectedDirs,
        { hiddenFileCount: 2, hiddenDirCount: 0, effectiveThreshold: 0, wasTruncated: true }
      );

      // Verify structure
      assert.ok(output.includes('src/'), 'Should include src/');
      assert.ok(output.includes('agents/'), 'Should include agents/');
      assert.ok(output.includes('orchestrator/'), 'Should include orchestrator/');
      assert.ok(output.includes('main.ts'), 'Should include main.ts');
      assert.ok(output.includes('context.ts'), 'Should include context.ts');
      assert.ok(output.includes('850 loc'), 'Should include LOC for main.ts');
      assert.ok(output.includes('⚠️'), 'Should have warning markers');
      assert.ok(output.includes('2 files'), 'Should show hidden file count');
    });
  });
});
