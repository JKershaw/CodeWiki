/**
 * Unit tests for ContinuousWorkerPool utility.
 * Tests the worker pool that maintains maxConcurrency active workers at all times.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  runContinuousPool,
  type ContinuousPoolOptions,
  type ContinuousPoolResult,
} from '../../src/executor/continuous-worker-pool.js';

// Helper to create a delayed promise
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to track execution timeline
interface ExecutionEvent {
  type: 'start' | 'complete' | 'error';
  itemId: number;
  timestamp: number;
}

describe('ContinuousWorkerPool', () => {
  describe('basic execution', () => {
    it('processes all work items', async () => {
      const items = [1, 2, 3, 4, 5];
      let itemIndex = 0;
      const completed: number[] = [];

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          await delay(10);
          return `result-${item}`;
        },
        onComplete: async (item) => {
          completed.push(item);
        },
        onError: async () => {},
      });

      assert.strictEqual(result.completed, 5);
      assert.strictEqual(result.failed, 0);
      assert.deepStrictEqual(completed.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    });

    it('returns empty result when no work available', async () => {
      const result = await runContinuousPool<number, string>({
        maxConcurrency: 4,
        claimWork: async () => null,
        executeWork: async () => 'never called',
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.strictEqual(result.completed, 0);
      assert.strictEqual(result.failed, 0);
    });
  });

  describe('concurrency control', () => {
    it('never exceeds maxConcurrency', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      let itemIndex = 0;
      let currentConcurrency = 0;
      let maxObservedConcurrency = 0;

      await runContinuousPool<number, string>({
        maxConcurrency: 3,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          currentConcurrency++;
          maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency);
          await delay(20);
          currentConcurrency--;
          return `result-${item}`;
        },
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.ok(
        maxObservedConcurrency <= 3,
        `Max concurrency was ${maxObservedConcurrency}, expected <= 3`
      );
      assert.ok(
        maxObservedConcurrency >= 2,
        `Max concurrency was ${maxObservedConcurrency}, expected >= 2 (should use available slots)`
      );
    });

    it('fills all slots initially when work is available', async () => {
      const items = [1, 2, 3, 4, 5];
      let itemIndex = 0;
      let initialConcurrency = 0;
      let capturedInitialConcurrency = 0;

      await runContinuousPool<number, string>({
        maxConcurrency: 4,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          initialConcurrency++;
          if (capturedInitialConcurrency === 0) {
            // Small delay to let other slots fill
            await delay(5);
            capturedInitialConcurrency = initialConcurrency;
          }
          await delay(20);
          initialConcurrency--;
          return `result-${item}`;
        },
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.ok(
        capturedInitialConcurrency >= 3,
        `Initial concurrency was ${capturedInitialConcurrency}, expected >= 3`
      );
    });
  });

  describe('continuous replenishment', () => {
    it('immediately claims new work when a slot opens', async () => {
      const events: ExecutionEvent[] = [];
      const startTime = Date.now();
      const items = [
        { id: 1, duration: 10 },  // Fast
        { id: 2, duration: 50 },  // Slow
        { id: 3, duration: 10 },  // Fast - should start ~10ms (when item 1 completes)
        { id: 4, duration: 10 },  // Fast - should start ~20ms (when item 3 completes)
      ];
      let itemIndex = 0;

      await runContinuousPool({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          events.push({ type: 'start', itemId: item.id, timestamp: Date.now() - startTime });
          await delay(item.duration);
          events.push({ type: 'complete', itemId: item.id, timestamp: Date.now() - startTime });
          return `done-${item.id}`;
        },
        onComplete: async () => {},
        onError: async () => {},
      });

      // Items 1 and 2 should start at ~0ms
      const item1Start = events.find(e => e.type === 'start' && e.itemId === 1)!;
      const item2Start = events.find(e => e.type === 'start' && e.itemId === 2)!;
      const item3Start = events.find(e => e.type === 'start' && e.itemId === 3)!;

      // Item 3 should start shortly after item 1 completes (~10ms), not wait for item 2
      assert.ok(
        item3Start.timestamp < 30,
        `Item 3 started at ${item3Start.timestamp}ms, expected < 30ms (shouldn't wait for slow item 2)`
      );
    });

    it('does not wait for entire batch to complete', async () => {
      // Key test: demonstrates the improvement over Promise.allSettled batch approach
      const startTime = Date.now();
      const items = [
        { id: 1, duration: 10 },   // Fast
        { id: 2, duration: 100 },  // Slow
        { id: 3, duration: 10 },   // Fast
        { id: 4, duration: 10 },   // Fast
      ];
      let itemIndex = 0;
      const completionTimes: number[] = [];

      await runContinuousPool({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          await delay(item.duration);
          return item.id;
        },
        onComplete: async () => {
          completionTimes.push(Date.now() - startTime);
        },
        onError: async () => {},
      });

      // In batch mode, all 4 would complete at ~100ms (waiting for slow item)
      // In continuous mode: item1 ~10ms, item3 ~20ms, item4 ~30ms, item2 ~100ms
      const fastCompletions = completionTimes.filter(t => t < 50);
      assert.ok(
        fastCompletions.length >= 2,
        `Expected at least 2 fast completions, got ${fastCompletions.length}. Times: ${completionTimes}`
      );
    });
  });

  describe('error handling', () => {
    it('continues processing after errors', async () => {
      const items = [1, 2, 3, 4, 5];
      let itemIndex = 0;
      const completed: number[] = [];
      const failed: number[] = [];

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          if (item === 3) throw new Error('Item 3 failed');
          return `result-${item}`;
        },
        onComplete: async (item) => {
          completed.push(item);
        },
        onError: async (item) => {
          failed.push(item);
        },
      });

      assert.strictEqual(result.completed, 4);
      assert.strictEqual(result.failed, 1);
      assert.deepStrictEqual(completed.sort((a, b) => a - b), [1, 2, 4, 5]);
      assert.deepStrictEqual(failed, [3]);
    });

    it('handles errors in onComplete callback', async () => {
      const items = [1, 2, 3];
      let itemIndex = 0;

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => `result-${item}`,
        onComplete: async (item) => {
          if (item === 2) throw new Error('Callback error');
        },
        onError: async () => {},
      });

      // Should still complete all work despite callback error
      assert.strictEqual(result.completed, 3);
    });
  });

  describe('stopping', () => {
    it('respects shouldStop callback', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      let itemIndex = 0;
      let stopAfter = 3;
      const completed: number[] = [];

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          await delay(10);
          return `result-${item}`;
        },
        onComplete: async (item) => {
          completed.push(item);
          stopAfter--;
        },
        onError: async () => {},
        shouldStop: () => stopAfter <= 0,
      });

      // Should stop after processing ~3 items (may have 1-2 more in flight)
      assert.ok(
        result.completed <= 5,
        `Expected <= 5 completions (3 + in-flight), got ${result.completed}`
      );
      assert.ok(
        result.completed >= 3,
        `Expected >= 3 completions, got ${result.completed}`
      );
    });

    it('allows in-flight work to complete when stopping', async () => {
      const items = [1, 2, 3, 4];
      let itemIndex = 0;
      let shouldStop = false;
      const completed: number[] = [];

      await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          const item = items[itemIndex++]!;
          if (item === 2) {
            // Stop after claiming item 2
            shouldStop = true;
          }
          return item;
        },
        executeWork: async (item) => {
          await delay(20);
          return `result-${item}`;
        },
        onComplete: async (item) => {
          completed.push(item);
        },
        onError: async () => {},
        shouldStop: () => shouldStop,
      });

      // Items 1 and 2 were already claimed before stop, so they should complete
      assert.ok(
        completed.includes(1) && completed.includes(2),
        `Items 1 and 2 should complete. Got: ${completed}`
      );
    });
  });

  describe('maxIterations limit', () => {
    it('stops after maxIterations', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      let itemIndex = 0;

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        maxIterations: 5,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          await delay(5);
          return `result-${item}`;
        },
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.strictEqual(result.completed, 5);
    });
  });

  describe('edge cases', () => {
    it('handles single item', async () => {
      let claimed = false;

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 4,
        claimWork: async () => {
          if (claimed) return null;
          claimed = true;
          return 1;
        },
        executeWork: async () => 'done',
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.strictEqual(result.completed, 1);
    });

    it('handles maxConcurrency of 1', async () => {
      const items = [1, 2, 3];
      let itemIndex = 0;
      let currentConcurrency = 0;
      let maxObservedConcurrency = 0;

      await runContinuousPool<number, string>({
        maxConcurrency: 1,
        claimWork: async () => {
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => {
          currentConcurrency++;
          maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency);
          await delay(10);
          currentConcurrency--;
          return `result-${item}`;
        },
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.strictEqual(maxObservedConcurrency, 1);
    });

    it('handles async claimWork correctly', async () => {
      const items = [1, 2, 3];
      let itemIndex = 0;

      const result = await runContinuousPool<number, string>({
        maxConcurrency: 2,
        claimWork: async () => {
          await delay(5); // Simulate async database call
          if (itemIndex >= items.length) return null;
          return items[itemIndex++]!;
        },
        executeWork: async (item) => `result-${item}`,
        onComplete: async () => {},
        onError: async () => {},
      });

      assert.strictEqual(result.completed, 3);
    });
  });
});
