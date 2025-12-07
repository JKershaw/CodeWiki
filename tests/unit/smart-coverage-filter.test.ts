import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  filterCoverageItems,
  type CoverageItem,
  type FilteredCoverageResult,
} from '../../src/agents/orchestrator/smart-coverage-filter.js';
import {
  ContextGatherer,
  type DirectoryNode,
} from '../../src/agents/orchestrator/context-gatherer.js';

describe('filterCoverageItems', () => {
  describe('basic filtering and sorting', () => {
    it('should sort items by coverage ascending (lowest first)', () => {
      const items: CoverageItem[] = [
        { path: 'src/high', coveragePercent: 80 },
        { path: 'src/low', coveragePercent: 10 },
        { path: 'src/medium', coveragePercent: 50 },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      assert.deepStrictEqual(result.items.map(i => i.path), [
        'src/low',
        'src/medium',
        'src/high',
      ]);
    });

    it('should return all items when count is below target', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 30 },
        { path: 'src/b', coveragePercent: 20 },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.truncated, false);
    });

    it('should truncate to target count when items exceed limit', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 10 },
        { path: 'src/b', coveragePercent: 20 },
        { path: 'src/c', coveragePercent: 30 },
        { path: 'src/d', coveragePercent: 40 },
        { path: 'src/e', coveragePercent: 50 },
      ];

      const result = filterCoverageItems(items, { targetCount: 3 });

      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.truncatedCount, 2);
      // Should have the 3 lowest coverage items
      assert.deepStrictEqual(result.items.map(i => i.path), [
        'src/a',
        'src/b',
        'src/c',
      ]);
    });
  });

  describe('dynamic threshold behavior', () => {
    it('should report the effective threshold (coverage of last included item)', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 10 },
        { path: 'src/b', coveragePercent: 25 },
        { path: 'src/c', coveragePercent: 40 },
        { path: 'src/d', coveragePercent: 60 },
        { path: 'src/e', coveragePercent: 80 },
      ];

      const result = filterCoverageItems(items, { targetCount: 3 });

      // Last included item has 40% coverage
      assert.strictEqual(result.effectiveThreshold, 40);
    });

    it('should have threshold of 100 when all items included', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 10 },
        { path: 'src/b', coveragePercent: 50 },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      assert.strictEqual(result.effectiveThreshold, 100);
      assert.strictEqual(result.truncated, false);
    });

    it('should handle all items having same coverage', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 50 },
        { path: 'src/b', coveragePercent: 50 },
        { path: 'src/c', coveragePercent: 50 },
      ];

      const result = filterCoverageItems(items, { targetCount: 2 });

      assert.strictEqual(result.items.length, 2);
      assert.strictEqual(result.effectiveThreshold, 50);
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const result = filterCoverageItems([], { targetCount: 10 });

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.truncated, false);
      assert.strictEqual(result.effectiveThreshold, 100);
    });

    it('should handle target count of zero', () => {
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 10 },
      ];

      const result = filterCoverageItems(items, { targetCount: 0 });

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.truncated, true);
    });

    it('should handle items with 0% coverage', () => {
      const items: CoverageItem[] = [
        { path: 'src/undocumented', coveragePercent: 0 },
        { path: 'src/partial', coveragePercent: 30 },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      assert.strictEqual(result.items[0]?.path, 'src/undocumented');
      assert.strictEqual(result.items[0]?.coveragePercent, 0);
    });

    it('should handle items with 100% coverage', () => {
      const items: CoverageItem[] = [
        { path: 'src/complete', coveragePercent: 100 },
        { path: 'src/partial', coveragePercent: 30 },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      // 30% should come first
      assert.strictEqual(result.items[0]?.path, 'src/partial');
      assert.strictEqual(result.items[1]?.path, 'src/complete');
    });
  });

  describe('preserves additional item properties', () => {
    it('should preserve all properties from input items', () => {
      interface ExtendedItem extends CoverageItem {
        fileCount: number;
        name: string;
      }

      const items: ExtendedItem[] = [
        { path: 'src/a', coveragePercent: 20, fileCount: 10, name: 'a' },
        { path: 'src/b', coveragePercent: 10, fileCount: 5, name: 'b' },
      ];

      const result = filterCoverageItems(items, { targetCount: 10 });

      const firstItem = result.items[0] as ExtendedItem;
      assert.strictEqual(firstItem.path, 'src/b');
      assert.strictEqual(firstItem.fileCount, 5);
      assert.strictEqual(firstItem.name, 'b');
    });
  });

  describe('real-world scenarios', () => {
    it('should prioritize undocumented areas in large repo', () => {
      // Simulate a large repo: 150 directories, most well-documented
      const items: CoverageItem[] = [];

      // 100 well-documented directories (60-100% coverage)
      for (let i = 0; i < 100; i++) {
        items.push({
          path: `src/documented-${i}`,
          coveragePercent: 60 + Math.floor(i * 0.4),
        });
      }

      // 50 undocumented directories (0-30% coverage)
      for (let i = 0; i < 50; i++) {
        items.push({
          path: `src/undocumented-${i}`,
          coveragePercent: Math.floor(i * 0.6),
        });
      }

      const result = filterCoverageItems(items, { targetCount: 60 });

      // Should have all 50 undocumented + 10 lowest of documented
      assert.strictEqual(result.items.length, 60);

      // All undocumented should be included
      const undocumentedCount = result.items.filter(i =>
        i.path.includes('undocumented')
      ).length;
      assert.strictEqual(undocumentedCount, 50);

      // Threshold should be around 60-64% (the 10 lowest documented ones)
      assert.ok(result.effectiveThreshold >= 60);
      assert.ok(result.effectiveThreshold <= 70);
    });

    it('should show all items when repo is small', () => {
      const items: CoverageItem[] = [
        { path: 'src/main', coveragePercent: 80 },
        { path: 'src/utils', coveragePercent: 40 },
        { path: 'src/config', coveragePercent: 90 },
      ];

      const result = filterCoverageItems(items, { targetCount: 100 });

      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.truncated, false);
      // All included, so threshold is 100
      assert.strictEqual(result.effectiveThreshold, 100);
    });

    it('should adapt when few items are below initial threshold', () => {
      // Repo where everything is fairly well-documented
      const items: CoverageItem[] = [
        { path: 'src/a', coveragePercent: 70 },
        { path: 'src/b', coveragePercent: 75 },
        { path: 'src/c', coveragePercent: 80 },
        { path: 'src/d', coveragePercent: 85 },
        { path: 'src/e', coveragePercent: 90 },
      ];

      const result = filterCoverageItems(items, { targetCount: 3 });

      // Even though all are >50%, we still get the 3 lowest
      assert.strictEqual(result.items.length, 3);
      assert.deepStrictEqual(result.items.map(i => i.coveragePercent), [70, 75, 80]);
      assert.strictEqual(result.effectiveThreshold, 80);
    });
  });
});

