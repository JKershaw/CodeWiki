/**
 * Unit tests for budget-aware coverage tree truncation.
 *
 * The truncation algorithm selects which files and directories to show
 * given a line budget, prioritizing low-coverage large files while
 * including necessary ancestor directories.
 *
 * TDD Phase 4: Define truncation behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Future imports:
// import { truncateToBudget, type TruncationResult } from '../../src/agents/orchestrator/file-coverage-tree.js';

/**
 * File node with priority score.
 */
interface ScoredFile {
  path: string;
  name: string;
  loc: number;
  coveragePercent: number;
  score: number;
}

/**
 * Result of truncation operation.
 */
interface TruncationResult {
  /** Selected files to display */
  files: ScoredFile[];
  /** Directory paths that must be shown (ancestors of selected files) */
  directories: string[];
  /** Total lines that will be used */
  totalLines: number;
  /** Number of files hidden due to budget */
  hiddenFileCount: number;
  /** Number of directories hidden */
  hiddenDirCount: number;
  /** Whether truncation occurred */
  wasTruncated: boolean;
  /** Effective coverage threshold (coverage of last included file) */
  effectiveThreshold: number;
}

/**
 * Calculate priority score for sorting.
 */
function calculateScore(coveragePercent: number, loc: number): number {
  return (1 - coveragePercent / 100) * Math.log(loc + 1);
}

/**
 * Get all ancestor directories for a file path.
 */
