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
import { createWorkItem, Priority } from '../../src/domain/work-item.js';
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
    priority: Priority.RECENT_COMMIT,
    target: { type: 'commit', commitId },
  });
}

function createWikiWorkItem(agentType: string, repoId = 'test-repo'): WorkItem {
  return createWorkItem({
    id: uuid(),
    repoId,
    agentType,
    priority: Priority.META_AGENT,
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

  describe('Rule 2: Meta agents blocked by analysis work', () => {
    it('skips meta agents when analysis work is pending', () => {
      const codeChange = createCommitWorkItem('code-change', 'commit-1');
      const link = createWikiWorkItem('link');

      const result = selectItemsForBatch([codeChange, link], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 1);
      assert.strictEqual(result.itemsToClaim[0]!.agentType, 'code-change');
      assert.strictEqual(result.skippedReasons.get(link.id), 'meta_agent_blocked_by_analysis');
    });

    it('allows meta agents when no analysis work is pending', () => {
      const link = createWikiWorkItem('link');
      const structure = createWikiWorkItem('structure');

      const result = selectItemsForBatch([link, structure], 10, new Set());

      assert.strictEqual(result.itemsToClaim.length, 2);
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'link'));
      assert.ok(result.itemsToClaim.some(i => i.agentType === 'structure'));
    });
  });

  describe('Rule 3: Code-change prerequisite', () => {
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

  describe('Rule 4: Parallel execution of different agents on same commit', () => {
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
  });
});
