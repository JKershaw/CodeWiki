/**
 * Unit tests for aggregate file documentation coverage calculation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateAggregateFileCoverage,
  type FileData,
  type WikiPageLike,
} from '../../src/agents/orchestrator/file-coverage-tree.js';

describe('calculateAggregateFileCoverage', () => {
  describe('empty inputs', () => {
    it('should return zeros for empty file list', () => {
      const files: FileData[] = [];
      const wikiPages: WikiPageLike[] = [];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 0);
      assert.strictEqual(result.totalFiles, 0);
      assert.strictEqual(result.documentedFiles, 0);
      assert.strictEqual(result.fullyDocumentedFiles, 0);
      assert.deepStrictEqual(result.byTier, {
        none: 0,
        mentioned: 0,
        sectioned: 0,
        dedicated: 0,
      });
    });

    it('should return zeros when files exist but no wiki pages', () => {
      const files: FileData[] = [
        { path: 'src/index.ts', loc: 100 },
        { path: 'src/utils.ts', loc: 50 },
      ];
      const wikiPages: WikiPageLike[] = [];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 0);
      assert.strictEqual(result.totalFiles, 2);
      assert.strictEqual(result.documentedFiles, 0);
      assert.strictEqual(result.fullyDocumentedFiles, 0);
      assert.deepStrictEqual(result.byTier, {
        none: 2,
        mentioned: 0,
        sectioned: 0,
        dedicated: 0,
      });
    });
  });

  describe('coverage tiers', () => {
    it('should categorize files with 25% coverage (mentioned)', () => {
      const files: FileData[] = [{ path: 'src/auth.ts', loc: 100 }];
      const wikiPages: WikiPageLike[] = [
        { path: 'overview', content: 'The auth.ts file handles login.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 25);
      assert.strictEqual(result.documentedFiles, 1);
      assert.strictEqual(result.fullyDocumentedFiles, 0);
      assert.strictEqual(result.byTier.mentioned, 1);
    });

    it('should categorize files with 50% coverage (sectioned via heading)', () => {
      const files: FileData[] = [{ path: 'src/auth.ts', loc: 100 }];
      const wikiPages: WikiPageLike[] = [
        { path: 'security', content: '# Auth\n\n## auth.ts\n\nThis file handles authentication.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 50);
      assert.strictEqual(result.documentedFiles, 1);
      assert.strictEqual(result.byTier.sectioned, 1);
    });

    it('should categorize files with 50% coverage (3+ mentions)', () => {
      const files: FileData[] = [{ path: 'src/auth.ts', loc: 100 }];
      const wikiPages: WikiPageLike[] = [
        {
          path: 'security',
          content:
            'The auth.ts handles login. When auth.ts processes requests, auth.ts validates tokens.',
        },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 50);
      assert.strictEqual(result.byTier.sectioned, 1);
    });

    it('should categorize files with 100% coverage (dedicated page)', () => {
      const files: FileData[] = [{ path: 'src/auth.ts', loc: 100 }];
      const wikiPages: WikiPageLike[] = [
        { path: 'auth', content: 'Dedicated page about the auth module.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 100);
      assert.strictEqual(result.documentedFiles, 1);
      assert.strictEqual(result.fullyDocumentedFiles, 1);
      assert.strictEqual(result.byTier.dedicated, 1);
    });
  });

  describe('weighted average calculation', () => {
    it('should weight coverage by LOC', () => {
      const files: FileData[] = [
        { path: 'src/large.ts', loc: 300 }, // 0% coverage
        { path: 'src/small.ts', loc: 100 }, // 100% coverage (dedicated page)
      ];
      const wikiPages: WikiPageLike[] = [
        { path: 'small', content: 'Dedicated page about small module.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      // Weighted average: (300 * 0 + 100 * 100) / 400 = 10000 / 400 = 25
      assert.strictEqual(result.coveragePercent, 25);
      assert.strictEqual(result.totalFiles, 2);
      assert.strictEqual(result.documentedFiles, 1);
      assert.strictEqual(result.fullyDocumentedFiles, 1);
    });

    it('should give higher weight to larger files', () => {
      const files: FileData[] = [
        { path: 'src/core.ts', loc: 500 }, // 100% coverage
        { path: 'src/utils.ts', loc: 50 }, // 0% coverage
      ];
      const wikiPages: WikiPageLike[] = [
        { path: 'core', content: 'Dedicated page about core module.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      // Weighted average: (500 * 100 + 50 * 0) / 550 = 50000 / 550 ≈ 90.9
      assert.ok(result.coveragePercent > 90);
      assert.ok(result.coveragePercent < 92);
    });
  });

  describe('mixed coverage scenarios', () => {
    it('should handle files with various coverage levels', () => {
      const files: FileData[] = [
        { path: 'src/none.ts', loc: 100 }, // 0%
        { path: 'src/mentioned.ts', loc: 100 }, // 25%
        { path: 'src/sectioned.ts', loc: 100 }, // 50%
        { path: 'src/dedicated.ts', loc: 100 }, // 100%
      ];
      const wikiPages: WikiPageLike[] = [
        { path: 'overview', content: 'mentioned.ts is referenced here.' },
        { path: 'guide', content: '## sectioned.ts\n\nDetailed section about this file.' },
        { path: 'dedicated', content: 'Full page about dedicated module.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      // Weighted average: (100*0 + 100*25 + 100*50 + 100*100) / 400 = 175 / 4 = 43.75
      assert.strictEqual(result.coveragePercent, 43.75);
      assert.strictEqual(result.totalFiles, 4);
      assert.strictEqual(result.documentedFiles, 3);
      assert.strictEqual(result.fullyDocumentedFiles, 1);
      assert.deepStrictEqual(result.byTier, {
        none: 1,
        mentioned: 1,
        sectioned: 1,
        dedicated: 1,
      });
    });

    it('should handle all files fully documented', () => {
      const files: FileData[] = [
        { path: 'src/auth.ts', loc: 100 },
        { path: 'src/db.ts', loc: 100 },
      ];
      const wikiPages: WikiPageLike[] = [
        { path: 'auth', content: 'Auth module documentation.' },
        { path: 'db', content: 'Database module documentation.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 100);
      assert.strictEqual(result.documentedFiles, 2);
      assert.strictEqual(result.fullyDocumentedFiles, 2);
      assert.strictEqual(result.byTier.dedicated, 2);
    });
  });

  describe('edge cases', () => {
    it('should handle files with zero LOC', () => {
      const files: FileData[] = [
        { path: 'src/empty.ts', loc: 0 },
        { path: 'src/nonempty.ts', loc: 100 },
      ];
      const wikiPages: WikiPageLike[] = [
        { path: 'nonempty', content: 'Documentation for nonempty.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      // Only nonempty.ts contributes to weighted average
      assert.strictEqual(result.coveragePercent, 100);
      assert.strictEqual(result.totalFiles, 2);
    });

    it('should handle camelCase to kebab-case wiki path matching', () => {
      const files: FileData[] = [{ path: 'src/userAuth.ts', loc: 100 }];
      const wikiPages: WikiPageLike[] = [
        { path: 'user-auth', content: 'User auth documentation.' },
      ];

      const result = calculateAggregateFileCoverage(files, wikiPages);

      assert.strictEqual(result.coveragePercent, 100);
      assert.strictEqual(result.fullyDocumentedFiles, 1);
    });
  });
});
