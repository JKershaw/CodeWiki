/**
 * Unit tests for file-level coverage tree data structures.
 *
 * These tests define the shape of FileNode and DirectoryNode types
 * that will be used in the prioritized coverage tree.
 *
 * TDD Phase 1: Define data structures through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Types we expect to implement - importing from future location
// import { FileNode, DirectoryNode, buildFileTree } from '../../src/agents/orchestrator/file-coverage-tree.js';

/**
 * Temporary type definitions for TDD - these will move to implementation.
 */
interface FileNode {
  type: 'file';
  /** File name (e.g., "orchestrator.ts") */
  name: string;
  /** Full path from repo root (e.g., "src/agents/orchestrator/orchestrator.ts") */
  path: string;
  /** Lines of code */
  loc: number;
  /** Coverage percentage (0-100) based on wiki mentions */
  coveragePercent: number;
}

interface DirectoryNode {
  type: 'directory';
  /** Directory name (e.g., "orchestrator") */
  name: string;
  /** Full path from repo root (e.g., "src/agents/orchestrator") */
  path: string;
  /** Direct child files */
  files: FileNode[];
  /** Child directories */
  children: DirectoryNode[];
  /** Total LOC including all descendants */
  totalLoc: number;
  /** Total file count including all descendants */
  totalFileCount: number;
  /** Aggregated coverage percentage from all descendant files */
  coveragePercent: number;
}

/**
 * Helper to create a file node for testing.
 */
function createFileNode(
  path: string,
  loc: number,
  coveragePercent: number
): FileNode {
  const name = path.split('/').pop() ?? path;
  return {
    type: 'file',
    name,
    path,
    loc,
    coveragePercent,
  };
}

/**
 * Helper to create a directory node for testing.
 */
function createDirectoryNode(
  path: string,
  files: FileNode[] = [],
  children: DirectoryNode[] = []
): DirectoryNode {
  const name = path.split('/').pop() ?? path;

  // Calculate totals from files and children
  const directLoc = files.reduce((sum, f) => sum + f.loc, 0);
  const childLoc = children.reduce((sum, c) => sum + c.totalLoc, 0);
  const totalLoc = directLoc + childLoc;

  const directFileCount = files.length;
  const childFileCount = children.reduce((sum, c) => sum + c.totalFileCount, 0);
  const totalFileCount = directFileCount + childFileCount;

  // Coverage is weighted average by LOC
  const directCoverageSum = files.reduce((sum, f) => sum + f.coveragePercent * f.loc, 0);
  const childCoverageSum = children.reduce((sum, c) => sum + c.coveragePercent * c.totalLoc, 0);
  const coveragePercent = totalLoc > 0
    ? (directCoverageSum + childCoverageSum) / totalLoc
    : 0;

  return {
    type: 'directory',
    name,
    path,
    files,
    children,
    totalLoc,
    totalFileCount,
    coveragePercent,
  };
}

describe('FileNode', () => {
  it('represents a file with path, name, loc, and coverage', () => {
    const file = createFileNode('src/agents/orchestrator.ts', 850, 0);

    assert.strictEqual(file.type, 'file');
    assert.strictEqual(file.name, 'orchestrator.ts');
    assert.strictEqual(file.path, 'src/agents/orchestrator.ts');
    assert.strictEqual(file.loc, 850);
    assert.strictEqual(file.coveragePercent, 0);
  });

  it('extracts name from path correctly', () => {
    const file = createFileNode('src/deep/nested/path/file.ts', 100, 50);
    assert.strictEqual(file.name, 'file.ts');
  });

  it('handles root-level files', () => {
    const file = createFileNode('index.ts', 50, 100);
    assert.strictEqual(file.name, 'index.ts');
    assert.strictEqual(file.path, 'index.ts');
  });

  it('allows zero LOC for empty files', () => {
    const file = createFileNode('src/empty.ts', 0, 0);
    assert.strictEqual(file.loc, 0);
  });

  it('allows 100% coverage for fully documented files', () => {
    const file = createFileNode('src/documented.ts', 100, 100);
    assert.strictEqual(file.coveragePercent, 100);
  });
});

