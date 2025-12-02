/**
 * Unit tests for the concurrency limiter utility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createConcurrencyLimiter } from '../../src/utils/concurrency-limiter.js';

describe('createConcurrencyLimiter', () => {
  it('executes tasks immediately when under concurrency limit', async () => {
    const limit = createConcurrencyLimiter(3);
    const results: number[] = [];

    await Promise.all([
      limit(async () => { results.push(1); return 1; }),
      limit(async () => { results.push(2); return 2; }),
    ]);

    assert.strictEqual(results.length, 2);
    assert.ok(results.includes(1));
    assert.ok(results.includes(2));
  });

  it('limits concurrent executions to specified concurrency', async () => {
    const limit = createConcurrencyLimiter(2);
    let currentConcurrency = 0;
    let maxConcurrency = 0;

    const task = async (delay: number): Promise<number> => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      await new Promise(resolve => setTimeout(resolve, delay));
      currentConcurrency--;
      return delay;
    };

    await Promise.all([
      limit(() => task(50)),
      limit(() => task(50)),
      limit(() => task(50)),
      limit(() => task(50)),
    ]);

    assert.strictEqual(maxConcurrency, 2, 'Should never exceed concurrency limit of 2');
  });

  it('processes queued tasks in order', async () => {
    const limit = createConcurrencyLimiter(1);
    const order: number[] = [];

    await Promise.all([
      limit(async () => { order.push(1); }),
      limit(async () => { order.push(2); }),
      limit(async () => { order.push(3); }),
    ]);

    assert.deepStrictEqual(order, [1, 2, 3], 'Tasks should complete in order with concurrency 1');
  });

  it('handles rejected promises correctly', async () => {
    const limit = createConcurrencyLimiter(2);

    const successPromise = limit(async () => 'success');
    const errorPromise = limit(async () => { throw new Error('test error'); });

    const successResult = await successPromise;
    assert.strictEqual(successResult, 'success');

    await assert.rejects(
      async () => await errorPromise,
      { message: 'test error' }
    );
  });

  it('continues processing after a rejection', async () => {
    const limit = createConcurrencyLimiter(1);
    const results: string[] = [];

    const p1 = limit(async () => { results.push('first'); return 'first'; });
    const p2 = limit(async () => { throw new Error('error'); });
    const p3 = limit(async () => { results.push('third'); return 'third'; });

    await p1;
    try { await p2; } catch { /* expected */ }
    await p3;

    assert.deepStrictEqual(results, ['first', 'third']);
  });

  it('handles concurrency of 1 (sequential execution)', async () => {
    const limit = createConcurrencyLimiter(1);
    const timestamps: number[] = [];
    const delay = 20;

    const task = async () => {
      timestamps.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, delay));
    };

    await Promise.all([
      limit(task),
      limit(task),
      limit(task),
    ]);

    // Each task should start after the previous one finishes
    for (let i = 1; i < timestamps.length; i++) {
      const diff = timestamps[i]! - timestamps[i - 1]!;
      assert.ok(diff >= delay - 5, `Task ${i + 1} should start after task ${i} finishes`);
    }
  });

  it('handles high concurrency (no limiting effect)', async () => {
    const limit = createConcurrencyLimiter(100);
    let maxConcurrency = 0;
    let currentConcurrency = 0;

    const task = async () => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrency--;
    };

    await Promise.all(Array.from({ length: 10 }, () => limit(task)));

    assert.strictEqual(maxConcurrency, 10, 'All 10 tasks should run concurrently');
  });

  it('returns correct values from tasks', async () => {
    const limit = createConcurrencyLimiter(2);

    const results = await Promise.all([
      limit(async () => 'a'),
      limit(async () => 'b'),
      limit(async () => 'c'),
    ]);

    assert.deepStrictEqual(results, ['a', 'b', 'c']);
  });
});
