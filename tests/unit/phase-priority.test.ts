/**
 * Unit tests for phase-based priority calculation.
 * Tests that work item priorities adjust based on iteration phase.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getPriorityForPhase,
  Priority,
  PRIORITY_BY_PHASE,
  type IterationPhase,
} from '../../src/domain/work-item.js';

describe('getPriorityForPhase', () => {
  describe('early phase priorities', () => {
    const phase: IterationPhase = 'early';

    it('gives exploration highest priority', () => {
      const priority = getPriorityForPhase('codebase-explorer', phase);
      assert.strictEqual(priority, PRIORITY_BY_PHASE.early.exploration);
      assert.ok(priority >= 75, 'exploration should have high priority in early phase');
    });

    it('gives synthesis elevated priority (close to exploration)', () => {
      const synthesisPriority = getPriorityForPhase('overview', phase);
      const explorationPriority = getPriorityForPhase('codebase-explorer', phase);

      assert.strictEqual(synthesisPriority, PRIORITY_BY_PHASE.early.synthesis);
      // Synthesis should be within 20 points of exploration for interleaving
      assert.ok(
        explorationPriority - synthesisPriority <= 20,
        'synthesis should be close to exploration priority for interleaving'
      );
    });

    it('gives analysis agents lower priority', () => {
      const analysisPriority = getPriorityForPhase('code-change', phase);
      const synthesisPriority = getPriorityForPhase('overview', phase);

      assert.strictEqual(analysisPriority, PRIORITY_BY_PHASE.early.analysis);
      assert.ok(
        analysisPriority < synthesisPriority,
        'analysis should have lower priority than synthesis in early phase'
      );
    });

    it('gives meta agents lowest priority', () => {
      const metaPriority = getPriorityForPhase('link', phase);
      const analysisPriority = getPriorityForPhase('code-change', phase);

      assert.strictEqual(metaPriority, PRIORITY_BY_PHASE.early.meta);
      assert.ok(
        metaPriority < analysisPriority,
        'meta should have lower priority than analysis in early phase'
      );
    });

    it('applies to all analysis agent types', () => {
      const analysisAgents = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
      for (const agent of analysisAgents) {
        const priority = getPriorityForPhase(agent, phase);
        assert.strictEqual(priority, PRIORITY_BY_PHASE.early.analysis, `${agent} should get analysis priority`);
      }
    });

    it('applies to all synthesis agent types', () => {
      const synthesisAgents = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer', 'wiki-index', 'toc'];
      for (const agent of synthesisAgents) {
        const priority = getPriorityForPhase(agent, phase);
        assert.strictEqual(priority, PRIORITY_BY_PHASE.early.synthesis, `${agent} should get synthesis priority`);
      }
    });

    it('applies to all meta agent types', () => {
      const metaAgents = ['link', 'structure', 'quality', 'consistency', 'source-verification'];
      for (const agent of metaAgents) {
        const priority = getPriorityForPhase(agent, phase);
        assert.strictEqual(priority, PRIORITY_BY_PHASE.early.meta, `${agent} should get meta priority`);
      }
    });
  });

  describe('mid phase priorities', () => {
    const phase: IterationPhase = 'mid';

    it('balances exploration and synthesis', () => {
      const explorationPriority = getPriorityForPhase('codebase-explorer', phase);
      const synthesisPriority = getPriorityForPhase('overview', phase);

      // In mid phase, priorities should be closer together
      const difference = Math.abs(explorationPriority - synthesisPriority);
      assert.ok(difference <= 15, 'exploration and synthesis should have similar priorities in mid phase');
    });

    it('raises analysis priority compared to early phase', () => {
      const midAnalysis = getPriorityForPhase('code-change', 'mid');
      const earlyAnalysis = getPriorityForPhase('code-change', 'early');

      assert.ok(
        midAnalysis >= earlyAnalysis,
        'analysis priority should increase or stay same from early to mid phase'
      );
    });

    it('raises meta priority compared to early phase', () => {
      const midMeta = getPriorityForPhase('link', 'mid');
      const earlyMeta = getPriorityForPhase('link', 'early');

      assert.ok(midMeta > earlyMeta, 'meta priority should increase from early to mid phase');
    });
  });

  describe('late phase priorities', () => {
    const phase: IterationPhase = 'late';

    it('gives synthesis highest priority', () => {
      const synthesisPriority = getPriorityForPhase('overview', phase);
      const explorationPriority = getPriorityForPhase('codebase-explorer', phase);
      const analysisPriority = getPriorityForPhase('code-change', phase);

      assert.strictEqual(synthesisPriority, PRIORITY_BY_PHASE.late.synthesis);
      assert.ok(
        synthesisPriority > explorationPriority,
        'synthesis should have higher priority than exploration in late phase'
      );
      assert.ok(
        synthesisPriority > analysisPriority,
        'synthesis should have higher priority than analysis in late phase'
      );
    });

    it('gives meta agents elevated priority', () => {
      const metaPriority = getPriorityForPhase('link', phase);
      const analysisPriority = getPriorityForPhase('code-change', phase);

      assert.strictEqual(metaPriority, PRIORITY_BY_PHASE.late.meta);
      assert.ok(
        metaPriority > analysisPriority,
        'meta should have higher priority than analysis in late phase'
      );
    });

    it('gives analysis lowest priority (backfill)', () => {
      const analysisPriority = getPriorityForPhase('code-change', phase);

      assert.strictEqual(analysisPriority, PRIORITY_BY_PHASE.late.analysis);
      assert.ok(analysisPriority <= 45, 'analysis should have low priority in late phase');
    });

    it('reduces exploration priority', () => {
      const latePriority = getPriorityForPhase('codebase-explorer', phase);
      const earlyPriority = getPriorityForPhase('codebase-explorer', 'early');

      assert.ok(
        latePriority < earlyPriority,
        'exploration priority should decrease from early to late phase'
      );
    });
  });

  describe('undefined phase (backwards compatibility)', () => {
    it('returns balanced defaults when phase is undefined', () => {
      const explorationPriority = getPriorityForPhase('codebase-explorer', undefined);
      const synthesisPriority = getPriorityForPhase('overview', undefined);
      const analysisPriority = getPriorityForPhase('code-change', undefined);
      const metaPriority = getPriorityForPhase('link', undefined);

      // Should return reasonable defaults
      assert.ok(explorationPriority > 0, 'should return valid priority');
      assert.ok(synthesisPriority > 0, 'should return valid priority');
      assert.ok(analysisPriority > 0, 'should return valid priority');
      assert.ok(metaPriority > 0, 'should return valid priority');
    });
  });

  describe('special agent types', () => {
    it('gives bootstrap highest priority regardless of phase', () => {
      for (const phase of ['early', 'mid', 'late'] as IterationPhase[]) {
        const priority = getPriorityForPhase('bootstrap', phase);
        assert.strictEqual(priority, Priority.USER_REQUEST, `bootstrap should always get USER_REQUEST priority`);
      }
    });

    it('gives wiki-editor high priority regardless of phase', () => {
      for (const phase of ['early', 'mid', 'late'] as IterationPhase[]) {
        const priority = getPriorityForPhase('wiki-editor', phase);
        assert.strictEqual(priority, Priority.USER_REQUEST - 1, `wiki-editor should always get high priority`);
      }
    });

    it('gives consolidation LOW_CONFIDENCE priority regardless of phase', () => {
      for (const phase of ['early', 'mid', 'late'] as IterationPhase[]) {
        const priority = getPriorityForPhase('consolidation', phase);
        assert.strictEqual(priority, Priority.LOW_CONFIDENCE, `consolidation should always get LOW_CONFIDENCE priority`);
      }
    });

    it('returns reasonable fallback for unknown agent types', () => {
      const priority = getPriorityForPhase('unknown-agent' as any, 'mid');
      assert.ok(priority > 0, 'should return a valid priority for unknown agents');
      assert.ok(priority <= 100, 'should not exceed max priority');
    });
  });

  describe('priority ordering invariants', () => {
    it('USER_REQUEST always highest', () => {
      for (const phase of ['early', 'mid', 'late'] as IterationPhase[]) {
        const bootstrapPriority = getPriorityForPhase('bootstrap', phase);
        const explorationPriority = getPriorityForPhase('codebase-explorer', phase);
        const synthesisPriority = getPriorityForPhase('overview', phase);

        assert.ok(bootstrapPriority > explorationPriority, 'bootstrap should beat exploration');
        assert.ok(bootstrapPriority > synthesisPriority, 'bootstrap should beat synthesis');
      }
    });

    it('all priorities are within valid range (1-100)', () => {
      const agents = [
        'codebase-explorer', 'code-change', 'narrative', 'security',
        'overview', 'project-overview', 'getting-started',
        'link', 'structure', 'quality', 'bootstrap', 'wiki-editor'
      ];
      const phases: (IterationPhase | undefined)[] = ['early', 'mid', 'late', undefined];

      for (const agent of agents) {
        for (const phase of phases) {
          const priority = getPriorityForPhase(agent, phase);
          assert.ok(priority >= 1 && priority <= 100, `${agent} in ${phase} phase should have priority 1-100, got ${priority}`);
        }
      }
    });
  });
});
