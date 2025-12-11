/**
 * Unit tests for entry point detection in priority scoring.
 *
 * Entry points (index.ts, main.ts, cli.ts, app.ts) are critical files
 * that should be documented first because:
 * - They're often the first files developers encounter
 * - They define the public API surface
 * - They show how the system is used
 *
 * TDD: Define behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isEntryPoint,
  calculatePriorityScoreWithEntryPoint,
  calculatePriorityScore,
} from '../../src/agents/orchestrator/file-coverage-tree.js';

describe('isEntryPoint', () => {
  describe('standard entry points', () => {
    it('identifies index.ts as entry point', () => {
      assert.strictEqual(isEntryPoint('src/index.ts'), true);
      assert.strictEqual(isEntryPoint('src/agents/index.ts'), true);
      assert.strictEqual(isEntryPoint('index.ts'), true);
    });

    it('identifies main.ts as entry point', () => {
      assert.strictEqual(isEntryPoint('src/main.ts'), true);
      assert.strictEqual(isEntryPoint('main.ts'), true);
    });

    it('identifies cli.ts as entry point', () => {
      assert.strictEqual(isEntryPoint('src/cli.ts'), true);
      assert.strictEqual(isEntryPoint('bin/cli.ts'), true);
    });

    it('identifies app.ts as entry point', () => {
      assert.strictEqual(isEntryPoint('src/app.ts'), true);
      assert.strictEqual(isEntryPoint('app.ts'), true);
    });

    it('identifies server.ts as entry point', () => {
      assert.strictEqual(isEntryPoint('src/server.ts'), true);
      assert.strictEqual(isEntryPoint('server.ts'), true);
    });
  });

  describe('JavaScript variants', () => {
    it('identifies .js entry points', () => {
      assert.strictEqual(isEntryPoint('src/index.js'), true);
      assert.strictEqual(isEntryPoint('src/main.js'), true);
      assert.strictEqual(isEntryPoint('src/cli.js'), true);
    });

    it('identifies .mjs entry points', () => {
      assert.strictEqual(isEntryPoint('src/index.mjs'), true);
      assert.strictEqual(isEntryPoint('src/main.mjs'), true);
    });

    it('identifies .tsx/.jsx entry points', () => {
      assert.strictEqual(isEntryPoint('src/index.tsx'), true);
      assert.strictEqual(isEntryPoint('src/App.tsx'), true);
      assert.strictEqual(isEntryPoint('src/main.jsx'), true);
    });
  });

  describe('non-entry points', () => {
    it('does not identify regular files as entry points', () => {
      assert.strictEqual(isEntryPoint('src/utils.ts'), false);
      assert.strictEqual(isEntryPoint('src/helpers/format.ts'), false);
      assert.strictEqual(isEntryPoint('src/services/llm-service.ts'), false);
    });

    it('does not identify similarly named files', () => {
      // Files with entry point names as substrings should not match
      assert.strictEqual(isEntryPoint('src/main-helper.ts'), false);
      assert.strictEqual(isEntryPoint('src/cli-utils.ts'), false);
      assert.strictEqual(isEntryPoint('src/app-config.ts'), false);
      assert.strictEqual(isEntryPoint('src/reindex.ts'), false);
    });

    it('does not identify test files', () => {
      assert.strictEqual(isEntryPoint('src/index.test.ts'), false);
      assert.strictEqual(isEntryPoint('src/main.spec.ts'), false);
      assert.strictEqual(isEntryPoint('tests/index.ts'), false);
    });
  });

  describe('case sensitivity', () => {
    it('handles common casing variations', () => {
      // React convention uses App.tsx
      assert.strictEqual(isEntryPoint('src/App.tsx'), true);
      assert.strictEqual(isEntryPoint('src/App.jsx'), true);
      // But INDEX.ts is unusual and should probably not match
      assert.strictEqual(isEntryPoint('src/INDEX.ts'), false);
    });
  });
});

describe('calculatePriorityScoreWithEntryPoint', () => {
  describe('entry point boosting', () => {
    it('boosts priority for entry points', () => {
      const regularScore = calculatePriorityScore(0, 100);
      const entryPointScore = calculatePriorityScoreWithEntryPoint(0, 100, 'src/index.ts');

      // Entry points should have higher score
      assert.ok(
        entryPointScore > regularScore,
        `Entry point score (${entryPointScore}) should be > regular (${regularScore})`
      );
    });

    it('applies consistent boost factor', () => {
      const regular = calculatePriorityScore(0, 100);
      const entryPoint = calculatePriorityScoreWithEntryPoint(0, 100, 'src/index.ts');

      // Should apply approximately 2x boost
      const ratio = entryPoint / regular;
      assert.ok(
        ratio >= 1.8 && ratio <= 2.2,
        `Expected ~2x boost, got ${ratio.toFixed(2)}x`
      );
    });

    it('boosts all entry point types equally', () => {
      const indexScore = calculatePriorityScoreWithEntryPoint(0, 100, 'src/index.ts');
      const mainScore = calculatePriorityScoreWithEntryPoint(0, 100, 'src/main.ts');
      const cliScore = calculatePriorityScoreWithEntryPoint(0, 100, 'src/cli.ts');
      const appScore = calculatePriorityScoreWithEntryPoint(0, 100, 'src/app.ts');

      // All entry points should get similar boost
      assert.strictEqual(indexScore, mainScore);
      assert.strictEqual(mainScore, cliScore);
      assert.strictEqual(cliScore, appScore);
    });

    it('does not boost regular files', () => {
      const regular = calculatePriorityScore(0, 100);
      const withPath = calculatePriorityScoreWithEntryPoint(0, 100, 'src/utils.ts');

      // Should be the same score
      assert.strictEqual(regular, withPath);
    });
  });

  describe('interaction with coverage and size', () => {
    it('entry point boost stacks with coverage factor', () => {
      // An undocumented entry point should score much higher than documented regular file
      const documentedRegular = calculatePriorityScoreWithEntryPoint(100, 500, 'src/utils.ts');
      const undocumentedEntryPoint = calculatePriorityScoreWithEntryPoint(0, 100, 'src/index.ts');

      assert.ok(
        undocumentedEntryPoint > documentedRegular,
        'Undocumented entry point should beat documented regular file'
      );
    });

    it('large entry point scores higher than small entry point', () => {
      const smallEntry = calculatePriorityScoreWithEntryPoint(0, 50, 'src/index.ts');
      const largeEntry = calculatePriorityScoreWithEntryPoint(0, 500, 'src/main.ts');

      assert.ok(
        largeEntry > smallEntry,
        'Large entry point should score higher than small entry point'
      );
    });

    it('undocumented regular can beat documented entry point', () => {
      const documentedEntry = calculatePriorityScoreWithEntryPoint(100, 100, 'src/index.ts');
      const undocumentedLarge = calculatePriorityScoreWithEntryPoint(0, 1000, 'src/big-service.ts');

      // Fully documented entry point scores 0, undocumented file should win
      assert.ok(
        undocumentedLarge > documentedEntry,
        'Undocumented file should beat fully documented entry point'
      );
    });
  });

  describe('sorting behavior', () => {
    it('correctly orders files with entry points first', () => {
      const files = [
        { path: 'src/utils.ts', coverage: 0, loc: 100 },
        { path: 'src/index.ts', coverage: 0, loc: 100 },
        { path: 'src/helpers.ts', coverage: 0, loc: 100 },
        { path: 'src/main.ts', coverage: 0, loc: 100 },
      ];

      const scored = files
        .map(f => ({
          ...f,
          score: calculatePriorityScoreWithEntryPoint(f.coverage, f.loc, f.path),
        }))
        .sort((a, b) => b.score - a.score);

      // Entry points should be at the top
      const top2Paths = scored.slice(0, 2).map(f => f.path);
      assert.ok(top2Paths.includes('src/index.ts'), 'index.ts should be in top 2');
      assert.ok(top2Paths.includes('src/main.ts'), 'main.ts should be in top 2');
    });

    it('maintains relative order among entry points by size', () => {
      const files = [
        { path: 'src/index.ts', coverage: 0, loc: 50 },
        { path: 'src/main.ts', coverage: 0, loc: 200 },
        { path: 'src/cli.ts', coverage: 0, loc: 100 },
      ];

      const scored = files
        .map(f => ({
          ...f,
          score: calculatePriorityScoreWithEntryPoint(f.coverage, f.loc, f.path),
        }))
        .sort((a, b) => b.score - a.score);

      // Should be ordered by size since all are entry points with same coverage
      assert.strictEqual(scored[0]!.path, 'src/main.ts');   // 200 LOC
      assert.strictEqual(scored[1]!.path, 'src/cli.ts');    // 100 LOC
      assert.strictEqual(scored[2]!.path, 'src/index.ts');  // 50 LOC
    });
  });

  describe('real-world scenarios', () => {
    it('prioritizes entry points in typical project', () => {
      const files = [
        { path: 'src/index.ts', coverage: 25, loc: 50 },        // Entry point, partially covered
        { path: 'src/services/api.ts', coverage: 0, loc: 300 }, // Service, uncovered
        { path: 'src/utils/format.ts', coverage: 0, loc: 100 }, // Utility, uncovered
        { path: 'src/main.ts', coverage: 0, loc: 80 },          // Entry point, uncovered
      ];

      const scored = files
        .map(f => ({
          ...f,
          score: calculatePriorityScoreWithEntryPoint(f.coverage, f.loc, f.path),
        }))
        .sort((a, b) => b.score - a.score);

      // main.ts should be first (entry point + uncovered)
      assert.strictEqual(scored[0]!.path, 'src/main.ts');
    });
  });
});
