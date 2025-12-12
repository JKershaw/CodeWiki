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

    it('returns Phase 2 (Breadth) when any directory < 30% coverage', () => {
      const ctx: PhaseContext = {
        pages: 15,
        directoriesWithAnyCoverage: 5,
        lowestDirectoryCoverage: 20,
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

  describe('phase transitions', () => {
    it('progresses through phases as wiki matures', () => {
      // Simulate wiki growth
      const states: PhaseContext[] = [
        // Empty wiki
        {
          pages: 0, directoriesWithAnyCoverage: 0, lowestDirectoryCoverage: 0,
          avgConfidence: 0, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0, openFindings: 0,
        },
        // After bootstrap
        {
          pages: 5, directoriesWithAnyCoverage: 2, lowestDirectoryCoverage: 10,
          avgConfidence: 0.4, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.2, openFindings: 0,
        },
        // After skeleton
        {
          pages: 12, directoriesWithAnyCoverage: 4, lowestDirectoryCoverage: 20,
          avgConfidence: 0.5, hasProjectOverview: false, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.15, openFindings: 1,
        },
        // After breadth
        {
          pages: 30, directoriesWithAnyCoverage: 8, lowestDirectoryCoverage: 40,
          avgConfidence: 0.6, hasProjectOverview: true, hasGettingStarted: false,
          hasTestingGuide: false, hasExtensionGuide: false, lowConfidenceRatio: 0.1, openFindings: 2,
        },
        // After depth+guides
        {
          pages: 45, directoriesWithAnyCoverage: 10, lowestDirectoryCoverage: 70,
          avgConfidence: 0.72, hasProjectOverview: true, hasGettingStarted: true,
          hasTestingGuide: true, hasExtensionGuide: true, lowConfidenceRatio: 0.12, openFindings: 6,
        },
        // After polish
        {
          pages: 50, directoriesWithAnyCoverage: 10, lowestDirectoryCoverage: 85,
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
