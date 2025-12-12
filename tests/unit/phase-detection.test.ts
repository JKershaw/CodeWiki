/**
 * Unit tests for phase detection logic.
 * Phase is DETECTED from wiki state, not stored.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectCurrentPhase,
  type WikiPhase,
  type PhaseDetectionContext,
} from '../../src/agents/orchestrator/phase-detection.js';

describe('Phase Detection', () => {
  /**
   * Create a minimal context for testing.
   * All values default to "nothing to do" state (continuous phase).
   */
  function createContext(overrides: Partial<PhaseDetectionContext> = {}): PhaseDetectionContext {
    return {
      wikiPages: 10,
      directoryCoverage: [],
      hasProjectOverview: true,
      hasGettingStarted: true,
      pagesWithoutLinks: 0,
      qualityAgentHasRun: true,
      unprocessedCommitsExist: false,
      ...overrides,
    };
  }

  describe('detectCurrentPhase', () => {
    describe('Bootstrap phase', () => {
      it('should return bootstrap when wiki is empty', () => {
        const ctx = createContext({ wikiPages: 0 });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'bootstrap');
      });

      it('should NOT return bootstrap when wiki has pages', () => {
        const ctx = createContext({ wikiPages: 1 });
        const phase = detectCurrentPhase(ctx);
        assert.notStrictEqual(phase, 'bootstrap');
      });
    });

    describe('Exploration phase', () => {
      it('should return exploration when directories have low coverage', () => {
        const ctx = createContext({
          wikiPages: 5,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 2, coveragePercent: 20 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'exploration');
      });

      it('should return exploration when any directory is below threshold', () => {
        const ctx = createContext({
          wikiPages: 5,
          directoryCoverage: [
            { path: 'src/well-covered', fileCount: 5, wikiMentions: 4, coveragePercent: 80 },
            { path: 'src/poorly-covered', fileCount: 10, wikiMentions: 2, coveragePercent: 20 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'exploration');
      });

      it('should NOT return exploration when all directories are above threshold', () => {
        const ctx = createContext({
          wikiPages: 5,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.notStrictEqual(phase, 'exploration');
      });

      it('should use default 50% threshold for coverage', () => {
        // Just at threshold - should NOT trigger exploration
        const ctxAtThreshold = createContext({
          wikiPages: 5,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 5, coveragePercent: 50 },
          ],
        });
        assert.notStrictEqual(detectCurrentPhase(ctxAtThreshold), 'exploration');

        // Just below threshold - SHOULD trigger exploration
        const ctxBelowThreshold = createContext({
          wikiPages: 5,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 4, coveragePercent: 49 },
          ],
        });
        assert.strictEqual(detectCurrentPhase(ctxBelowThreshold), 'exploration');
      });

      describe('lightweight detection (no directory coverage)', () => {
        it('should return exploration when exploration work is pending', () => {
          const ctx = createContext({
            wikiPages: 10,
            directoryCoverage: [], // No directory coverage available
            hasExplorationWorkPending: true,
          });
          const phase = detectCurrentPhase(ctx);
          assert.strictEqual(phase, 'exploration');
        });

        it('should return exploration when wiki has very few pages', () => {
          const ctx = createContext({
            wikiPages: 3, // Below MIN_PAGES_FOR_EXPLORATION_COMPLETE (5)
            directoryCoverage: [], // No directory coverage available
            hasExplorationWorkPending: false,
          });
          const phase = detectCurrentPhase(ctx);
          assert.strictEqual(phase, 'exploration');
        });

        it('should NOT return exploration when wiki has enough pages and no pending work', () => {
          const ctx = createContext({
            wikiPages: 10,
            directoryCoverage: [], // No directory coverage available
            hasExplorationWorkPending: false,
          });
          const phase = detectCurrentPhase(ctx);
          assert.notStrictEqual(phase, 'exploration');
        });
      });
    });

    describe('Synthesis phase', () => {
      it('should return synthesis when missing project-overview', () => {
        const ctx = createContext({
          wikiPages: 5,
          hasProjectOverview: false,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'synthesis');
      });

      it('should return synthesis when missing getting-started', () => {
        const ctx = createContext({
          wikiPages: 5,
          hasGettingStarted: false,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'synthesis');
      });

      it('should NOT return synthesis when both key pages exist', () => {
        const ctx = createContext({
          wikiPages: 5,
          hasProjectOverview: true,
          hasGettingStarted: true,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.notStrictEqual(phase, 'synthesis');
      });

      it('should only check synthesis after exploration is complete', () => {
        // Low coverage + missing overview = should be exploration, not synthesis
        const ctx = createContext({
          wikiPages: 5,
          hasProjectOverview: false,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 2, coveragePercent: 20 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'exploration');
      });
    });

    describe('Quality phase', () => {
      it('should return quality when pages have no links', () => {
        const ctx = createContext({
          wikiPages: 5,
          pagesWithoutLinks: 3,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'quality');
      });

      it('should return quality when quality agent has not run', () => {
        const ctx = createContext({
          wikiPages: 5,
          qualityAgentHasRun: false,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'quality');
      });

      it('should NOT return quality when all pages have links and quality agent has run', () => {
        const ctx = createContext({
          wikiPages: 5,
          pagesWithoutLinks: 0,
          qualityAgentHasRun: true,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.notStrictEqual(phase, 'quality');
      });

      it('should only check quality after synthesis is complete', () => {
        // Missing overview + pages without links = should be synthesis, not quality
        const ctx = createContext({
          wikiPages: 5,
          hasProjectOverview: false,
          pagesWithoutLinks: 3,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'synthesis');
      });
    });

    describe('History phase', () => {
      it('should return history when unprocessed commits exist', () => {
        const ctx = createContext({
          wikiPages: 5,
          unprocessedCommitsExist: true,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'history');
      });

      it('should NOT return history when all commits are processed', () => {
        const ctx = createContext({
          wikiPages: 5,
          unprocessedCommitsExist: false,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.notStrictEqual(phase, 'history');
      });

      it('should only check history after quality is complete', () => {
        // Pages without links + unprocessed commits = should be quality, not history
        const ctx = createContext({
          wikiPages: 5,
          pagesWithoutLinks: 3,
          unprocessedCommitsExist: true,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 6, coveragePercent: 60 },
          ],
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'quality');
      });
    });

    describe('Continuous phase', () => {
      it('should return continuous when all other phases are complete', () => {
        const ctx = createContext({
          wikiPages: 20,
          directoryCoverage: [
            { path: 'src/agents', fileCount: 10, wikiMentions: 8, coveragePercent: 80 },
          ],
          hasProjectOverview: true,
          hasGettingStarted: true,
          pagesWithoutLinks: 0,
          qualityAgentHasRun: true,
          unprocessedCommitsExist: false,
        });
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'continuous');
      });

      it('should be the default fallback phase', () => {
        const ctx = createContext();
        const phase = detectCurrentPhase(ctx);
        assert.strictEqual(phase, 'continuous');
      });
    });

    describe('Phase ordering', () => {
      it('should follow strict phase ordering (bootstrap > exploration > synthesis > quality > history > continuous)', () => {
        // Test that earlier phases take precedence

        // Bootstrap takes precedence over everything
        const bootstrapCtx = createContext({
          wikiPages: 0,
          directoryCoverage: [{ path: 'src', fileCount: 10, wikiMentions: 0, coveragePercent: 0 }],
          hasProjectOverview: false,
          pagesWithoutLinks: 5,
          unprocessedCommitsExist: true,
        });
        assert.strictEqual(detectCurrentPhase(bootstrapCtx), 'bootstrap');

        // Exploration takes precedence over synthesis
        const explorationCtx = createContext({
          wikiPages: 5,
          directoryCoverage: [{ path: 'src', fileCount: 10, wikiMentions: 2, coveragePercent: 20 }],
          hasProjectOverview: false,
          pagesWithoutLinks: 5,
          unprocessedCommitsExist: true,
        });
        assert.strictEqual(detectCurrentPhase(explorationCtx), 'exploration');

        // Synthesis takes precedence over quality
        const synthesisCtx = createContext({
          wikiPages: 5,
          directoryCoverage: [{ path: 'src', fileCount: 10, wikiMentions: 6, coveragePercent: 60 }],
          hasProjectOverview: false,
          pagesWithoutLinks: 5,
          unprocessedCommitsExist: true,
        });
        assert.strictEqual(detectCurrentPhase(synthesisCtx), 'synthesis');

        // Quality takes precedence over history
        const qualityCtx = createContext({
          wikiPages: 5,
          directoryCoverage: [{ path: 'src', fileCount: 10, wikiMentions: 6, coveragePercent: 60 }],
          hasProjectOverview: true,
          hasGettingStarted: true,
          pagesWithoutLinks: 5,
          unprocessedCommitsExist: true,
        });
        assert.strictEqual(detectCurrentPhase(qualityCtx), 'quality');

        // History takes precedence over continuous
        const historyCtx = createContext({
          wikiPages: 5,
          directoryCoverage: [{ path: 'src', fileCount: 10, wikiMentions: 6, coveragePercent: 60 }],
          hasProjectOverview: true,
          hasGettingStarted: true,
          pagesWithoutLinks: 0,
          qualityAgentHasRun: true,
          unprocessedCommitsExist: true,
        });
        assert.strictEqual(detectCurrentPhase(historyCtx), 'history');
      });
    });
  });

  describe('WikiPhase type', () => {
    it('should define all expected phases', () => {
      // This test ensures the type definition includes all expected phases
      const phases: WikiPhase[] = ['bootstrap', 'exploration', 'synthesis', 'quality', 'history', 'continuous'];
      assert.strictEqual(phases.length, 6);
    });
  });
});
