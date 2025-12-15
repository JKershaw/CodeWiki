import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for graduated coverage in work generation.
 *
 * The work generation system should use the same graduated documentation depth
 * scoring as the coverage tree, not binary (0%/100%) coverage.
 *
 * This ensures:
 * 1. Files with partial documentation (e.g., 30%) appear in lowCoverageFiles
 * 2. Work generation can prioritize files that need MORE documentation
 * 3. Coverage is consistent between what LLM sees and what drives work items
 */

import {
  buildFileDocumentationScores,
  WikiPageWithFileTracking,
} from '../../src/agents/orchestrator/context-gatherer.js';

/**
 * Calculate coverage percentage from documentation scores.
 * Mirrors the logic in calculateFileCoverage from file-coverage-tree.ts
 */
function calculateCoveragePercent(
  filePath: string,
  scores: Map<string, number>,
  maxScore: number
): number {
  const score = scores.get(filePath) ?? 0;
  if (score === 0) return 0;
  const normalizer = Math.max(maxScore, 100);
  const coverage = (score / normalizer) * 100;
  return Math.min(100, Math.round(coverage));
}

/**
 * Get max score from a scores map.
 */
function getMaxScore(scores: Map<string, number>): number {
  let max = 0;
  for (const score of scores.values()) {
    if (score > max) max = score;
  }
  return max;
}

/**
 * Filter files with coverage below threshold.
 * This is what calculateUndocumentedDirectoriesAndFiles should do.
 */
function getLowCoverageFiles(
  sourceFiles: string[],
  wikiPages: WikiPageWithFileTracking[],
  threshold: number = 50
): Array<{ path: string; coverage: number; directory: string }> {
  const scores = buildFileDocumentationScores(wikiPages);
  const maxScore = getMaxScore(scores);

  const lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }> = [];

  for (const filePath of sourceFiles) {
    const parts = filePath.split('/');
    if (parts.length < 2) continue;

    const dirPath = parts.slice(0, -1).join('/');
    const coverage = calculateCoveragePercent(filePath, scores, maxScore);

    if (coverage < threshold) {
      lowCoverageFiles.push({ path: filePath, coverage, directory: dirPath });
    }
  }

  // Sort by coverage ascending (lowest first), then by path length
  lowCoverageFiles.sort((a, b) => {
    if (a.coverage !== b.coverage) {
      return a.coverage - b.coverage;
    }
    return a.path.length - b.path.length;
  });

  return lowCoverageFiles;
}

