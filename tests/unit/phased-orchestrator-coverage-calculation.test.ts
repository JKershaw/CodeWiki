/**
 * Unit tests for PhasedOrchestrator coverage calculation.
 *
 * Tests that lowestDirectoryCoverage correctly includes fully-undocumented
 * directories (ratio = 1.0) in the minimum calculation.
 *
 * TDD: These tests were written to expose a bug where directories with
 * undocumentedRatio === 1.0 were excluded from the minimum calculation,
 * causing Phase 2 to potentially exit prematurely or get stuck.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { Phase, detectPhase, calculateLowestDirectoryCoverage } from '../../src/agents/orchestrator/phased-orchestrator.js';
import type { PhaseContext } from '../../src/agents/orchestrator/phased-orchestrator.js';
import type { UndocumentedDirectory } from '../../src/agents/orchestrator/context-gatherer.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

describe('PhasedOrchestrator Coverage Calculation', () => {
  describe('calculateLowestDirectoryCoverage', () => {
    it('should include directories with ratio 1.0 (0% coverage) in minimum calculation', () => {
      // This test exposes the bug where directories with ratio 1.0 were excluded
      // from the lowestDirectoryCoverage calculation.
      //
      // Scenario:
      // - Dir A: ratio 0.5 = 50% coverage
      // - Dir B: ratio 1.0 = 0% coverage (fully undocumented)
      //
      // Bug behavior: lowestCoverage = 50% (excludes Dir B)
      // Correct behavior: lowestCoverage = 0% (includes Dir B)

      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
        { path: 'src/services', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const lowestCoverage = calculateLowestDirectoryCoverage(undocumentedDirectories, 30);

      // The lowest coverage should be 0% (from Dir B), not 50%
      assert.strictEqual(lowestCoverage, 0, 'Lowest coverage should include 0% directories');
    });

    it('should keep Phase 2 when any directory has 0% coverage', () => {
      // Even if some directories are well-documented, if ANY directory
      // has 0% coverage, we should stay in Phase 2 (Breadth)

      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 0, // One directory is fully undocumented
        avgConfidence: 0.7,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      // Should be in Phase 2 because lowestDirectoryCoverage < 30
      assert.strictEqual(detectPhase(ctx), Phase.Breadth);
    });

    it('should progress to Phase 3 only when ALL directories have >= 30% coverage', () => {
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 35, // All directories have at least 35% coverage
        avgConfidence: 0.6, // Below 65%, so Phase 3
        hasProjectOverview: true,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.1,
        openFindings: 3,
      };

      // Should be in Phase 3 (not Phase 2) because all dirs >= 30%
      assert.strictEqual(detectPhase(ctx), Phase.DepthAndGuides);
    });

    it('should handle case where all directories are fully undocumented', () => {
      // When ALL directories are at ratio 1.0, lowestCoverage should be 0%
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
        { path: 'src/utils', totalFiles: 8, undocumentedCount: 8, undocumentedRatio: 1.0 },
      ];

      const lowestCoverage = calculateLowestDirectoryCoverage(undocumentedDirectories, 30);

      assert.strictEqual(lowestCoverage, 0, 'All fully undocumented dirs should give 0% lowest coverage');
    });

    it('should handle empty undocumentedDirectories array', () => {
      // When there are no undocumented directories, we should use the fallback
      const undocumentedDirectories: UndocumentedDirectory[] = [];

      // The fallback should be page-based estimate: min(wikiPages * 2, 80)
      const lowestCoverage = calculateLowestDirectoryCoverage(undocumentedDirectories, 25);

      assert.strictEqual(lowestCoverage, 50, 'Fallback coverage for 25 pages should be 50%');
    });

    it('should correctly count directoriesWithAnyCoverage', () => {
      // Directories with ratio < 1.0 have SOME coverage
      // Directories with ratio = 1.0 have ZERO coverage
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },  // 50% coverage
        { path: 'src/services', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 }, // 0% coverage
        { path: 'src/utils', totalFiles: 10, undocumentedCount: 3, undocumentedRatio: 0.3 },    // 70% coverage
      ];

      // Only dirs with ratio < 1.0 have ANY coverage
      const dirsWithAnyCoverage = undocumentedDirectories.filter(d => d.undocumentedRatio < 1.0).length;

      assert.strictEqual(dirsWithAnyCoverage, 2, 'Should count 2 directories with some coverage');
    });
  });

  describe('Phase 2 exit conditions regression tests', () => {
    it('should NOT exit Phase 2 when hidden directories have 0% coverage', () => {
      // This is the main regression test for the bug:
      // If lowestDirectoryCoverage calculation excludes ratio=1.0 dirs,
      // it might show lowestCoverage >= 30% when there are actually
      // directories at 0% coverage.

      // Simulated scenario:
      // - 3 directories documented at 40% coverage
      // - 2 directories completely undocumented (0% coverage)
      // Bug: lowestCoverage = 40% (exits Phase 2)
      // Correct: lowestCoverage = 0% (stays in Phase 2)

      const undocumentedDirectories: UndocumentedDirectory[] = [
        // Partially documented
        { path: 'src/dir1', totalFiles: 10, undocumentedCount: 6, undocumentedRatio: 0.6 }, // 40%
        { path: 'src/dir2', totalFiles: 10, undocumentedCount: 6, undocumentedRatio: 0.6 }, // 40%
        { path: 'src/dir3', totalFiles: 10, undocumentedCount: 6, undocumentedRatio: 0.6 }, // 40%
        // Fully undocumented
        { path: 'src/dir4', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 }, // 0%
        { path: 'src/dir5', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 }, // 0%
      ];

      // Use the exported function to calculate
      const lowestCoverage = calculateLowestDirectoryCoverage(undocumentedDirectories, 30);

      // The calculation should include 0% directories
      assert.strictEqual(lowestCoverage, 0, 'Calculation should include 0% directories, not just partial ones');

      // The PhaseContext with this correct lowestCoverage should stay in Phase 2
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 3,
        lowestDirectoryCoverage: lowestCoverage, // Should be 0, not 40
        avgConfidence: 0.7,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(
        detectPhase(ctx),
        Phase.Breadth,
        'Should stay in Phase 2 when ANY directory is at 0% coverage'
      );
    });

    it('should demonstrate the bug when using old calculation logic', () => {
      // This test explicitly shows what the BUG does - filter out ratio=1.0 dirs
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/dir1', totalFiles: 10, undocumentedCount: 6, undocumentedRatio: 0.6 }, // 40%
        { path: 'src/dir2', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 }, // 0%
      ];

      // OLD BUGGY LOGIC (for comparison):
      const documentedDirs = undocumentedDirectories.filter(d => d.undocumentedRatio < 1.0);
      const buggyLowestCoverage = documentedDirs.length > 0
        ? Math.min(...documentedDirs.map(d => (1 - d.undocumentedRatio) * 100))
        : 80;

      // The bug incorrectly shows 40% (excludes the 0% directory)
      assert.strictEqual(buggyLowestCoverage, 40, 'Buggy logic incorrectly shows 40%');

      // NEW CORRECT LOGIC:
      const correctLowestCoverage = calculateLowestDirectoryCoverage(undocumentedDirectories, 30);

      // The fix should show 0%
      assert.strictEqual(correctLowestCoverage, 0, 'Fixed logic correctly shows 0%');
    });
  });
});
