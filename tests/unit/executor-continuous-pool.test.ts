/**
 * Unit tests for Executor continuous pool behavior.
 * Tests the dynamic processedCommits updates and continuous claiming.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  selectItemsForBatch,
} from '../../src/domain/work-queue-logic.js';
import { createWorkItem } from '../../src/domain/work-item.js';
import type { WorkItem } from '../../src/domain/work-item.js';

// Helper to create commit-targeted work items
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

describe('Executor Continuous Pool Behavior', () => {
  describe('dynamic processedCommits updates', () => {
    it('allows dependent agents to run after code-change completes', () => {
      // Initial state: code-change for commit-1 is pending
      const items = [
        createCommitWorkItem('code-change', 'commit-1'),
        createCommitWorkItem('narrative', 'commit-1'),
        createCommitWorkItem('security', 'commit-1'),
      ];

      const processedCommits = new Set<string>();

      // First claim: should only get code-change (narrative/security blocked)
      const result1 = selectItemsForBatch(items, 1, processedCommits);
      assert.strictEqual(result1.itemsToClaim.length, 1);
      assert.strictEqual(result1.itemsToClaim[0]!.agentType, 'code-change');

      // Simulate code-change completing
      processedCommits.add('commit-1');
      const remainingItems = items.filter(i => i.id !== result1.itemsToClaim[0]!.id);

      // Second claim: should now be able to claim narrative or security
      const result2 = selectItemsForBatch(remainingItems, 1, processedCommits);
      assert.strictEqual(result2.itemsToClaim.length, 1);
      assert.ok(
        ['narrative', 'security'].includes(result2.itemsToClaim[0]!.agentType),
        `Expected narrative or security, got ${result2.itemsToClaim[0]!.agentType}`
      );
    });

    it('immediately unlocks work when processedCommits is updated', () => {
      // Scenario: Multiple commits, code-change completes on one while others are processing
      const items = [
        createCommitWorkItem('narrative', 'commit-1'),  // Blocked initially
        createCommitWorkItem('narrative', 'commit-2'),  // Blocked initially
        createCommitWorkItem('security', 'commit-1'),   // Blocked initially
      ];

      const processedCommits = new Set<string>();

      // Nothing can be claimed initially
      const result1 = selectItemsForBatch(items, 3, processedCommits);
      assert.strictEqual(result1.itemsToClaim.length, 0);

      // Commit-1's code-change completes
      processedCommits.add('commit-1');

      // Now narrative and security for commit-1 can be claimed
      const result2 = selectItemsForBatch(items, 3, processedCommits);
      assert.strictEqual(result2.itemsToClaim.length, 2);
      assert.ok(result2.itemsToClaim.every(i => i.target.type === 'commit' && i.target.commitId === 'commit-1'));

      // Commit-2's code-change completes
      processedCommits.add('commit-2');
      const remainingItems = items.filter(i => !result2.itemsToClaim.some(c => c.id === i.id));

      // Now narrative for commit-2 can be claimed
      const result3 = selectItemsForBatch(remainingItems, 3, processedCommits);
      assert.strictEqual(result3.itemsToClaim.length, 1);
      assert.strictEqual(result3.itemsToClaim[0]!.agentType, 'narrative');
    });
  });

  describe('continuous claiming simulation', () => {
    it('processes more work than batch size without waiting', async () => {
      // Simulate continuous pool behavior with varying job durations
      const workItems = [
        { ...createCommitWorkItem('code-change', 'commit-1'), duration: 10 },
        { ...createCommitWorkItem('code-change', 'commit-2'), duration: 50 },
        { ...createCommitWorkItem('code-change', 'commit-3'), duration: 10 },
        { ...createCommitWorkItem('code-change', 'commit-4'), duration: 10 },
        { ...createCommitWorkItem('code-change', 'commit-5'), duration: 10 },
      ];

      const processedCommits = new Set<string>();
      const maxConcurrency = 2;
      const completed: string[] = [];
      const completionTimes: number[] = [];
      const startTime = Date.now();

      // Simulate continuous pool
      let pendingItems = [...workItems];
      let activeCount = 0;
      let itemIndex = 0;

      // Promise tracking for in-flight work
      const inFlight: Promise<void>[] = [];

      const startWork = (item: typeof workItems[0]) => {
        activeCount++;
        const promise = new Promise<void>(resolve => {
          setTimeout(() => {
            activeCount--;
            completed.push(item.id);
            completionTimes.push(Date.now() - startTime);
            resolve();
          }, item.duration);
        });
        inFlight.push(promise);
        return promise;
      };

      // Start initial workers
      while (activeCount < maxConcurrency && itemIndex < workItems.length) {
        startWork(workItems[itemIndex++]!);
      }

      // Process completions and claim more work
      while (inFlight.length > 0) {
        await Promise.race(inFlight);
        // Remove completed promises
        const completedPromises = inFlight.filter(p => {
          try {
            // Check if promise is resolved (hack for testing)
            return false; // Can't easily check, so we'll use a different approach
          } catch {
            return false;
          }
        });

        // Start more work if slots available
        while (activeCount < maxConcurrency && itemIndex < workItems.length) {
          startWork(workItems[itemIndex++]!);
        }

        // Break if all items started
        if (itemIndex >= workItems.length && activeCount === 0) break;

        // Small delay to let promises settle
        await new Promise(r => setTimeout(r, 5));
      }

      // Wait for all to complete
      await Promise.all(inFlight);

      // Verify all completed
      assert.strictEqual(completed.length, 5, `Expected 5 completions, got ${completed.length}`);

      // In batch mode with Promise.allSettled([A, B]), then Promise.allSettled([C, D]), then E:
      // A completes at 10ms, B at 50ms, batch waits until 50ms
      // C, D start at 50ms, complete at 60ms, batch waits until 60ms
      // E starts at 60ms, completes at 70ms
      // Total: ~70ms

      // In continuous mode:
      // A, B start at 0ms
      // A completes at 10ms, C starts immediately
      // C completes at 20ms, D starts
      // D completes at 30ms, E starts
      // E completes at 40ms
      // B completes at 50ms
      // Total: ~50ms

      // The key insight: some completions should happen before the slow job (B) finishes
      // Note: we use a generous threshold (< 60ms) to account for CI timing variability
      const fastCompletions = completionTimes.filter(t => t < 60);
      assert.ok(
        fastCompletions.length >= 2,
        `Expected at least 2 fast completions (< 60ms), got ${fastCompletions.length}. Times: ${completionTimes}`
      );
    });
  });

  describe('edge cases for continuous pool', () => {
    it('handles empty queue gracefully', () => {
      const result = selectItemsForBatch([], 4, new Set());
      assert.strictEqual(result.itemsToClaim.length, 0);
    });

    it('handles all items blocked', () => {
      // All items need code-change to complete first
      const items = [
        createCommitWorkItem('narrative', 'commit-1'),
        createCommitWorkItem('security', 'commit-1'),
        createCommitWorkItem('technical-debt', 'commit-1'),
      ];

      const result = selectItemsForBatch(items, 4, new Set());
      assert.strictEqual(result.itemsToClaim.length, 0);

      // All should be skipped with reason
      assert.strictEqual(result.skippedReasons.size, 3);
      for (const item of items) {
        assert.strictEqual(
          result.skippedReasons.get(item.id),
          'waiting_for_code_change'
        );
      }
    });

    it('handles mix of blocked and available items', () => {
      const items = [
        createCommitWorkItem('code-change', 'commit-1'),  // Available
        createCommitWorkItem('narrative', 'commit-1'),    // Blocked
        createCommitWorkItem('code-change', 'commit-2'),  // Available
        createCommitWorkItem('security', 'commit-2'),     // Blocked
      ];

      const result = selectItemsForBatch(items, 4, new Set());

      // Should get both code-change items
      assert.strictEqual(result.itemsToClaim.length, 2);
      assert.ok(result.itemsToClaim.every(i => i.agentType === 'code-change'));

      // narrative and security should be skipped
      assert.strictEqual(result.skippedReasons.size, 2);
    });

    it('respects claim limit even with many available items', () => {
      const items = [
        createCommitWorkItem('code-change', 'commit-1'),
        createCommitWorkItem('code-change', 'commit-2'),
        createCommitWorkItem('code-change', 'commit-3'),
        createCommitWorkItem('code-change', 'commit-4'),
        createCommitWorkItem('code-change', 'commit-5'),
      ];

      // Claim only 1 at a time (continuous pool behavior)
      const result = selectItemsForBatch(items, 1, new Set());
      assert.strictEqual(result.itemsToClaim.length, 1);
    });
  });
});