describe('DirectoryNode', () => {
  describe('structure', () => {
    it('represents a directory with files and children', () => {
      const files = [
        createFileNode('src/agents/base.ts', 200, 50),
        createFileNode('src/agents/types.ts', 100, 100),
      ];
      const dir = createDirectoryNode('src/agents', files, []);

      assert.strictEqual(dir.type, 'directory');
      assert.strictEqual(dir.name, 'agents');
      assert.strictEqual(dir.path, 'src/agents');
      assert.strictEqual(dir.files.length, 2);
      assert.strictEqual(dir.children.length, 0);
    });

    it('can contain nested directories', () => {
      const innerFiles = [createFileNode('src/agents/orchestrator/main.ts', 500, 0)];
      const innerDir = createDirectoryNode('src/agents/orchestrator', innerFiles);

      const outerFiles = [createFileNode('src/agents/index.ts', 50, 100)];
      const outerDir = createDirectoryNode('src/agents', outerFiles, [innerDir]);

      assert.strictEqual(outerDir.children.length, 1);
      assert.strictEqual(outerDir.children[0]!.name, 'orchestrator');
    });
  });

  describe('totalLoc calculation', () => {
    it('sums LOC from direct files', () => {
      const files = [
        createFileNode('src/a.ts', 100, 0),
        createFileNode('src/b.ts', 200, 0),
        createFileNode('src/c.ts', 300, 0),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.totalLoc, 600);
    });

    it('includes LOC from nested directories', () => {
      const innerFiles = [createFileNode('src/inner/deep.ts', 500, 0)];
      const innerDir = createDirectoryNode('src/inner', innerFiles);

      const outerFiles = [createFileNode('src/shallow.ts', 100, 0)];
      const outerDir = createDirectoryNode('src', outerFiles, [innerDir]);

      assert.strictEqual(outerDir.totalLoc, 600); // 100 + 500
    });

    it('handles deeply nested structures', () => {
      const level3 = createDirectoryNode('a/b/c', [
        createFileNode('a/b/c/file.ts', 100, 0),
      ]);
      const level2 = createDirectoryNode('a/b', [
        createFileNode('a/b/file.ts', 200, 0),
      ], [level3]);
      const level1 = createDirectoryNode('a', [
        createFileNode('a/file.ts', 300, 0),
      ], [level2]);

      assert.strictEqual(level1.totalLoc, 600); // 300 + 200 + 100
    });
  });

  describe('totalFileCount calculation', () => {
    it('counts direct files', () => {
      const files = [
        createFileNode('src/a.ts', 100, 0),
        createFileNode('src/b.ts', 100, 0),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.totalFileCount, 2);
    });

    it('includes files from nested directories', () => {
      const innerDir = createDirectoryNode('src/inner', [
        createFileNode('src/inner/a.ts', 100, 0),
        createFileNode('src/inner/b.ts', 100, 0),
      ]);
      const outerDir = createDirectoryNode('src', [
        createFileNode('src/c.ts', 100, 0),
      ], [innerDir]);

      assert.strictEqual(outerDir.totalFileCount, 3);
    });
  });

  describe('coveragePercent calculation', () => {
    it('calculates weighted average by LOC for direct files', () => {
      // 800 LOC at 0% + 200 LOC at 100% = 200/1000 = 20%
      const files = [
        createFileNode('src/big-uncovered.ts', 800, 0),
        createFileNode('src/small-covered.ts', 200, 100),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.coveragePercent, 20);
    });

    it('weighs larger files more heavily', () => {
      // Equal coverage but different sizes - should still be 50%
      const files = [
        createFileNode('src/big.ts', 1000, 50),
        createFileNode('src/small.ts', 100, 50),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.coveragePercent, 50);
    });

    it('calculates coverage across nested directories', () => {
      // Inner: 100 LOC at 0%
      const innerDir = createDirectoryNode('src/inner', [
        createFileNode('src/inner/uncovered.ts', 100, 0),
      ]);
      // Outer: 100 LOC at 100%
      // Total: 200 LOC, 100 covered = 50%
      const outerDir = createDirectoryNode('src', [
        createFileNode('src/covered.ts', 100, 100),
      ], [innerDir]);

      assert.strictEqual(outerDir.coveragePercent, 50);
    });

    it('returns 0 for empty directories', () => {
      const dir = createDirectoryNode('src', [], []);
      assert.strictEqual(dir.coveragePercent, 0);
    });

    it('handles 100% coverage correctly', () => {
      const files = [
        createFileNode('src/a.ts', 100, 100),
        createFileNode('src/b.ts', 200, 100),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.coveragePercent, 100);
    });

    it('handles mixed coverage with varying file sizes', () => {
      // 500 LOC at 80% = 400 weighted
      // 300 LOC at 20% = 60 weighted
      // 200 LOC at 50% = 100 weighted
      // Total: 1000 LOC, 560 weighted = 56%
      const files = [
        createFileNode('src/mostly-covered.ts', 500, 80),
        createFileNode('src/mostly-uncovered.ts', 300, 20),
        createFileNode('src/half.ts', 200, 50),
      ];
      const dir = createDirectoryNode('src', files);

      assert.strictEqual(dir.coveragePercent, 56);
    });
  });
});