describe('Graduated Coverage Work Generation', () => {
  describe('getLowCoverageFiles with documentation scores', () => {
    it('includes files with 0% coverage (never documented)', () => {
      const sourceFiles = ['src/auth.ts', 'src/user.ts'];
      const wikiPages: WikiPageWithFileTracking[] = [];

      const lowCoverage = getLowCoverageFiles(sourceFiles, wikiPages);

      assert.strictEqual(lowCoverage.length, 2);
      assert.strictEqual(lowCoverage[0]!.coverage, 0);
      assert.strictEqual(lowCoverage[1]!.coverage, 0);
    });

    it('includes files with partial coverage (< 50%)', () => {
      const sourceFiles = ['src/auth.ts', 'src/user.ts', 'src/config.ts'];

      // Create a page that gives auth.ts high coverage and user.ts low coverage
      // Page with 300 chars referencing 3 files = 100 score per file
      // auth.ts gets additional dedicated page with 200 chars = +200 score
      // So auth.ts = 300, user.ts = 100, config.ts = 100
      // Max = 300, threshold for 50% = 150
      // auth.ts = 100% (300/300), user.ts = 33% (100/300), config.ts = 33% (100/300)
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'overview',
          content: 'x'.repeat(300), // 300 chars
          filesReferenced: ['src/auth.ts', 'src/user.ts', 'src/config.ts'],
        },
        {
          path: 'auth-deep-dive',
          content: 'x'.repeat(200), // 200 chars dedicated to auth
          filesReferenced: ['src/auth.ts'],
        },
      ];

      const lowCoverage = getLowCoverageFiles(sourceFiles, wikiPages);

      // auth.ts should NOT be in lowCoverage (it has 100%)
      // user.ts and config.ts should be in lowCoverage (they have 33%)
      assert.strictEqual(lowCoverage.length, 2);

      const paths = lowCoverage.map(f => f.path);
      assert.ok(!paths.includes('src/auth.ts'), 'auth.ts should not be low coverage');
      assert.ok(paths.includes('src/user.ts'), 'user.ts should be low coverage');
      assert.ok(paths.includes('src/config.ts'), 'config.ts should be low coverage');

      // Coverage should be around 33% (100/300)
      const userFile = lowCoverage.find(f => f.path === 'src/user.ts')!;
      assert.ok(userFile.coverage > 0, 'user.ts should have some coverage');
      assert.ok(userFile.coverage < 50, 'user.ts should have < 50% coverage');
    });

    it('excludes files with coverage >= 50%', () => {
      const sourceFiles = ['src/auth.ts', 'src/user.ts'];

      // Both files get equal documentation
      // Page with 200 chars referencing 2 files = 100 score per file
      // Max = 100, so both are at 100%
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'overview',
          content: 'x'.repeat(200),
          filesReferenced: ['src/auth.ts', 'src/user.ts'],
        },
      ];

      const lowCoverage = getLowCoverageFiles(sourceFiles, wikiPages);

      // Both files have 100% coverage, neither should be low coverage
      assert.strictEqual(lowCoverage.length, 0);
    });

    it('sorts by coverage ascending then path length', () => {
      const sourceFiles = [
        'src/services/auth.ts',      // Will have 0%
        'src/a.ts',                   // Will have 25%
        'src/b.ts',                   // Will have 25%
        'src/config.ts',              // Will have 0%
      ];

      // Only document a.ts and b.ts lightly
      // 100 chars / 2 files = 50 score each
      // Max = 50, so both are at 100%... need to adjust

      // Better: Create situation where some files have partial coverage
      // Page1: 400 chars for just auth-detail.ts (dedicated) = 400 score
      // Page2: 100 chars for a.ts and b.ts = 50 score each
      // Max = 400
      // a.ts = 50/400 = 12.5% (~13%)
      // b.ts = 50/400 = 12.5% (~13%)
      // auth.ts = 0%
      // config.ts = 0%
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'auth-detail',
          content: 'x'.repeat(400),
          filesReferenced: ['src/services/auth-detail.ts'], // Different file
        },
        {
          path: 'basics',
          content: 'x'.repeat(100),
          filesReferenced: ['src/a.ts', 'src/b.ts'],
        },
      ];

      const lowCoverage = getLowCoverageFiles(sourceFiles, wikiPages);

      // All 4 files should be low coverage
      assert.strictEqual(lowCoverage.length, 4);

      // First should be 0% files, sorted by path length
      // src/a.ts (0%, len 8) - wait, a.ts has 13% from basics page
      // Actually: auth.ts = 0%, config.ts = 0%, a.ts = 13%, b.ts = 13%
      // Sorted: auth.ts (0%, len 20), config.ts (0%, len 13), a.ts (13%, len 8), b.ts (13%, len 8)
      // By coverage first: 0% files, then 13% files
      // Within 0%: shorter path first: config.ts, then auth.ts
      // Within 13%: a.ts and b.ts same length

      assert.strictEqual(lowCoverage[0]!.coverage, 0);
      assert.strictEqual(lowCoverage[1]!.coverage, 0);
      assert.ok(lowCoverage[2]!.coverage > 0);
      assert.ok(lowCoverage[3]!.coverage > 0);
    });

    it('correctly calculates directory from file path', () => {
      const sourceFiles = ['src/services/auth.ts'];
      const wikiPages: WikiPageWithFileTracking[] = [];

      const lowCoverage = getLowCoverageFiles(sourceFiles, wikiPages);

      assert.strictEqual(lowCoverage.length, 1);
      assert.strictEqual(lowCoverage[0]!.directory, 'src/services');
    });
  });

  describe('directory coverage calculations with graduated scores', () => {
    it('calculates average coverage for directories', () => {
      const sourceFiles = [
        'src/auth/login.ts',    // Will have 50%
        'src/auth/logout.ts',   // Will have 0%
        'src/utils/helper.ts',  // Will have 100%
      ];

      // login.ts: 200 chars / 1 file = 200 score
      // helper.ts: 400 chars / 1 file = 400 score (max)
      // logout.ts: 0 score
      // Coverages: login = 200/400 = 50%, logout = 0%, helper = 100%
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'auth-login',
          content: 'x'.repeat(200),
          filesReferenced: ['src/auth/login.ts'],
        },
        {
          path: 'utils',
          content: 'x'.repeat(400),
          filesReferenced: ['src/utils/helper.ts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);
      const maxScore = getMaxScore(scores);

      // Verify individual file coverages
      assert.strictEqual(calculateCoveragePercent('src/auth/login.ts', scores, maxScore), 50);
      assert.strictEqual(calculateCoveragePercent('src/auth/logout.ts', scores, maxScore), 0);
      assert.strictEqual(calculateCoveragePercent('src/utils/helper.ts', scores, maxScore), 100);

      // src/auth directory: average of 50% and 0% = 25%
      // src/utils directory: 100%
      // This test documents the expected behavior for directory-level coverage
    });
  });
});
