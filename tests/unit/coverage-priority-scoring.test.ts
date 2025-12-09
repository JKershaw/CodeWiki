/**
 * Unit tests for coverage priority scoring.
 *
 * The priority score determines which files/directories are most important
 * to document next. Higher scores = higher priority.
 *
 * Formula: score = (1 - coveragePercent/100) * Math.log(loc + 1)
 *
 * TDD Phase 2: Define scoring behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Future import:
// import { calculatePriorityScore } from '../../src/agents/orchestrator/file-coverage-tree.js';

/**
 * Calculate priority score for a file or directory.
 *
 * Higher scores indicate higher priority for documentation.
 * - Uncovered items score higher than covered ones
 * - Larger items score higher than smaller ones (with log scaling)
 *
 * @param coveragePercent - Coverage percentage (0-100)
 * @param loc - Lines of code
 * @returns Priority score (higher = more important to document)
 */
function calculatePriorityScore(coveragePercent: number, loc: number): number {
  const coverageFactor = 1 - coveragePercent / 100;
  const sizeFactor = Math.log(loc + 1);
  return coverageFactor * sizeFactor;
}

describe('calculatePriorityScore', () => {
  describe('basic scoring', () => {
    it('scores uncovered large files highest', () => {
      const score = calculatePriorityScore(0, 800);
      // 1.0 * log(801) ≈ 6.68
      assert.ok(score > 6, `Expected score > 6, got ${score}`);
    });

    it('scores covered files lowest regardless of size', () => {
      const coveredLarge = calculatePriorityScore(100, 800);
      const uncoveredSmall = calculatePriorityScore(0, 20);

      // 100% covered = 0 factor, so score is 0
      assert.strictEqual(coveredLarge, 0);
      // 0% covered, 20 LOC = 1.0 * log(21) ≈ 3.04
      assert.ok(uncoveredSmall > 3, `Expected uncoveredSmall > 3, got ${uncoveredSmall}`);
    });

    it('returns 0 for fully covered items', () => {
      assert.strictEqual(calculatePriorityScore(100, 1000), 0);
      assert.strictEqual(calculatePriorityScore(100, 1), 0);
      assert.strictEqual(calculatePriorityScore(100, 0), 0);
    });

    it('returns 0 for empty files regardless of coverage', () => {
      // log(0 + 1) = log(1) = 0
      assert.strictEqual(calculatePriorityScore(0, 0), 0);
      assert.strictEqual(calculatePriorityScore(50, 0), 0);
    });
  });

  describe('coverage factor behavior', () => {
    it('linearly scales with uncovered percentage', () => {
      const loc = 100; // Fixed size for comparison

      const score0 = calculatePriorityScore(0, loc);   // 100% uncovered
      const score50 = calculatePriorityScore(50, loc); // 50% uncovered
      const score100 = calculatePriorityScore(100, loc); // 0% uncovered

      // 50% coverage should give half the score of 0% coverage
      assert.ok(Math.abs(score50 - score0 / 2) < 0.01,
        `Expected score50 (${score50}) ≈ score0/2 (${score0 / 2})`);
      assert.strictEqual(score100, 0);
    });

    it('gives higher priority to less covered files', () => {
      const loc = 500;

      const score10 = calculatePriorityScore(10, loc);
      const score30 = calculatePriorityScore(30, loc);
      const score70 = calculatePriorityScore(70, loc);
      const score90 = calculatePriorityScore(90, loc);

      assert.ok(score10 > score30);
      assert.ok(score30 > score70);
      assert.ok(score70 > score90);
    });
  });

  describe('size factor behavior (log scaling)', () => {
    it('uses log scaling to prevent huge files from dominating', () => {
      // Without log: 10000 LOC would be 100x more important than 100 LOC
      // With log: log(10001)/log(101) ≈ 9.21/4.62 ≈ 2x more important
      const scoreSmall = calculatePriorityScore(0, 100);
      const scoreLarge = calculatePriorityScore(0, 10000);

      const ratio = scoreLarge / scoreSmall;
      // Should be roughly 2x, not 100x
      assert.ok(ratio > 1.5 && ratio < 3,
        `Expected ratio 1.5-3, got ${ratio}`);
    });

    it('still prioritizes larger files over smaller ones', () => {
      const score100 = calculatePriorityScore(0, 100);
      const score500 = calculatePriorityScore(0, 500);
      const score1000 = calculatePriorityScore(0, 1000);

      assert.ok(score1000 > score500);
      assert.ok(score500 > score100);
    });

    it('handles very small files', () => {
      const score1 = calculatePriorityScore(0, 1);
      const score5 = calculatePriorityScore(0, 5);
      const score10 = calculatePriorityScore(0, 10);

      // log(2) ≈ 0.69, log(6) ≈ 1.79, log(11) ≈ 2.40
      assert.ok(score1 > 0);
      assert.ok(score5 > score1);
      assert.ok(score10 > score5);
    });

    it('handles very large files', () => {
      const score = calculatePriorityScore(0, 50000);
      // log(50001) ≈ 10.82
      assert.ok(score > 10 && score < 12,
        `Expected score 10-12, got ${score}`);
    });
  });

  describe('combined behavior', () => {
    it('balances coverage and size appropriately', () => {
      // Scenario: Which is more important to document?
      // A: 800 LOC, 20% covered (mostly undocumented, large)
      // B: 200 LOC, 0% covered (completely undocumented, small)

      const scoreA = calculatePriorityScore(20, 800);
      const scoreB = calculatePriorityScore(0, 200);

      // A: 0.8 * log(801) ≈ 0.8 * 6.69 ≈ 5.35
      // B: 1.0 * log(201) ≈ 1.0 * 5.30 ≈ 5.30
      // They should be close, with A slightly higher due to size
      assert.ok(Math.abs(scoreA - scoreB) < 1,
        `Expected scores to be close: A=${scoreA}, B=${scoreB}`);
    });

    it('prioritizes large uncovered over small uncovered', () => {
      const largUncovered = calculatePriorityScore(0, 800);
      const smallUncovered = calculatePriorityScore(0, 50);

      assert.ok(largUncovered > smallUncovered);
    });

    it('prioritizes small uncovered over large covered', () => {
      const smallUncovered = calculatePriorityScore(0, 50);
      const largeCovered = calculatePriorityScore(100, 800);

      assert.ok(smallUncovered > largeCovered);
    });

    it('makes reasonable tradeoffs between coverage and size', () => {
      // Scenario: 50% covered 1000 LOC vs 0% covered 100 LOC
      // Which is more important?

      const halfCoveredLarge = calculatePriorityScore(50, 1000);
      const uncoveredSmall = calculatePriorityScore(0, 100);

      // half covered large: 0.5 * log(1001) ≈ 0.5 * 6.91 ≈ 3.45
      // uncovered small: 1.0 * log(101) ≈ 1.0 * 4.62 ≈ 4.62
      // The small uncovered file should win - it's completely undocumented
      assert.ok(uncoveredSmall > halfCoveredLarge,
        `Expected small uncovered (${uncoveredSmall}) > half-covered large (${halfCoveredLarge})`);
    });
  });

  describe('edge cases', () => {
    it('handles 0 LOC files', () => {
      const score = calculatePriorityScore(0, 0);
      assert.strictEqual(score, 0);
    });

    it('handles exactly 1 LOC files', () => {
      const score = calculatePriorityScore(0, 1);
      // log(2) ≈ 0.693
      assert.ok(score > 0.6 && score < 0.8,
        `Expected score ~0.69, got ${score}`);
    });

    it('handles coverage boundary at 0%', () => {
      const score = calculatePriorityScore(0, 100);
      const expected = Math.log(101);
      assert.strictEqual(score, expected);
    });

    it('handles coverage boundary at 100%', () => {
      const score = calculatePriorityScore(100, 100);
      assert.strictEqual(score, 0);
    });

    it('handles fractional coverage percentages', () => {
      const score = calculatePriorityScore(33.33, 100);
      // (1 - 0.3333) * log(101) ≈ 0.667 * 4.62 ≈ 3.08
      assert.ok(score > 3 && score < 3.2,
        `Expected score ~3.08, got ${score}`);
    });
  });

  describe('sorting by priority', () => {
    it('correctly orders a list of items by priority', () => {
      const items = [
        { name: 'covered-large', coverage: 100, loc: 1000 },
        { name: 'uncovered-small', coverage: 0, loc: 50 },
        { name: 'uncovered-large', coverage: 0, loc: 800 },
        { name: 'partial-medium', coverage: 50, loc: 300 },
        { name: 'mostly-covered', coverage: 80, loc: 500 },
      ];

      const scored = items
        .map(item => ({
          ...item,
          score: calculatePriorityScore(item.coverage, item.loc),
        }))
        .sort((a, b) => b.score - a.score);

      // Expected order (highest priority first):
      // 1. uncovered-large (0%, 800 LOC) - score ≈ 6.68
      // 2. uncovered-small (0%, 50 LOC) - score ≈ 3.93
      // 3. partial-medium (50%, 300 LOC) - score ≈ 2.85
      // 4. mostly-covered (80%, 500 LOC) - score ≈ 1.24
      // 5. covered-large (100%, 1000 LOC) - score = 0

      assert.strictEqual(scored[0]!.name, 'uncovered-large');
      assert.strictEqual(scored[1]!.name, 'uncovered-small');
      assert.strictEqual(scored[2]!.name, 'partial-medium');
      assert.strictEqual(scored[3]!.name, 'mostly-covered');
      assert.strictEqual(scored[4]!.name, 'covered-large');
    });

    it('produces stable ordering for equal scores', () => {
      // Two items with same coverage and LOC should have same score
      const score1 = calculatePriorityScore(50, 200);
      const score2 = calculatePriorityScore(50, 200);

      assert.strictEqual(score1, score2);
    });
  });

  describe('real-world scenarios', () => {
    it('handles typical project file distribution', () => {
      // Simulate a real project with varying files
      const files = [
        { name: 'index.ts', coverage: 100, loc: 20 },           // Entry point, well documented
        { name: 'app.ts', coverage: 80, loc: 150 },             // Main app, mostly documented
        { name: 'utils.ts', coverage: 60, loc: 300 },           // Utilities, partially documented
        { name: 'api-client.ts', coverage: 0, loc: 450 },       // API client, undocumented
        { name: 'types.ts', coverage: 100, loc: 200 },          // Type definitions, documented
        { name: 'legacy-handler.ts', coverage: 10, loc: 800 },  // Legacy code, barely documented
      ];

      const scored = files
        .map(f => ({ ...f, score: calculatePriorityScore(f.coverage, f.loc) }))
        .sort((a, b) => b.score - a.score);

      // Legacy handler and API client should be top priorities
      const top2 = scored.slice(0, 2).map(f => f.name);
      assert.ok(top2.includes('legacy-handler.ts'),
        'legacy-handler.ts should be in top 2');
      assert.ok(top2.includes('api-client.ts'),
        'api-client.ts should be in top 2');

      // Fully covered files should be at the bottom
      const bottom2 = scored.slice(-2).map(f => f.name);
      assert.ok(bottom2.includes('index.ts') || bottom2.includes('types.ts'),
        'Fully covered files should be at bottom');
    });

    it('prioritizes critical uncovered code over trivial uncovered code', () => {
      // Main business logic file vs config file - both uncovered
      const businessLogic = calculatePriorityScore(0, 500);
      const configFile = calculatePriorityScore(0, 30);

      assert.ok(businessLogic > configFile,
        'Business logic should have higher priority than config');
    });
  });
});
