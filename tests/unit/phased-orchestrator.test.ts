/**
 * Unit tests for PhasedOrchestrator phase detection logic.
 * Tests the phase determination based on wiki state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectPhase,
  Phase,
  type PhaseContext,
} from '../../src/agents/orchestrator/phased-orchestrator.js';

describe('PhasedOrchestrator Phase Detection', () => {
  describe('detectPhase', () => {
    it('returns Phase 0 (Reconnaissance) when pages is 0', () => {
      const ctx: PhaseContext = {
        pages: 0,
        directoriesWithAnyCoverage: 0,
        lowestDirectoryCoverage: 0,
        touchedFilesRatio: 0,
        avgConfidence: 0,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0,
        openFindings: 0,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Reconnaissance);
    });

    it('returns Phase 1 (Skeleton) when pages < 10', () => {
      const ctx: PhaseContext = {
        pages: 5,
        directoriesWithAnyCoverage: 2,
        lowestDirectoryCoverage: 30,
        touchedFilesRatio: 0.2,
        avgConfidence: 0.4,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.1,
        openFindings: 0,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Skeleton);
    });

    it('returns Phase 1 (Skeleton) when directoriesWithAnyCoverage < 3', () => {
      const ctx: PhaseContext = {
        pages: 15,
        directoriesWithAnyCoverage: 2,
        lowestDirectoryCoverage: 30,
        touchedFilesRatio: 0.5,
        avgConfidence: 0.5,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.1,
        openFindings: 0,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Skeleton);
    });

    it('returns Phase 2 (Breadth) when touchedFilesRatio < 90%', () => {
      const ctx: PhaseContext = {
        pages: 15,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 20,
        touchedFilesRatio: 0.6, // low touched ratio keeps us in Phase 2
        avgConfidence: 0.5,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.1,
        openFindings: 0,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Breadth);
    });

    it('returns Phase 2 (Breadth) when pages < 25', () => {
      const ctx: PhaseContext = {
        pages: 20,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 40,
        touchedFilesRatio: 0.95, // high touched but not enough pages
        avgConfidence: 0.5,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.1,
        openFindings: 0,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Breadth);
    });

    it('returns Phase 3 (DepthAndGuides) when key pages missing', () => {
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 6,
        lowestDirectoryCoverage: 40,
        touchedFilesRatio: 0.95, // files touched, so past Phase 2
        avgConfidence: 0.7,
        hasProjectOverview: true,
        hasGettingStarted: false, // missing
        hasTestingGuide: false,   // missing
        hasExtensionGuide: false, // missing
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(detectPhase(ctx), Phase.DepthAndGuides);
    });

    it('returns Phase 3 (DepthAndGuides) when avgConfidence < 65%', () => {
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 6,
        lowestDirectoryCoverage: 40,
        touchedFilesRatio: 0.92,
        avgConfidence: 0.6,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(detectPhase(ctx), Phase.DepthAndGuides);
    });

    it('returns Phase 4 (Polish) when lowConfidenceRatio > 10%', () => {
      const ctx: PhaseContext = {
        pages: 40,
        directoriesWithAnyCoverage: 8,
        lowestDirectoryCoverage: 60,
        touchedFilesRatio: 0.98,
        avgConfidence: 0.7,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.15,
        openFindings: 3,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Polish);
    });

    it('returns Phase 4 (Polish) when openFindings > 5', () => {
      const ctx: PhaseContext = {
        pages: 40,
        directoriesWithAnyCoverage: 8,
        lowestDirectoryCoverage: 60,
        touchedFilesRatio: 0.97,
        avgConfidence: 0.75,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.05,
        openFindings: 8,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Polish);
    });

    it('returns Phase 5 (Maintenance) when all criteria met', () => {
      const ctx: PhaseContext = {
        pages: 50,
        directoriesWithAnyCoverage: 10,
        lowestDirectoryCoverage: 80,
        touchedFilesRatio: 1.0,
        avgConfidence: 0.8,
        hasProjectOverview: true,
        hasGettingStarted: true,
        hasTestingGuide: true,
        hasExtensionGuide: true,
        lowConfidenceRatio: 0.05,
        openFindings: 3,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Maintenance);
    });
  });

  describe('touchedFilesRatio Phase 2 transition', () => {
    it('stays in Phase 2 when touchedFilesRatio < 90%', () => {
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 6,
        lowestDirectoryCoverage: 50, // high coverage by old metric
        touchedFilesRatio: 0.7, // but only 70% of files touched
        avgConfidence: 0.7,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Breadth);
    });

    it('transitions to Phase 3 when touchedFilesRatio >= 90% and pages >= 25', () => {
      const ctx: PhaseContext = {
        pages: 30,
        directoriesWithAnyCoverage: 6,
        lowestDirectoryCoverage: 20, // low by old metric, but doesn't matter
        touchedFilesRatio: 0.92, // 92% of files touched
        avgConfidence: 0.6,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(detectPhase(ctx), Phase.DepthAndGuides);
    });

    it('stays in Phase 2 when touchedFilesRatio >= 90% but pages < 25', () => {
      const ctx: PhaseContext = {
        pages: 20, // not enough pages
        directoriesWithAnyCoverage: 6,
        lowestDirectoryCoverage: 50,
        touchedFilesRatio: 0.95, // high touch ratio
        avgConfidence: 0.7,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      assert.strictEqual(detectPhase(ctx), Phase.Breadth);
    });

    it('handles edge case at exactly 90% touched threshold', () => {
      const ctx: PhaseContext = {
        pages: 25,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 40,
        touchedFilesRatio: 0.90, // exactly at threshold
        avgConfidence: 0.6,
        hasProjectOverview: false,
        hasGettingStarted: false,
        hasTestingGuide: false,
        hasExtensionGuide: false,
        lowConfidenceRatio: 0.05,
        openFindings: 2,
      };

      // At exactly 90%, we should transition to Phase 3
      assert.strictEqual(detectPhase(ctx), Phase.DepthAndGuides);
    });
  });

  describe('phase transitions', () => {
    it('progresses through phases as wiki matures', () => {
      // Simulate wiki growth
      const states: PhaseContext[] = [
        // Empty wiki
        {
          pages: 0, directoriesWithAnyCoverage: 0, lowestDirectoryCoverage: 0, touchedFilesRatio: 0,
          avgConfidence: 0, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0, openFindings: 0,
        },
        // After bootstrap
        {
          pages: 5, directoriesWithAnyCoverage: 2, lowestDirectoryCoverage: 10, touchedFilesRatio: 0.15,
          avgConfidence: 0.4, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.2, openFindings: 0,
        },
        // After skeleton (touchedFilesRatio growing but < 90%)
        {
          pages: 12, directoriesWithAnyCoverage: 4, lowestDirectoryCoverage: 20, touchedFilesRatio: 0.5,
          avgConfidence: 0.5, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.15, openFindings: 1,
        },
        // After breadth (touchedFilesRatio >= 90%, pages >= 25)
        {
          pages: 30, directoriesWithAnyCoverage: 8, lowestDirectoryCoverage: 40, touchedFilesRatio: 0.92,
          avgConfidence: 0.6, hasProjectOverview: true, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.1, openFindings: 2,
        },
        // After depth+guides
        {
          pages: 45, directoriesWithAnyCoverage: 10, lowestDirectoryCoverage: 70, touchedFilesRatio: 0.98,
          avgConfidence: 0.72, hasProjectOverview: true, hasGettingStarted: true,
          hasTestingGuide: true, hasExtensionGuide: true, lowConfidenceRatio: 0.12, openFindings: 6,
        },
        // After polish
        {
          pages: 50, directoriesWithAnyCoverage: 10, lowestDirectoryCoverage: 85, touchedFilesRatio: 1.0,
          avgConfidence: 0.82, hasProjectOverview: true, hasGettingStarted: true,
          hasTestingGuide: true, hasExtensionGuide: true, lowConfidenceRatio: 0.04, openFindings: 2,
        },
      ];

      const expectedPhases = [
        Phase.Reconnaissance,
        Phase.Skeleton,
        Phase.Breadth,
        Phase.DepthAndGuides,
        Phase.Polish,
        Phase.Maintenance,
      ];

      for (let i = 0; i < states.length; i++) {
        const actual = detectPhase(states[i]!);
        assert.strictEqual(
          actual,
          expectedPhases[i],
          `State ${i}: expected ${Phase[expectedPhases[i]!]}, got ${Phase[actual]}`
        );
      }
    });
  });
});