describe('formatCoverageTree with smart filtering', () => {
  // Helper to create a mock ContextGatherer for testing formatCoverageTree
  function createTestGatherer(): ContextGatherer {
    // Create a minimal mock - we only need formatCoverageTree
    return new ContextGatherer({} as never);
  }

  // Helper to build a test tree
  function buildTree(nodes: Array<{
    path: string;
    coveragePercent: number;
    totalFileCount: number;
  }>): DirectoryNode {
    // Build a tree from flat node definitions
    // Assumes first node is root
    const root: DirectoryNode = {
      name: nodes[0]!.path,
      path: nodes[0]!.path,
      fileCount: 0,
      totalFileCount: nodes[0]!.totalFileCount,
      coveragePercent: nodes[0]!.coveragePercent,
      children: [],
    };

    const nodeMap = new Map<string, DirectoryNode>();
    nodeMap.set(root.path, root);

    // Process remaining nodes
    for (let i = 1; i < nodes.length; i++) {
      const def = nodes[i]!;
      const parts = def.path.split('/');
      const name = parts[parts.length - 1]!;
      const parentPath = parts.slice(0, -1).join('/');

      const node: DirectoryNode = {
        name,
        path: def.path,
        fileCount: 0,
        totalFileCount: def.totalFileCount,
        coveragePercent: def.coveragePercent,
        children: [],
      };

      nodeMap.set(def.path, node);

      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      }
    }

    return root;
  }

  describe('prioritizes low-coverage directories', () => {
    it('should show low-coverage directories first in output', () => {
      const gatherer = createTestGatherer();
      const tree = buildTree([
        { path: 'src', coveragePercent: 50, totalFileCount: 100 },
        { path: 'src/documented', coveragePercent: 90, totalFileCount: 30 },
        { path: 'src/undocumented', coveragePercent: 10, totalFileCount: 40 },
        { path: 'src/partial', coveragePercent: 40, totalFileCount: 30 },
      ]);

      const result = gatherer.formatCoverageTree(tree, 100);
      const lines = result.split('\n');

      // Should include all directories (small tree)
      assert.ok(result.includes('undocumented'));
      assert.ok(result.includes('partial'));
      assert.ok(result.includes('documented'));

      // Low coverage items should have warning markers
      assert.ok(result.includes('undocumented/') && result.includes('⚠️'));
    });

    it('should truncate high-coverage dirs when limit is reached', () => {
      const gatherer = createTestGatherer();

      // Create tree with many directories
      const nodes = [
        { path: 'src', coveragePercent: 50, totalFileCount: 200 },
      ];

      // Add 10 directories with varying coverage
      for (let i = 0; i < 10; i++) {
        nodes.push({
          path: `src/dir${i}`,
          coveragePercent: i * 10, // 0%, 10%, 20%, ... 90%
          totalFileCount: 20,
        });
      }

      const tree = buildTree(nodes);

      // Only allow 6 lines (root + 5 children)
      const result = gatherer.formatCoverageTree(tree, 6);

      // Should show the lowest coverage directories
      assert.ok(result.includes('dir0')); // 0%
      assert.ok(result.includes('dir1')); // 10%
      assert.ok(result.includes('dir2')); // 20%

      // Should have truncation message
      assert.ok(result.includes('directories hidden'));
    });
  });

  describe('preserves tree structure', () => {
    it('should maintain parent-child relationships', () => {
      const gatherer = createTestGatherer();
      const tree = buildTree([
        { path: 'src', coveragePercent: 30, totalFileCount: 100 },
        { path: 'src/agents', coveragePercent: 20, totalFileCount: 50 },
        { path: 'src/agents/orchestrator', coveragePercent: 10, totalFileCount: 25 },
      ]);

      const result = gatherer.formatCoverageTree(tree, 100);

      // Check tree structure markers are present
      assert.ok(result.includes('src/'));
      assert.ok(result.includes('agents/'));
      assert.ok(result.includes('orchestrator/'));

      // Should have proper tree connectors
      const lines = result.split('\n');
      assert.ok(lines.length >= 3);
    });

    it('should sort children by coverage ascending', () => {
      const gatherer = createTestGatherer();
      const tree = buildTree([
        { path: 'src', coveragePercent: 50, totalFileCount: 100 },
        { path: 'src/high', coveragePercent: 80, totalFileCount: 30 },
        { path: 'src/low', coveragePercent: 10, totalFileCount: 30 },
        { path: 'src/medium', coveragePercent: 40, totalFileCount: 40 },
      ]);

      const result = gatherer.formatCoverageTree(tree, 100);
      const lines = result.split('\n');

      // Find the indices of each directory in the output
      const lowIndex = lines.findIndex(l => l.includes('low/'));
      const mediumIndex = lines.findIndex(l => l.includes('medium/'));
      const highIndex = lines.findIndex(l => l.includes('high/'));

      // Low coverage should appear before medium, medium before high
      assert.ok(lowIndex < mediumIndex, 'low should appear before medium');
      assert.ok(mediumIndex < highIndex, 'medium should appear before high');
    });
  });

  describe('handles edge cases', () => {
    it('should handle null tree', () => {
      const gatherer = createTestGatherer();
      const result = gatherer.formatCoverageTree(null);
      assert.strictEqual(result, '*No source directory found*');
    });

    it('should handle tree with no children', () => {
      const gatherer = createTestGatherer();
      const tree: DirectoryNode = {
        name: 'src',
        path: 'src',
        fileCount: 5,
        totalFileCount: 5,
        coveragePercent: 20,
        children: [],
      };

      const result = gatherer.formatCoverageTree(tree);
      assert.ok(result.includes('src/'));
      assert.ok(result.includes('20%'));
    });

    it('should handle deeply nested trees', () => {
      const gatherer = createTestGatherer();
      const tree = buildTree([
        { path: 'src', coveragePercent: 50, totalFileCount: 100 },
        { path: 'src/a', coveragePercent: 40, totalFileCount: 80 },
        { path: 'src/a/b', coveragePercent: 30, totalFileCount: 60 },
        { path: 'src/a/b/c', coveragePercent: 20, totalFileCount: 40 },
        { path: 'src/a/b/c/d', coveragePercent: 10, totalFileCount: 20 },
      ]);

      const result = gatherer.formatCoverageTree(tree, 100);

      // All levels should be present
      assert.ok(result.includes('src/'));
      assert.ok(result.includes('a/'));
      assert.ok(result.includes('b/'));
      assert.ok(result.includes('c/'));
      assert.ok(result.includes('d/'));
    });
  });

  describe('dynamic threshold behavior', () => {
    it('should show effective threshold in truncation message', () => {
      const gatherer = createTestGatherer();

      const nodes = [
        { path: 'src', coveragePercent: 50, totalFileCount: 200 },
      ];

      // Add directories with known coverage values
      for (let i = 0; i < 20; i++) {
        nodes.push({
          path: `src/dir${i.toString().padStart(2, '0')}`,
          coveragePercent: i * 5, // 0%, 5%, 10%, ... 95%
          totalFileCount: 10,
        });
      }

      const tree = buildTree(nodes);

      // Allow 11 lines (root + 10 children)
      const result = gatherer.formatCoverageTree(tree, 11);

      // Should include threshold info
      assert.ok(result.includes('coverage ≤'));
      assert.ok(result.includes('directories hidden'));
    });

    it('should not show truncation message when all dirs fit', () => {
      const gatherer = createTestGatherer();
      const tree = buildTree([
        { path: 'src', coveragePercent: 50, totalFileCount: 50 },
        { path: 'src/a', coveragePercent: 30, totalFileCount: 25 },
        { path: 'src/b', coveragePercent: 40, totalFileCount: 25 },
      ]);

      const result = gatherer.formatCoverageTree(tree, 100);

      // No truncation message
      assert.ok(!result.includes('hidden'));
      assert.ok(!result.includes('truncated'));
    });
  });
});
