import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Tests for filesAccessed-based coverage calculation.
 *
 * The context-gatherer should use filesAccessed, filesReferenced, and targetPaths
 * from wiki pages to determine file coverage, NOT text-based mention matching.
 *
 * This ensures:
 * 1. Progress is guaranteed (once read, always covered)
 * 2. No stall at intermediate coverage levels (25% → 50% gap)
 * 3. Coverage aligns with KPI calculation
 */

import { buildCoveredFilesSet } from '../../src/agents/orchestrator/context-gatherer.js';

describe('Context Gatherer filesAccessed-based Coverage', () => {
  describe('buildCoveredFilesSet', () => {
    it('includes files from filesAccessed', () => {
      const wikiPages = [
        {
          path: 'services/auth',
          content: 'Auth documentation',
          filesAccessed: ['src/services/auth.ts', 'src/services/user.ts'],
          filesReferenced: [],
          targetPaths: [],
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      assert.ok(covered.has('src/services/auth.ts'));
      assert.ok(covered.has('src/services/user.ts'));
    });

    it('includes files from filesReferenced', () => {
      const wikiPages = [
        {
          path: 'overview',
          content: 'Overview mentioning files',
          filesAccessed: [],
          filesReferenced: ['src/index.ts', 'src/config.ts'],
          targetPaths: [],
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      assert.ok(covered.has('src/index.ts'));
      assert.ok(covered.has('src/config.ts'));
    });

    it('includes files from targetPaths (exact file matches)', () => {
      const wikiPages = [
        {
          path: 'utils/helpers',
          content: 'Helper documentation',
          filesAccessed: [],
          filesReferenced: [],
          targetPaths: ['src/utils/helpers.ts'],
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      assert.ok(covered.has('src/utils/helpers.ts'));
    });

    it('combines all sources across multiple pages', () => {
      const wikiPages = [
        {
          path: 'page1',
          content: 'Page 1',
          filesAccessed: ['src/a.ts'],
          filesReferenced: ['src/b.ts'],
          targetPaths: ['src/c.ts'],
        },
        {
          path: 'page2',
          content: 'Page 2',
          filesAccessed: ['src/d.ts'],
          filesReferenced: [],
          targetPaths: [],
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      assert.ok(covered.has('src/a.ts'));
      assert.ok(covered.has('src/b.ts'));
      assert.ok(covered.has('src/c.ts'));
      assert.ok(covered.has('src/d.ts'));
      assert.strictEqual(covered.size, 4);
    });

    it('deduplicates files appearing in multiple sources', () => {
      const wikiPages = [
        {
          path: 'page1',
          content: 'Page 1',
          filesAccessed: ['src/shared.ts'],
          filesReferenced: ['src/shared.ts'],
          targetPaths: ['src/shared.ts'],
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      assert.strictEqual(covered.size, 1);
      assert.ok(covered.has('src/shared.ts'));
    });

    it('handles empty wiki pages array', () => {
      const covered = buildCoveredFilesSet([]);

      assert.strictEqual(covered.size, 0);
    });

    it('handles pages with missing/undefined fields', () => {
      const wikiPages = [
        {
          path: 'page1',
          content: 'Page 1',
          // filesAccessed, filesReferenced, targetPaths not provided
        },
      ] as Array<{
        path: string;
        content: string;
        filesAccessed?: string[];
        filesReferenced?: string[];
        targetPaths?: string[];
      }>;

      const covered = buildCoveredFilesSet(wikiPages);

      assert.strictEqual(covered.size, 0);
    });

    it('does not expand directory targetPaths (only exact file matches)', () => {
      // Directory expansion is handled separately by the caller
      // buildCoveredFilesSet only collects what's explicitly listed
      const wikiPages = [
        {
          path: 'page1',
          content: 'Page 1',
          filesAccessed: [],
          filesReferenced: [],
          targetPaths: ['src/services/'], // Directory, not a file
        },
      ];

      const covered = buildCoveredFilesSet(wikiPages);

      // The directory path is included as-is; caller decides how to use it
      assert.ok(covered.has('src/services/'));
    });
  });
});
