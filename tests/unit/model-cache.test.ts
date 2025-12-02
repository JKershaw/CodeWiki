/**
 * Unit tests for model cache - dynamic model pricing from OpenRouter API.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  getModelCost,
  fetchModelsFromAPI,
  clearModelCache,
  isCachePopulated,
} from '../../src/services/llm/model-cache.js';
import { MODEL_COSTS } from '../../src/services/llm/llm-service.js';

describe('Model Cache', () => {
  // Store original fetch to restore after tests
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearModelCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearModelCache();
  });

  describe('fetchModelsFromAPI', () => {
    it('fetches and caches models from API', async () => {
      const mockResponse = {
        data: [
          {
            id: 'test-provider/test-model',
            pricing: {
              prompt: '0.000001',
              completion: '0.000002',
            },
          },
          {
            id: 'another/model',
            pricing: {
              prompt: '0.000005',
              completion: '0.00001',
            },
          },
        ],
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockResponse,
      })) as unknown as typeof fetch;

      const result = await fetchModelsFromAPI();

      assert.strictEqual(result, true);
      assert.strictEqual(isCachePopulated(), true);
    });

    it('returns false on API error', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as typeof fetch;

      const result = await fetchModelsFromAPI();

      assert.strictEqual(result, false);
      assert.strictEqual(isCachePopulated(), false);
    });

    it('returns false on network error', async () => {
      globalThis.fetch = mock.fn(async () => {
        throw new Error('Network error');
      }) as unknown as typeof fetch;

      const result = await fetchModelsFromAPI();

      assert.strictEqual(result, false);
      assert.strictEqual(isCachePopulated(), false);
    });

    it('returns false on invalid response structure', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ invalid: 'structure' }),
      })) as unknown as typeof fetch;

      const result = await fetchModelsFromAPI();

      assert.strictEqual(result, false);
    });
  });

  describe('getModelCost', () => {
    it('fetches from API on first call and caches result', async () => {
      const mockResponse = {
        data: [
          {
            id: 'test/model',
            pricing: {
              prompt: '0.000003', // $3 per million tokens
              completion: '0.000015', // $15 per million tokens
            },
          },
        ],
      };

      let fetchCallCount = 0;
      globalThis.fetch = mock.fn(async () => {
        fetchCallCount++;
        return {
          ok: true,
          json: async () => mockResponse,
        };
      }) as unknown as typeof fetch;

      // First call should fetch
      const cost1 = await getModelCost('test/model');
      assert.strictEqual(fetchCallCount, 1);
      assert.deepStrictEqual(cost1, { input: 3, output: 15 });

      // Second call should use cache (no additional fetch)
      const cost2 = await getModelCost('test/model');
      assert.strictEqual(fetchCallCount, 1);
      assert.deepStrictEqual(cost2, { input: 3, output: 15 });
    });

    it('converts per-token prices to per-million-token prices', async () => {
      const mockResponse = {
        data: [
          {
            id: 'cheap/model',
            pricing: {
              prompt: '0.000001', // $1 per million
              completion: '0.000005', // $5 per million
            },
          },
        ],
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockResponse,
      })) as unknown as typeof fetch;

      const cost = await getModelCost('cheap/model');

      // Use whole numbers to avoid floating-point precision issues
      assert.strictEqual(cost.input, 1);
      assert.strictEqual(cost.output, 5);
    });

    it('falls back to MODEL_COSTS when model not in API response', async () => {
      const mockResponse = {
        data: [
          {
            id: 'other/model',
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockResponse,
      })) as unknown as typeof fetch;

      // 'mock' is in MODEL_COSTS but not in API response
      const cost = await getModelCost('mock');

      assert.deepStrictEqual(cost, MODEL_COSTS['mock']);
    });

    it('falls back to MODEL_COSTS when API fails', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 503,
      })) as unknown as typeof fetch;

      const cost = await getModelCost('anthropic/claude-sonnet-4.5');

      assert.deepStrictEqual(cost, MODEL_COSTS['anthropic/claude-sonnet-4.5']);
    });

    it('falls back to GPT-4 pricing for unknown model when API fails', async () => {
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 503,
      })) as unknown as typeof fetch;

      const cost = await getModelCost('unknown/model-xyz');

      assert.deepStrictEqual(cost, MODEL_COSTS['openai/gpt-4']);
    });

    it('only attempts API fetch once even on failure', async () => {
      let fetchCallCount = 0;
      globalThis.fetch = mock.fn(async () => {
        fetchCallCount++;
        return { ok: false, status: 500 };
      }) as unknown as typeof fetch;

      await getModelCost('any/model');
      await getModelCost('another/model');
      await getModelCost('third/model');

      // Should only try once, not retry on every call
      assert.strictEqual(fetchCallCount, 1);
    });

    it('handles missing pricing fields gracefully', async () => {
      const mockResponse = {
        data: [
          {
            id: 'free/model',
            pricing: {
              // prompt and completion are missing
            },
          },
        ],
      };

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => mockResponse,
      })) as unknown as typeof fetch;

      const cost = await getModelCost('free/model');

      assert.deepStrictEqual(cost, { input: 0, output: 0 });
    });
  });

  describe('clearModelCache', () => {
    it('clears the cache and allows re-fetching', async () => {
      const mockResponse = {
        data: [
          {
            id: 'test/model',
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      };

      let fetchCallCount = 0;
      globalThis.fetch = mock.fn(async () => {
        fetchCallCount++;
        return { ok: true, json: async () => mockResponse };
      }) as unknown as typeof fetch;

      await getModelCost('test/model');
      assert.strictEqual(fetchCallCount, 1);
      assert.strictEqual(isCachePopulated(), true);

      clearModelCache();
      assert.strictEqual(isCachePopulated(), false);

      await getModelCost('test/model');
      assert.strictEqual(fetchCallCount, 2);
    });
  });
});
