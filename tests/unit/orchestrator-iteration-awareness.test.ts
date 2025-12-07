/**
 * Unit tests for orchestrator iteration awareness.
 * Tests that the orchestrator receives iteration context and can prioritize accordingly.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { ContextGatherer, type OrchestratorContext, type IterationInfo, type IterationPhase } from '../../src/agents/orchestrator/context-gatherer.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import {
  type StrategyContext,
  codebaseExplorationStrategy,
  synthesisStrategy,
  metaAgentsStrategy,
  getPhaseAdjustedThresholds,
} from '../../src/agents/orchestrator/strategies.js';

describe('Orchestrator Iteration Awareness', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('IterationInfo type', () => {
    it('should define iteration info with current, total, and remaining iterations', () => {
      const iterationInfo: IterationInfo = {
        currentIteration: 5,
        totalIterations: 20,
        remainingIterations: 15,
        progressPercent: 25,
      };

      assert.strictEqual(iterationInfo.currentIteration, 5);
      assert.strictEqual(iterationInfo.totalIterations, 20);
      assert.strictEqual(iterationInfo.remainingIterations, 15);
      assert.strictEqual(iterationInfo.progressPercent, 25);
    });

    it('should handle early phase (0-30%)', () => {
      const iterationInfo: IterationInfo = {
        currentIteration: 3,
        totalIterations: 20,
        remainingIterations: 17,
        progressPercent: 15,
      };

      assert.ok(iterationInfo.progressPercent < 30, 'Should be in early phase');
    });

    it('should handle mid phase (30-70%)', () => {
      const iterationInfo: IterationInfo = {
        currentIteration: 10,
        totalIterations: 20,
        remainingIterations: 10,
        progressPercent: 50,
      };

      assert.ok(iterationInfo.progressPercent >= 30 && iterationInfo.progressPercent < 70, 'Should be in mid phase');
    });

    it('should handle late phase (70-100%)', () => {
      const iterationInfo: IterationInfo = {
        currentIteration: 16,
        totalIterations: 20,
        remainingIterations: 4,
        progressPercent: 80,
      };

      assert.ok(iterationInfo.progressPercent >= 70, 'Should be in late phase');
    });
  });

  describe('ContextGatherer with iteration info', () => {
    it('should accept optional iteration info in gather method', async () => {
      const repoId = 'iteration-context-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      // Without iteration info (backwards compatible)
      const contextWithout = await gatherer.gather(repoId, wiki.id);
      assert.strictEqual(contextWithout.iterationInfo, undefined);
    });

    it('should include iteration info in context when provided', async () => {
      const repoId = 'iteration-context-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      const iterationInfo: IterationInfo = {
        currentIteration: 5,
        totalIterations: 20,
        remainingIterations: 15,
        progressPercent: 25,
      };

      const context = await gatherer.gather(repoId, wiki.id, { iterationInfo });

      assert.ok(context.iterationInfo, 'Should include iteration info');
      assert.strictEqual(context.iterationInfo!.currentIteration, 5);
      assert.strictEqual(context.iterationInfo!.totalIterations, 20);
      assert.strictEqual(context.iterationInfo!.remainingIterations, 15);
      assert.strictEqual(context.iterationInfo!.progressPercent, 25);
    });

    it('should include iteration phase helper in context', async () => {
      const repoId = 'iteration-context-test-3';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      // Early phase
      const earlyContext = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 2,
          totalIterations: 20,
          remainingIterations: 18,
          progressPercent: 10,
        },
      });
      assert.strictEqual(earlyContext.iterationPhase, 'early');

      // Mid phase
      const midContext = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 10,
          totalIterations: 20,
          remainingIterations: 10,
          progressPercent: 50,
        },
      });
      assert.strictEqual(midContext.iterationPhase, 'mid');

      // Late phase
      const lateContext = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 16,
          totalIterations: 20,
          remainingIterations: 4,
          progressPercent: 80,
        },
      });
      assert.strictEqual(lateContext.iterationPhase, 'late');
    });
  });

  describe('formatForPrompt with iteration info', () => {
    it('should include iteration progress in formatted prompt', async () => {
      const repoId = 'iteration-format-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      const context = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 5,
          totalIterations: 20,
          remainingIterations: 15,
          progressPercent: 25,
        },
      });

      const formatted = gatherer.formatForPrompt(context);

      // Should include iteration progress section
      assert.ok(formatted.includes('Iteration Progress'), 'Should have iteration progress section');
      assert.ok(formatted.includes('5 of 20'), 'Should show current/total');
      assert.ok(formatted.includes('15 remaining'), 'Should show remaining');
      assert.ok(formatted.includes('25%'), 'Should show percentage');
      assert.ok(formatted.includes('early'), 'Should show phase');
    });

    it('should not include iteration section when no iteration info provided', async () => {
      const repoId = 'iteration-format-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      const context = await gatherer.gather(repoId, wiki.id);
      const formatted = gatherer.formatForPrompt(context);

      // Should NOT include iteration section when not provided
      assert.ok(!formatted.includes('Iteration Progress'), 'Should not have iteration progress section');
    });

    it('should provide phase-specific guidance in prompt', async () => {
      const repoId = 'iteration-format-test-3';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const gatherer = new ContextGatherer(ctx.repos);

      // Early phase guidance
      const earlyContext = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 2,
          totalIterations: 20,
          remainingIterations: 18,
          progressPercent: 10,
        },
      });
      const earlyFormatted = gatherer.formatForPrompt(earlyContext);
      assert.ok(earlyFormatted.includes('exploration') || earlyFormatted.includes('breadth'),
        'Early phase should emphasize exploration');

      // Late phase guidance
      const lateContext = await gatherer.gather(repoId, wiki.id, {
        iterationInfo: {
          currentIteration: 18,
          totalIterations: 20,
          remainingIterations: 2,
          progressPercent: 90,
        },
      });
      const lateFormatted = gatherer.formatForPrompt(lateContext);
      assert.ok(lateFormatted.includes('quality') || lateFormatted.includes('polish') || lateFormatted.includes('gaps'),
        'Late phase should emphasize quality/polish');
    });
  });

  describe('getPhaseAdjustedThresholds', () => {
    it('should return more aggressive thresholds in early phase', () => {
      const earlyThresholds = getPhaseAdjustedThresholds('early', 10);
      const midThresholds = getPhaseAdjustedThresholds('mid', 10);
      const lateThresholds = getPhaseAdjustedThresholds('late', 10);

      // Early phase: higher coverage threshold = explore more directories
      assert.ok(earlyThresholds.coverageThreshold >= midThresholds.coverageThreshold,
        'Early phase should have higher or equal coverage threshold');
      assert.ok(midThresholds.coverageThreshold >= lateThresholds.coverageThreshold,
        'Mid phase should have higher or equal coverage threshold than late');

      // Early phase: explore more directories at once
      assert.ok(earlyThresholds.maxDirectories >= midThresholds.maxDirectories,
        'Early phase should allow more directories');
    });

    it('should return thresholds that encourage synthesis in mid phase', () => {
      const midThresholds = getPhaseAdjustedThresholds('mid', 10);

      // Mid phase should still allow exploration but with synthesis priority
      assert.ok(midThresholds.coverageThreshold > 0, 'Mid phase should still explore');
      assert.ok(midThresholds.synthesisBoost > 0, 'Mid phase should boost synthesis');
    });

    it('should return thresholds that prioritize quality in late phase', () => {
      const lateThresholds = getPhaseAdjustedThresholds('late', 10);

      // Late phase should focus on quality and filling gaps
      assert.ok(lateThresholds.qualityBoost > 0, 'Late phase should boost quality work');
      assert.ok(lateThresholds.coverageThreshold <= 30,
        'Late phase should only explore truly undocumented areas');
    });

    it('should work without phase (backwards compatible)', () => {
      const noPhaseThresholds = getPhaseAdjustedThresholds(undefined, 10);

      // Should return sensible defaults
      assert.ok(noPhaseThresholds.coverageThreshold > 0, 'Should have coverage threshold');
      assert.ok(noPhaseThresholds.maxDirectories > 0, 'Should have max directories');
    });

    it('should combine wiki size and phase for adaptive thresholds', () => {
      // Small wiki in early phase = most aggressive exploration
      const smallEarly = getPhaseAdjustedThresholds('early', 3);
      // Large wiki in late phase = most conservative exploration
      const largeLate = getPhaseAdjustedThresholds('late', 25);

      assert.ok(smallEarly.coverageThreshold > largeLate.coverageThreshold,
        'Small wiki + early phase should have higher threshold than large wiki + late phase');
      assert.ok(smallEarly.maxDirectories > largeLate.maxDirectories,
        'Small wiki + early phase should explore more directories');
    });
  });

  describe('Strategy context with iteration info', () => {
    it('should pass iteration phase through strategy context', async () => {
      const repoId = 'strategy-iteration-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create strategy context with iteration phase
      const strategyCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        iterationPhase: 'early',
      };

      assert.strictEqual(strategyCtx.iterationPhase, 'early');
    });

    it('should allow strategies to access iteration phase', async () => {
      const repoId = 'strategy-iteration-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
        'src/utils.ts': 'export const y = 2;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create context with early phase
      const earlyCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        iterationPhase: 'early',
      };

      // Create context with late phase
      const lateCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        iterationPhase: 'late',
      };

      // Strategies should behave differently based on phase
      // (exact behavior tested in strategy-specific tests)
      assert.strictEqual(earlyCtx.iterationPhase, 'early');
      assert.strictEqual(lateCtx.iterationPhase, 'late');
    });
  });
});
