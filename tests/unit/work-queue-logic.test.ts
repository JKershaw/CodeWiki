/**
 * Unit tests for work queue batch selection logic.
 * Tests the pure business logic in selectItemsForBatch().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  selectItemsForBatch,
  ANALYSIS_AGENTS,
  META_AGENTS,
} from '../../src/domain/work-queue-logic.js';
import { createWorkItem } from '../../src/domain/work-item.js';
import type { WorkItem } from '../../src/domain/work-item.js';

function createCommitWorkItem(
  agentType: string,
  commitId: string,
  repoId = 'test-repo'
): WorkItem {
  return createWorkItem({
    id: uuid(),
    repoId,
    agentType,
    target: { type: 'commit', commitId },
  });
}

function createWikiWorkItem(agentType: string, repoId = 'test-repo'): WorkItem {
  return createWorkItem({
    id: uuid(),
    repoId,
    agentType,
    target: { type: 'wiki' },
  });
}

describe('selectItemsForBatch', () => {
  describe('Rule 1: Bootstrap runs alone', () => {
    it('returns only bootstrap when bootstrap is pending', () => {
      const bootstrap = createWikiWorkItem('bootstrap');
      const codeChange = createCommitWorkItem('code-change', 'commit-1');

      const result = selectItemsForBatch([bootstrap, codeChange], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'bootstrap');
    });

    it('finds bootstrap anywhere in the list', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');
      const bootstrap = createWikiWorkItem('bootstrap');

      const result = selectItemsForBatch([codeChange, bootstrap], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'bootstrap');
    });
  });

  describe('Meta agents can be claimed alongside analysis work', () => {
    it('claims meta agents even when analysis work is pending', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');
      const link = createWikiWorkItem('link');

      const result = selectItemsForBatch([codeChange, link], 10, new Set());

      // Both should be claimed - no gating
      assert.strictEqual(result.itemsToClaim.length, 2);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'code-change'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'link'));
      // No skipped reasons for meta agents
      assert.strictEqual(result.skippedReasons.has(link.id), false);
    });

    it('claims multiple meta agents alongside analysis work', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');
      const link = createWikiWorkItem('link');
      const structure = createWikiWorkItem('structure');
      const quality = createWikiWorkItem('quality');

      const result = selectItemsForBatch([codeChange, link, structure, quality], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 4);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'code-change'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'link'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'structure'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'quality'));
    });

    it('allows meta agents when no analysis work is pending', () => {
      const link = createWikiWorkItem('link');
      const structure = createWikiWorkItem('structure');

      const result = selectItemsForBatch([link, structure], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 2);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'link'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'structure'));
    });

    it('preserves input order (FIFO)', () => {
      // Items are processed in the order they appear (FIFO)
      const items = [
        createCommitWorkItem('code-change', 'commit-1'),
        createWikiWorkItem('link'),
      ];

      const result = selectItemsForBatch(items, 10, new Set());

      // Both claimed, order preserved from input (FIFO)
      assert.strictEqual(result.itemsToClaim.length, 2);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'code-change');
      assert.strictEqual(result.itemsToClaim[1]!.agentType, 'link');
    });

    it('claims all meta agent types without blocking', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');
      const metaItems = META_AGENTS.map(agentType => createWikiWorkItem(agentType));

      const result = selectItemsForBatch([codeChange, ...metaItems], 20, new Set());

      // All should be claimed
      assert.strictEqual(result.itemsToClaim.length, 1 + META_AGENTS.length);
      for (const agentType of META_AGENTS) {
        assert.ok(
          result.itemsToClaim.some(i => i.agentType === agentType),
          `${agentType} should be claimed`
        );
      }
    });
  });

  describe('Rule 2: Code-change prerequisite', () => {
    it('skips analysis agents on commits not processed by code-change', () => {
      const narrative = createCommitWorkItem('narrative', 'commit-1');

      const result = selectItemsForBatch([narrative], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 0);
      assert.strictEqual(result.skippedReasons.get(narrative.id), 'waiting_for_code_change');
    });

    it('allows analysis agents on commits processed by code-change', () => {
      const narrative = createCommitWorkItem('narrative', 'commit-1');
      const processedCommits = new Set(['commit-1']);

      const result = selectItemsForBatch([narrative], 10, processedCommits);

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'narrative');
    });

    it('always allows code-change agent regardless of processed commits', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');

      const result = selectItemsForBatch([codeChange], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'code-change');
    });
  });

  describe('Rule 3: Parallel execution of different agents on same commit', () => {
    it('allows different agents to process the same commit in parallel', () => {
      const commitId = 'commit-1';
      const narrative = createCommitWorkItem('narrative', commitId);
      const security = createCommitWorkItem('security', commitId);
      const technicalDebt = createCommitWorkItem('technical-debt', commitId);
      const processedCommits = new Set([commitId]);

      const result = selectItemsForBatch(
        [narrative, security, technicalDebt],
        10,
        processedCommits
      );

      assert.strictEqual(result.itemsToClaim.length, 3);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'narrative'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'security'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'technical-debt'));
    });

    it('prevents duplicate (commit, agentType) pairs in same batch', () => {
      const commitId = 'commit-1';
      const narrative1 = createCommitWorkItem('narrative', commitId);
      const narrative2 = createCommitWorkItem('narrative', commitId);
      const processedCommits = new Set([commitId]);

      const result = selectItemsForBatch(
        [narrative1, narrative2],
        10,
        processedCommits
      );

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(
        result.skippedReasons.get(narrative2.id),
        'commit_agent_pair_already_claimed_in_batch'
      );
    });

    it('allows same agent type on different commits', () => {
      const narrative1 = createCommitWorkItem('narrative', 'commit-1');
      const narrative2 = createCommitWorkItem('narrative', 'commit-2');
      const processedCommits = new Set(['commit-1', 'commit-2']);

      const result = selectItemsForBatch(
        [narrative1, narrative2],
        10,
        processedCommits
      );

      assert.strictEqual(result.itemsToClaim.length, 2);
    });
  });

  describe('Batch size limits', () => {
    it('respects maxItems limit', () => {
      const items = [
        createCommitWorkItem('code-change', 'commit-1'),
        createCommitWorkItem('code-change', 'commit-2'),
        createCommitWorkItem('code-change', 'commit-3'),
      ];

      const result = selectItemsForBatch(items, 2, new Set());

      assert.strictEqual(result.itemsToClaim.length, 2);
    });

    it('returns empty array for empty input', () => {
      const result = selectItemsForBatch([], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 0);
      assert.strictEqual(result.skippedReasons.size, 0);
    });
  });

  describe('Mixed scenarios', () => {
    it('handles complex batch with multiple commits and agents', () => {
      const processedCommits = new Set(['commit-1', 'commit-2']);

      const items = [
        createCommitWorkItem('code-change', 'commit-3'), // New commit, code-change allowed
        createCommitWorkItem('narrative', 'commit-1'),   // Processed, allowed
        createCommitWorkItem('security', 'commit-1'),    // Processed, same commit different agent, allowed
        createCommitWorkItem('narrative', 'commit-2'),   // Processed, allowed
        createCommitWorkItem('technical-debt', 'commit-3'), // Not processed, blocked
      ];

      const result = selectItemsForBatch(items, 10, processedCommits);

      assert.strictEqual(result.itemsToClaim.length, 4);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'code-change'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'security'));

      // technical-debt on commit-3 should be blocked (waiting for code-change)
      const blocked = items.find(i => i.agentType === 'technical-debt');
      assert.strictEqual(result.skippedReasons.get(blocked!.id), 'waiting_for_code_change');
    });

    it('handles realistic scenario with analysis and meta agents together', () => {
      const processedCommits = new Set(['commit-1']);

      const items = [
        // Analysis agents
        createCommitWorkItem('code-change', 'commit-2'),  // New commit
        createCommitWorkItem('narrative', 'commit-1'),    // Processed commit
        createCommitWorkItem('security', 'commit-1'),     // Processed commit
        // Meta agents - should all be claimed alongside analysis work
        createWikiWorkItem('link'),
        createWikiWorkItem('structure'),
        createWikiWorkItem('quality'),
      ];

      const result = selectItemsForBatch(items, 10, processedCommits);

      // All 6 items should be claimed
      assert.strictEqual(result.itemsToClaim.length, 6);

      // Verify analysis agents claimed
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'code-change'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'narrative'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'security'));

      // Verify meta agents claimed (the key fix being tested)
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'link'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'structure'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'quality'));

      // No meta agents should be skipped
      assert.strictEqual(result.skippedReasons.size, 0);
    });

    it('link agent works in typical wiki generation scenario', () => {
      // Simulate typical scenario: many analysis items pending, link work also pending
      const processedCommits = new Set(['commit-1', 'commit-2', 'commit-3']);

      const items = [
        // Many analysis agents processing commits
        createCommitWorkItem('narrative', 'commit-1'),
        createCommitWorkItem('security', 'commit-1'),
        createCommitWorkItem('technical-debt', 'commit-2'),
        createCommitWorkItem('pattern', 'commit-3'),
        createCommitWorkItem('dependency', 'commit-3'),
        // Link agent should NOT be blocked
        createWikiWorkItem('link'),
      ];

      const result = selectItemsForBatch(items, 10, processedCommits);

      // All items should be claimed
      assert.strictEqual(result.itemsToClaim.length, 6);
      assert.ok(
        result.itemsToClaim.some(i => i.agentType === 'link'),
        'link agent must be claimed alongside analysis work'
      );
    });
  });
});
