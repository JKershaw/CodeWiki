import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sortByPathRelevance } from '../../src/utils/path-relevance.js';

describe('sortByPathRelevance', () => {
  describe('sorts by shared path prefix', () => {
    it('should prioritize paths with matching prefixes', () => {
      const paths = [
        'guides/testing',
        'architecture/overview',
        'src/agents/orchestrator',
        'src/services/llm',
        'commits/abc123',
      ];

      const result = sortByPathRelevance(paths, 'src/agents/codebase-explorer');

      // src/agents/* should come first (shares 2 segments)
      assert.strictEqual(result[0], 'src/agents/orchestrator');
      // src/services/* should come second (shares 1 segment)
      assert.strictEqual(result[1], 'src/services/llm');
    });

    it('should handle exact prefix matches', () => {
      const paths = [
        'other/page',
        'src/agents/orchestrator/context-gatherer',
        'src/agents/index',
      ];

      const result = sortByPathRelevance(paths, 'src/agents');

      // Both src/agents/* paths should come before other
      assert.ok(result.indexOf('src/agents/orchestrator/context-gatherer') < result.indexOf('other/page'));
      assert.ok(result.indexOf('src/agents/index') < result.indexOf('other/page'));
    });

    it('should preserve order for equally relevant paths', () => {
      const paths = [
        'src/a/foo',
        'src/b/bar',
        'src/c/baz',
      ];

      // All share 1 segment with target, should maintain relative order
      const result = sortByPathRelevance(paths, 'src/other');

      assert.deepStrictEqual(result, paths);
    });
  });

  describe('handles edge cases', () => {
    it('should handle empty input', () => {
      const result = sortByPathRelevance([], 'src/agents');
      assert.deepStrictEqual(result, []);
    });

    it('should handle no matching prefixes', () => {
      const paths = ['foo/bar', 'baz/qux'];
      const result = sortByPathRelevance(paths, 'completely/different');

      // Should maintain original order when no matches
      assert.deepStrictEqual(result, paths);
    });

    it('should handle single-segment paths', () => {
      const paths = ['overview', 'architecture', 'src'];
      const result = sortByPathRelevance(paths, 'src/agents');

      // 'src' shares prefix with target
      assert.strictEqual(result[0], 'src');
    });

    it('should handle target with no slashes', () => {
      const paths = ['src/agents', 'guides/testing', 'overview'];
      const result = sortByPathRelevance(paths, 'overview');

      // 'overview' exactly matches
      assert.strictEqual(result[0], 'overview');
    });
  });

  describe('real-world scenarios', () => {
    it('should prioritize related documentation for codebase exploration', () => {
      const existingPages = [
        'commits/abc123',
        'commits/def456',
        'guides/getting-started',
        'guides/testing',
        'architecture/overview',
        'src/services/llm',
        'src/agents/registry',
        'src/agents/orchestrator/overview',
        'src/web/routes',
      ];

      const result = sortByPathRelevance(existingPages, 'src/agents/codebase-explorer');

      // Most relevant paths should be at the top
      const top4 = result.slice(0, 4);

      // Should include all src/* pages in top positions
      assert.ok(top4.includes('src/agents/registry'), 'src/agents/registry should be in top 4');
      assert.ok(top4.includes('src/agents/orchestrator/overview'), 'src/agents/orchestrator should be in top 4');
      assert.ok(top4.includes('src/services/llm'), 'src/services/llm should be in top 4');
      assert.ok(top4.includes('src/web/routes'), 'src/web/routes should be in top 4');

      // Unrelated paths should be at the bottom
      const bottom3 = result.slice(-3);
      assert.ok(bottom3.includes('guides/getting-started'));
      assert.ok(bottom3.includes('guides/testing'));
      assert.ok(bottom3.includes('architecture/overview'));
    });
  });
});