describe('Tree structure scenarios', () => {
  it('represents a flat codebase (all files in src/)', () => {
    const files = [
      createFileNode('src/index.ts', 50, 100),
      createFileNode('src/app.ts', 200, 0),
      createFileNode('src/utils.ts', 150, 50),
    ];
    const root = createDirectoryNode('src', files);

    assert.strictEqual(root.totalFileCount, 3);
    assert.strictEqual(root.totalLoc, 400);
    assert.strictEqual(root.children.length, 0);
  });

  it('represents a deep codebase (many levels of nesting)', () => {
    const deepFile = createFileNode('src/a/b/c/d/e/deep.ts', 500, 0);
    const level5 = createDirectoryNode('src/a/b/c/d/e', [deepFile]);
    const level4 = createDirectoryNode('src/a/b/c/d', [], [level5]);
    const level3 = createDirectoryNode('src/a/b/c', [], [level4]);
    const level2 = createDirectoryNode('src/a/b', [], [level3]);
    const level1 = createDirectoryNode('src/a', [], [level2]);
    const root = createDirectoryNode('src', [], [level1]);

    assert.strictEqual(root.totalFileCount, 1);
    assert.strictEqual(root.totalLoc, 500);
    // Coverage should propagate up
    assert.strictEqual(root.coveragePercent, 0);
  });

  it('represents a typical project structure', () => {
    // src/
    //   agents/
    //     orchestrator.ts (800 LOC, 0%)
    //     base-agent.ts (200 LOC, 100%)
    //   services/
    //     llm-service.ts (500 LOC, 50%)
    //   index.ts (50 LOC, 100%)

    const agentsDir = createDirectoryNode('src/agents', [
      createFileNode('src/agents/orchestrator.ts', 800, 0),
      createFileNode('src/agents/base-agent.ts', 200, 100),
    ]);

    const servicesDir = createDirectoryNode('src/services', [
      createFileNode('src/services/llm-service.ts', 500, 50),
    ]);

    const root = createDirectoryNode('src', [
      createFileNode('src/index.ts', 50, 100),
    ], [agentsDir, servicesDir]);

    assert.strictEqual(root.totalFileCount, 4);
    assert.strictEqual(root.totalLoc, 1550);

    // Coverage calculation:
    // agents: 800*0 + 200*100 = 20000 / 1000 = 20%
    // services: 500*50 = 25000 / 500 = 50%
    // root direct: 50*100 = 5000 / 50 = 100%
    // total: (0 + 20000 + 25000 + 5000) / 1550 = 50000 / 1550 ≈ 32.26%
    assert.ok(root.coveragePercent > 32 && root.coveragePercent < 33);
  });
});

describe('Edge cases', () => {
  it('handles directory with only subdirectories (no direct files)', () => {
    const child = createDirectoryNode('src/child', [
      createFileNode('src/child/file.ts', 100, 50),
    ]);
    const parent = createDirectoryNode('src', [], [child]);

    assert.strictEqual(parent.files.length, 0);
    assert.strictEqual(parent.totalFileCount, 1);
    assert.strictEqual(parent.totalLoc, 100);
    assert.strictEqual(parent.coveragePercent, 50);
  });

  it('handles single file at root', () => {
    const file = createFileNode('index.ts', 100, 75);
    // Note: in practice we'd probably still have a root directory
    assert.strictEqual(file.loc, 100);
    assert.strictEqual(file.coveragePercent, 75);
  });

  it('handles very large LOC values', () => {
    const file = createFileNode('src/massive.ts', 50000, 10);
    const dir = createDirectoryNode('src', [file]);

    assert.strictEqual(dir.totalLoc, 50000);
    assert.strictEqual(dir.coveragePercent, 10);
  });

  it('handles fractional coverage from weighted average', () => {
    // 33 LOC at 100% + 67 LOC at 0% = 33%
    const files = [
      createFileNode('src/a.ts', 33, 100),
      createFileNode('src/b.ts', 67, 0),
    ];
    const dir = createDirectoryNode('src', files);

    assert.strictEqual(dir.coveragePercent, 33);
  });
});
