/**
 * Unit tests for file coverage calculation using tracked file fields.
 *
 * Tests the coverage calculation in getWorkSummary() which uses:
 * - filesAccessed: Files read by agents
 * - filesReferenced: Files mentioned in content
 * - targetPaths: Work item targets (files or directories)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Simulates the coverage calculation from orchestrator.ts
 * This is extracted for unit testing without full orchestrator setup.
 *
 * Key design decisions:
 * - filesAccessed: Only exact file matches (files actually read by agents)
 * - filesReferenced: Only exact file matches (directory mentions in prose don't count)
 * - targetPaths: Allows directory-level coverage (explicit work assignments)
 */
function calculateCoveredFiles(
  sourceFiles: string[],
  wikiPages: Array<{
    filesAccessed?: string[];
    filesReferenced?: string[];
    targetPaths?: string[];
  }>
): Set<string> {
  const sourceFileSet = new Set(sourceFiles);
  const coveredFiles = new Set<string>();

  // Helper to add exact file match only
  const addExactFile = (path: string) => {
    if (sourceFileSet.has(path)) {
      coveredFiles.add(path);
    }
  };

  // Helper to add coverage for a path - allows directory matching
  const addPathCoverage = (path: string) => {
    if (sourceFileSet.has(path)) {
      // Exact file match
      coveredFiles.add(path);
    } else if (path.endsWith('/')) {
      // Directory path with trailing slash - match all files within
      for (const sourceFile of sourceFiles) {
        if (sourceFile.startsWith(path)) {
          coveredFiles.add(sourceFile);
        }
      }
    } else {
      // Could be a directory without trailing slash - check if it's a prefix
      const pathWithSlash = path + '/';
      for (const sourceFile of sourceFiles) {
        if (sourceFile.startsWith(pathWithSlash)) {
          coveredFiles.add(sourceFile);
        }
      }
    }
  };

  for (const page of wikiPages) {
    // filesAccessed: Only exact file matches (agents read specific files)
    for (const file of page.filesAccessed ?? []) {
      addExactFile(file);
    }
    // filesReferenced: Only exact file matches (directory mentions don't count)
    for (const file of page.filesReferenced ?? []) {
      addExactFile(file);
    }
    // targetPaths: Allows directory coverage (explicit work assignments)
    for (const path of page.targetPaths ?? []) {
      addPathCoverage(path);
    }
  }

  return coveredFiles;
}

