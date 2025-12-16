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

      // Empty content pages don't contribute scores - file not in map
      assert.strictEqual(scores.has('src/file.ts'), false);
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

  describe('buildFileDocumentationScores with targetPaths normalization', () => {
    it('resolves bare filenames using targetPaths prefix', () => {
      // This test demonstrates the bug: when LLM writes content about files,
      // it often uses bare filenames like `export-wiki.ts` instead of full paths
      // like `scripts/export-wiki.ts`. The targetPaths tells us the directory context.
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'scripts/export-wiki',
          content: 'x'.repeat(1000),
          filesReferenced: ['export-wiki.ts'], // LLM used bare filename
          targetPaths: ['scripts'], // But we know the target directory
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should resolve 'export-wiki.ts' to 'scripts/export-wiki.ts'
      // and give it the full score
      assert.strictEqual(scores.get('scripts/export-wiki.ts'), 1000);
      // The bare filename should NOT have a score (it's been resolved)
      assert.strictEqual(scores.has('export-wiki.ts'), false);
    });

    it('resolves multiple bare filenames in same directory', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'scripts/overview',
          content: 'x'.repeat(900),
          filesReferenced: ['audit-prompts.ts', 'export-wiki.ts', 'generate-and-review.ts'],
          targetPaths: ['scripts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Each file should get 900/3 = 300 points under scripts/ prefix
      assert.strictEqual(scores.get('scripts/audit-prompts.ts'), 300);
      assert.strictEqual(scores.get('scripts/export-wiki.ts'), 300);
      assert.strictEqual(scores.get('scripts/generate-and-review.ts'), 300);
    });

    it('does not modify already-qualified paths', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'docs/services',
          content: 'x'.repeat(500),
          filesReferenced: ['src/services/auth.ts'], // Already has path
          targetPaths: ['src/services'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should keep the original full path
      assert.strictEqual(scores.get('src/services/auth.ts'), 500);
      // Should NOT create a duplicate with targetPath prefix
      assert.strictEqual(scores.has('src/services/src/services/auth.ts'), false);
    });

    it('handles mixed bare and qualified paths', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'scripts/docs',
          content: 'x'.repeat(600),
          filesReferenced: [
            'export-wiki.ts', // Bare filename
            'src/cli.ts', // Already qualified
          ],
          targetPaths: ['scripts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Bare filename resolved with targetPath
      assert.strictEqual(scores.get('scripts/export-wiki.ts'), 300);
      // Qualified path kept as-is
      assert.strictEqual(scores.get('src/cli.ts'), 300);
    });

    it('handles pages without targetPaths (bare filenames kept as-is)', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'overview',
          content: 'x'.repeat(400),
          filesReferenced: ['file.ts'], // Bare filename
          // No targetPaths - can't resolve
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Without targetPaths, bare filename is kept as-is
      assert.strictEqual(scores.get('file.ts'), 400);
    });

    it('handles multiple targetPaths by using first one', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'multi-target',
          content: 'x'.repeat(500),
          filesReferenced: ['helper.ts'],
          targetPaths: ['src/utils', 'tests/helpers'], // Multiple targets
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should use first targetPath
      assert.strictEqual(scores.get('src/utils/helper.ts'), 500);
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

  describe('buildFileDocumentationScores with filesAccessed fallback', () => {
    it('uses filesAccessed when filesReferenced is empty', () => {
      // This addresses the Phase 2 stall bug: when LLM uses prose fallback,
      // filesReferenced extraction often fails, but filesAccessed (from tool metrics)
      // still tracks which files were read.
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'src/agents',
          content: 'x'.repeat(1000),
          filesReferenced: [], // No references extracted from content
          filesAccessed: ['src/agents/base-agent.ts', 'src/agents/registry.ts'], // But these files were read
          targetPaths: ['src/agents'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should use filesAccessed as fallback
      assert.strictEqual(scores.get('src/agents/base-agent.ts'), 500);
      assert.strictEqual(scores.get('src/agents/registry.ts'), 500);
    });

    it('combines both filesReferenced AND filesAccessed for coverage', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'scripts/export',
          content: 'x'.repeat(600),
          filesReferenced: ['export-wiki.ts'], // Content extracted reference
          filesAccessed: ['export-wiki.ts', 'audit-prompts.ts', 'generate-and-review.ts'], // Files read
          targetPaths: ['scripts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should use BOTH filesReferenced AND filesAccessed (3 unique files)
      // export-wiki.ts appears in both but should only be counted once
      // Score = 600 / 3 = 200 for each file
      assert.strictEqual(scores.get('scripts/export-wiki.ts'), 200);
      assert.strictEqual(scores.get('scripts/audit-prompts.ts'), 200);
      assert.strictEqual(scores.get('scripts/generate-and-review.ts'), 200);
    });

    it('resolves bare filenames in filesAccessed using targetPaths', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'scripts/overview',
          content: 'x'.repeat(900),
          filesReferenced: [],
          filesAccessed: ['export-wiki.ts', 'audit-prompts.ts', 'generate-and-review.ts'],
          targetPaths: ['scripts'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Should resolve bare filenames with targetPath
      assert.strictEqual(scores.get('scripts/export-wiki.ts'), 300);
      assert.strictEqual(scores.get('scripts/audit-prompts.ts'), 300);
      assert.strictEqual(scores.get('scripts/generate-and-review.ts'), 300);
    });

    it('handles filesAccessed with already qualified paths', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'commits/abc123',
          content: 'x'.repeat(800),
          filesReferenced: [],
          filesAccessed: ['src/agents/base.ts', 'tests/unit/base.test.ts'],
          targetPaths: [], // Commit pages often don't have targetPaths
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Already qualified paths should be kept as-is
      assert.strictEqual(scores.get('src/agents/base.ts'), 400);
      assert.strictEqual(scores.get('tests/unit/base.test.ts'), 400);
    });

    it('does not use filesAccessed fallback when page has no content', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'empty-page',
          content: '', // Empty content
          filesReferenced: [],
          filesAccessed: ['src/file.ts'],
          targetPaths: ['src'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // No scores should be generated for empty content
      assert.strictEqual(scores.size, 0);
    });

    it('accumulates scores from multiple pages using filesAccessed', () => {
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'x'.repeat(400),
          filesReferenced: [],
          filesAccessed: ['src/shared.ts', 'src/unique1.ts'],
          targetPaths: ['src'],
        },
        {
          path: 'page2',
          content: 'x'.repeat(600),
          filesReferenced: [],
          filesAccessed: ['src/shared.ts', 'src/unique2.ts'],
          targetPaths: ['src'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // shared.ts should have accumulated score from both pages
      // Page 1: 400/2 = 200, Page 2: 600/2 = 300 → Total: 500
      assert.strictEqual(scores.get('src/shared.ts'), 500);
      assert.strictEqual(scores.get('src/unique1.ts'), 200);
      assert.strictEqual(scores.get('src/unique2.ts'), 300);
    });

    it('filters out directory paths from filesReferenced to prevent ancestor inheritance', () => {
      // This test ensures directory paths (ending with '/') are filtered out.
      // Without this fix, a directory like 'src/' in filesReferenced would cause
      // ALL files under src/ to inherit coverage via calculateFileCoverage's
      // ancestor lookup, resulting in 96%+ touchedFilesRatio with just a few pages.
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'The src/ directory contains the main code.',
          filesReferenced: ['src/', 'src/agents/', 'src/index.ts'], // Mix of dirs and files
          filesAccessed: [],
          targetPaths: ['src'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Directory paths should NOT be in the scores map
      assert.strictEqual(scores.get('src/'), undefined, 'Directory path src/ should not be scored');
      assert.strictEqual(scores.get('src/agents/'), undefined, 'Directory path src/agents/ should not be scored');

      // Only the actual file should have a score
      assert.ok(scores.get('src/index.ts')! > 0, 'File src/index.ts should have a score');

      // Only 1 file (src/index.ts) should be scored, getting full content score
      assert.strictEqual(scores.size, 1, 'Only actual files should be scored');
    });

    it('falls back to filesAccessed but still filters directories', () => {
      // When filesReferenced is empty, filesAccessed is used. Ensure directories
      // are filtered there too (though unlikely, for defensive coding).
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'Documentation for this directory.',
          filesReferenced: [], // Empty - will fall back to filesAccessed
          filesAccessed: ['src/', 'src/utils.ts'], // Mix
          targetPaths: ['src'],
        },
      ];

      const scores = buildFileDocumentationScores(wikiPages);

      // Directory path should NOT be scored
      assert.strictEqual(scores.get('src/'), undefined, 'Directory path should not be scored');

      // Only actual file should have score
      assert.strictEqual(scores.size, 1);
      assert.ok(scores.get('src/utils.ts')! > 0, 'File should have a score');
    });

    it('validates paths against sourceFileSet when provided', () => {
      // When sourceFileSet is provided, only paths that exist in the set are scored.
      // This definitively filters out directories (even without trailing slash)
      // and non-existent files.
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'Documentation mentioning directories and files.',
          filesReferenced: [
            'src/agents',           // Directory without trailing slash - should be filtered
            'src/agents/foo.ts',    // Valid file
            'src/agents/bar.ts',    // Valid file
            'src/nonexistent.ts',   // Non-existent file - should be filtered
          ],
          filesAccessed: [],
          targetPaths: ['src/agents'],
        },
      ];

      // Simulate the source file set (what getFileTree would return)
      const sourceFileSet = new Set([
        'src/agents/foo.ts',
        'src/agents/bar.ts',
        'src/agents/baz.ts',  // Exists but not referenced
        'src/other.ts',
      ]);

      const scores = buildFileDocumentationScores(wikiPages, sourceFileSet);

      // Only the two valid files should be scored
      assert.strictEqual(scores.size, 2, 'Only valid source files should be scored');
      assert.ok(scores.get('src/agents/foo.ts')! > 0, 'Valid file foo.ts should have a score');
      assert.ok(scores.get('src/agents/bar.ts')! > 0, 'Valid file bar.ts should have a score');

      // Directory and non-existent file should NOT be scored
      assert.strictEqual(scores.get('src/agents'), undefined, 'Directory without slash should not be scored');
      assert.strictEqual(scores.get('src/nonexistent.ts'), undefined, 'Non-existent file should not be scored');
    });

    it('without sourceFileSet, directories without trailing slash may be scored (pre-filter only)', () => {
      // Without sourceFileSet, the only filter is the trailing '/' check.
      // Directories without trailing slash will be scored (but this is fine for
      // diagnostic purposes - the actual coverage calculation always uses sourceFileSet).
      const wikiPages: WikiPageWithFileTracking[] = [
        {
          path: 'page1',
          content: 'The src/agents directory.',
          filesReferenced: ['src/agents', 'src/agents/foo.ts'], // Dir without slash
          filesAccessed: [],
          targetPaths: ['src'],
        },
      ];

      // No sourceFileSet - only trailing '/' filter applies
      const scores = buildFileDocumentationScores(wikiPages);

      // Both will be scored because 'src/agents' doesn't end with '/'
      assert.strictEqual(scores.size, 2, 'Without sourceFileSet, dir without slash is scored');
      assert.ok(scores.get('src/agents')! > 0, 'Dir without trailing slash is scored (pre-filter only)');
      assert.ok(scores.get('src/agents/foo.ts')! > 0, 'File is scored');
    });
  });
});
