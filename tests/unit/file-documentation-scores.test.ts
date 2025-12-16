import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for fine-grained documentation coverage scoring.
 *
 * Coverage is calculated based on documentation depth:
 * - score(file) = Σ content.length / filesReferenced.length for each page referencing the file
 * - This gives finer granularity than binary covered/not-covered
 * - Files with dedicated pages get higher scores than files mentioned in overview pages
 */

import {
  buildFileDocumentationScores,
  type WikiPageWithFileTracking,
} from '../../src/agents/orchestrator/context-gatherer.js';

import { calculateFileCoverage } from '../../src/agents/orchestrator/file-coverage-tree.js';

describe('File Documentation Scores', () => {
  describe('buildFileDocumentationScores', () => {
    it('returns empty map for empty pages', () => {
      const scores = buildFileDocumentationScores([]);
      assert.strictEqual(scores.size, 0);
    });

    it('calculates score based on content length divided by files referenced count', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'services/auth',
          content: 'x'.repeat(1000), // 1000 chars
          filesReferenced: ['src/auth.ts', 'src/user.ts'], // 2 files
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Each file gets 1000 / 2 = 500 points
      assert.strictEqual(scores.get('src/auth.ts'), 500);
      assert.strictEqual(scores.get('src/user.ts'), 500);
    });

    it('gives higher score to files in focused pages', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'dedicated-page',
          content: 'x'.repeat(1000),
          filesReferenced: ['src/important.ts'], // Only 1 file - full score
        },
        {
          path: 'overview',
          content: 'x'.repeat(1000),
          filesReferenced: ['src/other.ts', 'src/another.ts', 'src/more.ts', 'src/extra.ts'], // 4 files - diluted
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // important.ts gets 1000/1 = 1000
      assert.strictEqual(scores.get('src/important.ts'), 1000);
      // other files get 1000/4 = 250 each
      assert.strictEqual(scores.get('src/other.ts'), 250);
    });

    it('accumulates scores across multiple pages', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'x'.repeat(600),
          filesReferenced: ['src/shared.ts', 'src/other.ts'], // 300 each
        },
        {
          path: 'page2',
          content: 'x'.repeat(400),
          filesReferenced: ['src/shared.ts'], // 400
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // shared.ts: 600/2 + 400/1 = 300 + 400 = 700
      assert.strictEqual(scores.get('src/shared.ts'), 700);
      // other.ts: 600/2 = 300
      assert.strictEqual(scores.get('src/other.ts'), 300);
    });

    it('handles pages with no filesReferenced', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'empty-page',
          content: 'Some content',
          filesReferenced: [],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      assert.strictEqual(scores.size, 0);
    });

    it('handles pages with undefined filesReferenced', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page',
          content: 'Content',
          // filesReferenced not set
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      assert.strictEqual(scores.size, 0);
    });

    it('handles empty content', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'empty',
          content: '',
          filesReferenced: ['src/file.ts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      assert.strictEqual(scores.get('src/file.ts'), 0);
    });
  });

  describe('calculateFileCoverage with scores', () => {
    it('returns 0 for files not in scores map', () => {
      const scores = new Map<string, number>();
      const coverage = calculateFileCoverage('src/unknown.ts', scores, 100);
      assert.strictEqual(coverage, 0);
    });

    it('normalizes score to percentage based on max score', () => {
      const scores = new Map<string, number>([
        ['src/high.ts', 1000],
        ['src/low.ts', 250],
      ]);

      // maxScore is 1000, so:
      // high.ts: 1000/1000 * 100 = 100%
      // low.ts: 250/1000 * 100 = 25%
      assert.strictEqual(calculateFileCoverage('src/high.ts', scores, 1000), 100);
      assert.strictEqual(calculateFileCoverage('src/low.ts', scores, 1000), 25);
    });

    it('uses minimum maxScore of 100', () => {
      const scores = new Map<string, number>([
        ['src/file.ts', 50],
      ]);

      // Even though max in map is 50, we use max(50, 100) = 100
      // So 50/100 * 100 = 50%
      assert.strictEqual(calculateFileCoverage('src/file.ts', scores, 50), 50);
    });

    it('caps coverage at 100%', () => {
      const scores = new Map<string, number>([
        ['src/file.ts', 200],
      ]);

      // 200/100 * 100 = 200, but cap at 100
      assert.strictEqual(calculateFileCoverage('src/file.ts', scores, 100), 100);
    });
  });

  describe('calculateFileCoverage folder inheritance', () => {
    it('inherits coverage from parent folder when file has no direct score', () => {
      // src/agents/ has score 1000, src/agents/orchestrator.ts has no direct score
      const scores = new Map<string, number>([['src/agents/', 1000]]);
      const coverage = calculateFileCoverage('src/agents/orchestrator.ts', scores, 1000);
      // Should inherit from src/agents/ with dampening (70%)
      assert.strictEqual(coverage, 70);
    });

    it('prefers exact file match over parent folder', () => {
      const scores = new Map<string, number>([
        ['src/agents/', 500],
        ['src/agents/orchestrator.ts', 1000],
      ]);
      const coverage = calculateFileCoverage('src/agents/orchestrator.ts', scores, 1000);
      // Should use exact match (100%), not folder
      assert.strictEqual(coverage, 100);
    });

    it('prefers closest ancestor (most specific folder)', () => {
      const scores = new Map<string, number>([
        ['src/', 200],
        ['src/agents/', 800],
      ]);
      const coverage = calculateFileCoverage('src/agents/orchestrator.ts', scores, 1000);
      // Should inherit from src/agents/ (closest), not src/
      // 800 * 0.7 / 1000 * 100 = 56%
      assert.strictEqual(coverage, 56);
    });

    it('handles folder paths without trailing slash', () => {
      const scores = new Map<string, number>([['src/agents', 1000]]);
      const coverage = calculateFileCoverage('src/agents/orchestrator.ts', scores, 1000);
      // Should work with or without trailing slash
      assert.strictEqual(coverage, 70);
    });

    it('returns 0 for files with no ancestor scores', () => {
      const scores = new Map<string, number>([['src/services/', 1000]]);
      const coverage = calculateFileCoverage('src/agents/orchestrator.ts', scores, 1000);
      // No ancestor of src/agents/orchestrator.ts has a score
      assert.strictEqual(coverage, 0);
    });

    it('inherits from deeply nested folder path', () => {
      const scores = new Map<string, number>([['src/agents/orchestrator/', 1000]]);
      const coverage = calculateFileCoverage('src/agents/orchestrator/strategies.ts', scores, 1000);
      // Should inherit from immediate parent
      assert.strictEqual(coverage, 70);
    });

    it('does not inherit from child folders', () => {
      // Child folder has score but parent file should not inherit
      const scores = new Map<string, number>([['src/agents/orchestrator/', 1000]]);
      const coverage = calculateFileCoverage('src/agents/index.ts', scores, 1000);
      // src/agents/index.ts is not under src/agents/orchestrator/
      assert.strictEqual(coverage, 0);
    });
  });
});