describe('Tracked File Coverage Calculation', () => {
  describe('exact file matching', () => {
    it('matches files from filesAccessed', () => {
      const sourceFiles = ['src/index.ts', 'src/utils.ts', 'src/config.ts'];
      const wikiPages = [
        { filesAccessed: ['src/index.ts', 'src/utils.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 2);
      assert.ok(covered.has('src/index.ts'));
      assert.ok(covered.has('src/utils.ts'));
      assert.ok(!covered.has('src/config.ts'));
    });

    it('matches files from filesReferenced', () => {
      const sourceFiles = ['src/api.ts', 'src/db.ts'];
      const wikiPages = [
        { filesReferenced: ['src/api.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/api.ts'));
    });

    it('matches files from targetPaths', () => {
      const sourceFiles = ['src/service.ts', 'src/handler.ts'];
      const wikiPages = [
        { targetPaths: ['src/service.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/service.ts'));
    });

    it('combines all three tracking fields', () => {
      const sourceFiles = [
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
        'src/d.ts',
      ];
      const wikiPages = [
        {
          filesAccessed: ['src/a.ts'],
          filesReferenced: ['src/b.ts'],
          targetPaths: ['src/c.ts'],
        },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 3);
      assert.ok(covered.has('src/a.ts'));
      assert.ok(covered.has('src/b.ts'));
      assert.ok(covered.has('src/c.ts'));
      assert.ok(!covered.has('src/d.ts'));
    });

    it('deduplicates files covered by multiple fields', () => {
      const sourceFiles = ['src/shared.ts'];
      const wikiPages = [
        {
          filesAccessed: ['src/shared.ts'],
          filesReferenced: ['src/shared.ts'],
          targetPaths: ['src/shared.ts'],
        },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/shared.ts'));
    });
  });

  describe('filesReferenced does NOT allow directory coverage', () => {
    it('directory path in filesReferenced does NOT match all files', () => {
      const sourceFiles = [
        'src/services/auth.ts',
        'src/services/api.ts',
        'src/services/db.ts',
        'src/utils/helper.ts',
      ];
      // A page that mentions "src/" in a tree view should NOT cover all files
      const wikiPages = [
        { filesReferenced: ['src/'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      // Directory path in filesReferenced should be ignored (no directory coverage)
      assert.strictEqual(covered.size, 0);
    });

    it('prevents over-reporting from tree views in content', () => {
      // Simulates the overview page showing a directory structure like:
      // src/
      // ├── agents/
      // ├── services/
      const sourceFiles = [
        'src/agents/code-change.ts',
        'src/agents/security.ts',
        'src/services/auth.ts',
        'src/services/api.ts',
        'src/index.ts',
      ];
      const wikiPages = [
        {
          // These would be extracted from a tree view in the content
          filesReferenced: ['src/', 'src/index.ts'],
        },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      // Only the specific file should match, not all files under src/
      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/index.ts'));
      assert.ok(!covered.has('src/agents/code-change.ts'));
      assert.ok(!covered.has('src/services/auth.ts'));
    });

    it('filesAccessed also does not allow directory coverage', () => {
      const sourceFiles = [
        'src/a.ts',
        'src/b.ts',
      ];
      // Even if agent somehow recorded a directory as "accessed", it shouldn't match
      const wikiPages = [
        { filesAccessed: ['src/'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 0);
    });
  });

  describe('directory path matching with trailing slash (targetPaths only)', () => {
    it('matches all files in directory with trailing slash', () => {
      const sourceFiles = [
        'src/services/auth.ts',
        'src/services/api.ts',
        'src/services/db.ts',
        'src/utils/helper.ts',
      ];
      const wikiPages = [
        { targetPaths: ['src/services/'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 3);
      assert.ok(covered.has('src/services/auth.ts'));
      assert.ok(covered.has('src/services/api.ts'));
      assert.ok(covered.has('src/services/db.ts'));
      assert.ok(!covered.has('src/utils/helper.ts'));
    });

    it('matches nested files in directory with trailing slash', () => {
      const sourceFiles = [
        'src/components/ui/Button.tsx',
        'src/components/ui/Input.tsx',
        'src/components/layout/Header.tsx',
        'src/pages/Home.tsx',
      ];
      const wikiPages = [
        { targetPaths: ['src/components/'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 3);
      assert.ok(covered.has('src/components/ui/Button.tsx'));
      assert.ok(covered.has('src/components/ui/Input.tsx'));
      assert.ok(covered.has('src/components/layout/Header.tsx'));
      assert.ok(!covered.has('src/pages/Home.tsx'));
    });
  });

  describe('directory path matching without trailing slash', () => {
    it('matches all files in directory without trailing slash', () => {
      const sourceFiles = [
        'src/agents/code-change.ts',
        'src/agents/security.ts',
        'src/domain/wiki-page.ts',
      ];
      const wikiPages = [
        { targetPaths: ['src/agents'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 2);
      assert.ok(covered.has('src/agents/code-change.ts'));
      assert.ok(covered.has('src/agents/security.ts'));
      assert.ok(!covered.has('src/domain/wiki-page.ts'));
    });

    it('does not match files with similar prefix that are not in directory', () => {
      const sourceFiles = [
        'src/agent.ts',        // Should NOT match 'src/agents' (not a directory match)
        'src/agents/main.ts',  // Should match
        'src/agents-old.ts',   // Should NOT match (agents-old != agents/)
      ];
      const wikiPages = [
        { targetPaths: ['src/agents'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/agents/main.ts'));
      assert.ok(!covered.has('src/agent.ts'));
      assert.ok(!covered.has('src/agents-old.ts'));
    });
  });

  describe('multiple wiki pages', () => {
    it('aggregates coverage from multiple pages', () => {
      const sourceFiles = [
        'src/auth.ts',
        'src/api.ts',
        'src/db.ts',
      ];
      const wikiPages = [
        { filesAccessed: ['src/auth.ts'] },
        { filesReferenced: ['src/api.ts'] },
        { targetPaths: ['src/db.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 3);
      assert.ok(covered.has('src/auth.ts'));
      assert.ok(covered.has('src/api.ts'));
      assert.ok(covered.has('src/db.ts'));
    });

    it('handles overlapping coverage from multiple pages', () => {
      const sourceFiles = ['src/shared.ts', 'src/other.ts'];
      const wikiPages = [
        { filesAccessed: ['src/shared.ts'] },
        { filesReferenced: ['src/shared.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/shared.ts'));
    });
  });

  describe('edge cases', () => {
    it('handles empty wiki pages array', () => {
      const sourceFiles = ['src/index.ts'];
      const wikiPages: Array<{ filesAccessed?: string[] }> = [];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 0);
    });

    it('handles pages with no tracking fields', () => {
      const sourceFiles = ['src/index.ts'];
      const wikiPages = [{}];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 0);
    });

    it('handles pages with empty tracking arrays', () => {
      const sourceFiles = ['src/index.ts'];
      const wikiPages = [
        { filesAccessed: [], filesReferenced: [], targetPaths: [] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 0);
    });

    it('ignores paths that do not match any source files', () => {
      const sourceFiles = ['src/existing.ts'];
      const wikiPages = [
        { filesAccessed: ['src/nonexistent.ts', 'src/existing.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/existing.ts'));
    });

    it('handles empty source files array', () => {
      const sourceFiles: string[] = [];
      const wikiPages = [
        { filesAccessed: ['src/file.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      assert.strictEqual(covered.size, 0);
    });
  });

  describe('coverage percentage calculation', () => {
    it('calculates correct coverage percentage', () => {
      const sourceFiles = [
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
        'src/d.ts',
      ];
      const wikiPages = [
        { filesAccessed: ['src/a.ts', 'src/b.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);
      const coveragePercent = (covered.size / sourceFiles.length) * 100;

      assert.strictEqual(covered.size, 2);
      assert.strictEqual(coveragePercent, 50);
    });

    it('calculates 100% coverage when all files are covered', () => {
      const sourceFiles = ['src/only.ts'];
      const wikiPages = [
        { filesAccessed: ['src/only.ts'] },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);
      const coveragePercent = (covered.size / sourceFiles.length) * 100;

      assert.strictEqual(coveragePercent, 100);
    });

    it('calculates 0% coverage when no files are covered', () => {
      const sourceFiles = ['src/uncovered.ts'];
      const wikiPages = [{}];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);
      const coveragePercent = (covered.size / sourceFiles.length) * 100;

      assert.strictEqual(coveragePercent, 0);
    });
  });

  describe('realistic scenarios', () => {
    it('handles a typical wiki with mixed coverage sources', () => {
      const sourceFiles = [
        'src/index.ts',
        'src/app.ts',
        'src/services/auth.ts',
        'src/services/api.ts',
        'src/services/db.ts',
        'src/utils/helpers.ts',
        'src/utils/logger.ts',
        'src/domain/user.ts',
        'src/domain/post.ts',
      ];

      const wikiPages = [
        // Page about authentication - read auth service, references helpers
        {
          filesAccessed: ['src/services/auth.ts'],
          filesReferenced: ['src/utils/helpers.ts', 'src/domain/user.ts'],
        },
        // Page about the services directory
        {
          targetPaths: ['src/services/'],
        },
        // Page about app entry point
        {
          filesAccessed: ['src/index.ts', 'src/app.ts'],
        },
      ];

      const covered = calculateCoveredFiles(sourceFiles, wikiPages);

      // Should cover:
      // - src/services/auth.ts (filesAccessed)
      // - src/utils/helpers.ts (filesReferenced)
      // - src/domain/user.ts (filesReferenced)
      // - src/services/auth.ts, api.ts, db.ts (targetPaths with dir)
      // - src/index.ts, src/app.ts (filesAccessed)
      assert.strictEqual(covered.size, 7);
      assert.ok(covered.has('src/services/auth.ts'));
      assert.ok(covered.has('src/services/api.ts'));
      assert.ok(covered.has('src/services/db.ts'));
      assert.ok(covered.has('src/utils/helpers.ts'));
      assert.ok(covered.has('src/domain/user.ts'));
      assert.ok(covered.has('src/index.ts'));
      assert.ok(covered.has('src/app.ts'));
      // Not covered:
      assert.ok(!covered.has('src/utils/logger.ts'));
      assert.ok(!covered.has('src/domain/post.ts'));
    });
  });
});