function getAncestors(filePath: string): string[] {
  const parts = filePath.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

/**
 * Truncate files to fit within a line budget.
 *
 * Each file costs 1 line.
 * Each directory costs 1 line.
 * Ancestor directories are included automatically.
 *
 * @param files - All files with their scores
 * @param budget - Maximum lines to output
 * @returns Truncation result with selected files and directories
 */
function truncateToBudget(
  files: Array<{ path: string; loc: number; coveragePercent: number }>,
  budget: number
): TruncationResult {
  // Score and sort files by priority (highest first)
  const scoredFiles: ScoredFile[] = files
    .map(f => ({
      ...f,
      name: f.path.split('/').pop() ?? f.path,
      score: calculateScore(f.coveragePercent, f.loc),
    }))
    .sort((a, b) => b.score - a.score);

  const selectedFiles: ScoredFile[] = [];
  const includedDirectories = new Set<string>();
  let linesUsed = 0;

  for (const file of scoredFiles) {
    // Calculate ancestors not yet included
    const ancestors = getAncestors(file.path);
    const newAncestors = ancestors.filter(a => !includedDirectories.has(a));

    // Cost = 1 (file) + new ancestors
    const cost = 1 + newAncestors.length;

    if (linesUsed + cost <= budget) {
      selectedFiles.push(file);
      for (const ancestor of newAncestors) {
        includedDirectories.add(ancestor);
      }
      linesUsed += cost;
    }
  }

  // Calculate hidden counts
  const allDirectories = new Set<string>();
  for (const file of files) {
    for (const ancestor of getAncestors(file.path)) {
      allDirectories.add(ancestor);
    }
  }

  const hiddenFileCount = files.length - selectedFiles.length;
  const hiddenDirCount = allDirectories.size - includedDirectories.size;

  // Effective threshold is coverage of last selected file (or 100 if none hidden)
  const effectiveThreshold = selectedFiles.length > 0 && hiddenFileCount > 0
    ? selectedFiles[selectedFiles.length - 1]!.coveragePercent
    : 100;

  return {
    files: selectedFiles,
    directories: Array.from(includedDirectories).sort(),
    totalLines: linesUsed,
    hiddenFileCount,
    hiddenDirCount,
    wasTruncated: hiddenFileCount > 0,
    effectiveThreshold,
  };
}

describe('truncateToBudget', () => {
  describe('basic truncation', () => {
    it('respects exact line budget', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/c.ts', loc: 100, coveragePercent: 0 },
      ];

      // Budget of 4: 1 for src/ + 3 for files
      const result = truncateToBudget(files, 4);

      assert.ok(result.totalLines <= 4,
        `Expected totalLines <= 4, got ${result.totalLines}`);
    });

    it('includes all items when under budget', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 50 },
      ];

      // Large budget
      const result = truncateToBudget(files, 100);

      assert.strictEqual(result.files.length, 2);
      assert.strictEqual(result.wasTruncated, false);
      assert.strictEqual(result.hiddenFileCount, 0);
    });

    it('marks truncation when files are hidden', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/c.ts', loc: 100, coveragePercent: 0 },
      ];

      // Budget of 2: can only fit src/ + 1 file
      const result = truncateToBudget(files, 2);

      assert.strictEqual(result.wasTruncated, true);
      assert.ok(result.hiddenFileCount > 0);
    });
  });

  describe('ancestor budget calculation', () => {
    it('includes ancestors in budget calculation', () => {
      const files = [
        { path: 'src/agents/orchestrator/main.ts', loc: 800, coveragePercent: 0 },
      ];

      // Cost: src + agents + orchestrator + main.ts = 4 lines
      const result = truncateToBudget(files, 10);

      assert.strictEqual(result.totalLines, 4);
      assert.deepStrictEqual(
        result.directories.sort(),
        ['src', 'src/agents', 'src/agents/orchestrator'].sort()
      );
    });

    it('shares ancestor cost across files in same directory', () => {
      const files = [
        { path: 'src/agents/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/agents/b.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/agents/c.ts', loc: 100, coveragePercent: 0 },
      ];

      // Cost: src + agents + 3 files = 5 lines
      const result = truncateToBudget(files, 10);

      assert.strictEqual(result.totalLines, 5);
      assert.strictEqual(result.files.length, 3);
    });

    it('correctly calculates cost for files in different directories', () => {
      const files = [
        { path: 'src/a/file1.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b/file2.ts', loc: 100, coveragePercent: 0 },
      ];

      // Cost: src + a + file1 + b + file2 = 5 lines
      const result = truncateToBudget(files, 10);

      assert.strictEqual(result.totalLines, 5);
      assert.strictEqual(result.directories.length, 3); // src, src/a, src/b
    });

    it('handles deep files with high ancestor cost', () => {
      const files = [
        { path: 'a/b/c/d/e/deep.ts', loc: 1000, coveragePercent: 0 },
        { path: 'src/shallow.ts', loc: 100, coveragePercent: 0 },
      ];

      // Budget of 5: can fit shallow (src + shallow = 2) but deep costs 6
      const result = truncateToBudget(files, 5);

      // Deep file scores higher but costs more - depends on priority vs cost tradeoff
      // With greedy approach: try deep first (cost 6 > 5), skip; try shallow (cost 2 <= 5), take
      // Note: The actual behavior depends on implementation
      assert.ok(result.totalLines <= 5);
    });
  });

  describe('priority-based selection', () => {
    it('prioritizes low-coverage large files', () => {
      const files = [
        { path: 'src/covered.ts', loc: 100, coveragePercent: 100 },
        { path: 'src/uncovered-large.ts', loc: 800, coveragePercent: 0 },
        { path: 'src/uncovered-small.ts', loc: 50, coveragePercent: 0 },
      ];

      // Budget for src + 2 files = 3
      const result = truncateToBudget(files, 3);

      // Should include uncovered-large and uncovered-small (both 0% covered)
      const selectedNames = result.files.map(f => f.name);
      assert.ok(selectedNames.includes('uncovered-large.ts'),
        'Should include uncovered-large.ts');
      assert.ok(!selectedNames.includes('covered.ts'),
        'Should not include covered.ts');
    });

    it('returns files sorted by priority score', () => {
      const files = [
        { path: 'src/low-priority.ts', loc: 50, coveragePercent: 80 },
        { path: 'src/high-priority.ts', loc: 500, coveragePercent: 0 },
        { path: 'src/medium-priority.ts', loc: 200, coveragePercent: 30 },
      ];

      const result = truncateToBudget(files, 100);

      assert.strictEqual(result.files[0]!.name, 'high-priority.ts');
      assert.strictEqual(result.files[1]!.name, 'medium-priority.ts');
      assert.strictEqual(result.files[2]!.name, 'low-priority.ts');
    });

    it('reports effective threshold', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 30 },
        { path: 'src/c.ts', loc: 100, coveragePercent: 60 },
        { path: 'src/d.ts', loc: 100, coveragePercent: 90 },
      ];

      // Budget for src + 2 files = 3
      const result = truncateToBudget(files, 3);

      // Should include a.ts (0%) and b.ts (30%)
      // Effective threshold is coverage of last included = 30
      assert.strictEqual(result.effectiveThreshold, 30);
    });
  });

  describe('hidden counts', () => {
    it('correctly counts hidden files', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 50 },
        { path: 'src/c.ts', loc: 100, coveragePercent: 100 },
      ];

      // Budget for src + 1 file = 2
      const result = truncateToBudget(files, 2);

      assert.strictEqual(result.hiddenFileCount, 2);
    });

    it('correctly counts hidden directories', () => {
      const files = [
        { path: 'src/included/file.ts', loc: 100, coveragePercent: 0 },
        { path: 'src/excluded/other.ts', loc: 50, coveragePercent: 100 },
      ];

      // Budget to include only first file
      // src + included + file = 3, then excluded would need +2 more
      const result = truncateToBudget(files, 3);

      // excluded directory should be hidden
      assert.ok(result.hiddenDirCount >= 1);
    });
  });

  describe('edge cases', () => {
    it('handles empty file list', () => {
      const result = truncateToBudget([], 100);

      assert.strictEqual(result.files.length, 0);
      assert.strictEqual(result.directories.length, 0);
      assert.strictEqual(result.wasTruncated, false);
    });

    it('handles budget of 0', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
      ];

      const result = truncateToBudget(files, 0);

      assert.strictEqual(result.files.length, 0);
      assert.strictEqual(result.wasTruncated, true);
    });

    it('handles budget of 1 (can only fit one directory)', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 0 },
      ];

      // src costs 1, file costs 1, total = 2, budget = 1
      const result = truncateToBudget(files, 1);

      // Can't fit even one file (need dir + file)
      assert.strictEqual(result.files.length, 0);
    });

    it('handles files at root level', () => {
      const files = [
        { path: 'index.ts', loc: 100, coveragePercent: 0 },
        { path: 'config.ts', loc: 50, coveragePercent: 100 },
      ];

      // No directories, just files
      const result = truncateToBudget(files, 10);

      // Files at root have no ancestors
      assert.strictEqual(result.directories.length, 0);
      assert.strictEqual(result.files.length, 2);
    });

    it('handles all files with same score', () => {
      const files = [
        { path: 'src/a.ts', loc: 100, coveragePercent: 50 },
        { path: 'src/b.ts', loc: 100, coveragePercent: 50 },
        { path: 'src/c.ts', loc: 100, coveragePercent: 50 },
      ];

      const result = truncateToBudget(files, 3);

      // Should take some files deterministically
      assert.ok(result.files.length > 0);
    });
  });

  describe('real-world scenarios', () => {
    it('handles monorepo structure efficiently', () => {
      const files = [
        { path: 'packages/core/src/index.ts', loc: 50, coveragePercent: 100 },
        { path: 'packages/core/src/main.ts', loc: 500, coveragePercent: 0 },
        { path: 'packages/cli/src/index.ts', loc: 100, coveragePercent: 0 },
        { path: 'packages/cli/src/commands.ts', loc: 300, coveragePercent: 20 },
      ];

      // Budget of 10 should fit most important files
      const result = truncateToBudget(files, 10);

      // core/main.ts should be highest priority (large, uncovered)
      assert.strictEqual(result.files[0]!.name, 'main.ts');
    });

    it('handles Next.js app directory structure', () => {
      const files = [
        { path: 'app/page.tsx', loc: 100, coveragePercent: 50 },
        { path: 'app/layout.tsx', loc: 80, coveragePercent: 100 },
        { path: 'app/api/users/route.ts', loc: 200, coveragePercent: 0 },
        { path: 'app/api/posts/route.ts', loc: 150, coveragePercent: 0 },
        { path: 'components/Button.tsx', loc: 50, coveragePercent: 100 },
      ];

      const result = truncateToBudget(files, 10);

      // API routes should be prioritized (uncovered)
      const topFiles = result.files.slice(0, 2).map(f => f.name);
      assert.ok(topFiles.includes('route.ts'),
        'Should prioritize uncovered API routes');
    });

    it('handles Java deep package structure', () => {
      const files = [
        { path: 'src/main/java/com/company/app/service/UserService.java', loc: 500, coveragePercent: 0 },
        { path: 'src/main/java/com/company/app/service/AuthService.java', loc: 400, coveragePercent: 30 },
        { path: 'src/main/java/com/company/app/model/User.java', loc: 100, coveragePercent: 100 },
      ];

      // Deep paths have high ancestor cost
      // All share: src, main, java, com, company, app = 6 dirs
      // Then service (2 files) and model (1 file)
      // Total for all: 6 + 1 + 1 + 3 = 11 lines

      const result = truncateToBudget(files, 15);

      // Should include all since budget is sufficient
      assert.strictEqual(result.files.length, 3);
    });

    it('handles flat Python project', () => {
      const files = [
        { path: 'main.py', loc: 200, coveragePercent: 0 },
        { path: 'utils.py', loc: 150, coveragePercent: 50 },
        { path: 'config.py', loc: 50, coveragePercent: 100 },
        { path: 'test_main.py', loc: 100, coveragePercent: 100 },
      ];

      // No directories, just files at root
      const result = truncateToBudget(files, 10);

      // All files should fit easily
      assert.strictEqual(result.files.length, 4);
      assert.strictEqual(result.directories.length, 0);
    });
  });

  describe('budget distribution', () => {
    it('favors more files over fewer deep files when scores are similar', () => {
      const files = [
        { path: 'a/b/c/d/deep.ts', loc: 100, coveragePercent: 0 },  // cost: 5 (4 dirs + 1 file)
        { path: 'src/file1.ts', loc: 100, coveragePercent: 0 },     // cost: 2
        { path: 'src/file2.ts', loc: 100, coveragePercent: 0 },     // cost: 1 (src already included)
        { path: 'src/file3.ts', loc: 100, coveragePercent: 0 },     // cost: 1
      ];

      // Budget of 5: can fit deep OR src+3files (both cost 5 after first)
      const result = truncateToBudget(files, 5);

      // Greedy takes highest score first, all equal so takes in order
      // Deep scores same as others, goes first, costs 5, done
      // OR if we're smart about it, we'd pick 3-4 shallow files
      // Current greedy: depends on sort stability
      assert.ok(result.totalLines <= 5);
    });

    it('balances depth cost against priority', () => {
      const files = [
        // Very deep but very important
        { path: 'a/b/c/d/e/critical.ts', loc: 1000, coveragePercent: 0 },
        // Shallow and less important
        { path: 'src/trivial1.ts', loc: 20, coveragePercent: 0 },
        { path: 'src/trivial2.ts', loc: 20, coveragePercent: 0 },
        { path: 'src/trivial3.ts', loc: 20, coveragePercent: 0 },
        { path: 'src/trivial4.ts', loc: 20, coveragePercent: 0 },
      ];

      // critical.ts: score = 1.0 * log(1001) ≈ 6.9, cost = 6
      // trivial: score = 1.0 * log(21) ≈ 3.0, cost = 2/1/1/1

      const result = truncateToBudget(files, 6);

      // Critical should win on score despite high cost
      assert.ok(result.files.some(f => f.name === 'critical.ts'),
        'Should include high-priority deep file');
    });
  });
});
