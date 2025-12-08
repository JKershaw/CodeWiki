/**
 * Unit tests for OpenRouter retry logic and empty response handling.
 * Tests the helper functions for retry decisions and backoff calculations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isRetryableStatus,
  isNetworkError,
  calculateBackoffWithJitter,
  isEmptyResponse,
  RETRY_CONFIG,
} from '../../src/services/llm/openrouter-llm-service.js';

describe('OpenRouter Retry Logic', () => {
  describe('RETRY_CONFIG', () => {
    it('has MAX_RETRIES of 6', () => {
      assert.strictEqual(RETRY_CONFIG.MAX_RETRIES, 6);
    });

    it('has INITIAL_BACKOFF_MS of 2000', () => {
      assert.strictEqual(RETRY_CONFIG.INITIAL_BACKOFF_MS, 2000);
    });

    it('has JITTER_FACTOR of 0.2', () => {
      assert.strictEqual(RETRY_CONFIG.JITTER_FACTOR, 0.2);
    });

    it('has MAX_BACKOFF_MS of 60000', () => {
      assert.strictEqual(RETRY_CONFIG.MAX_BACKOFF_MS, 60000);
    });
  });

  describe('isRetryableStatus', () => {
    it('returns true for 429 (rate limited)', () => {
      assert.strictEqual(isRetryableStatus(429), true);
    });

    it('returns true for 500 (internal server error)', () => {
      assert.strictEqual(isRetryableStatus(500), true);
    });

    it('returns true for 502 (bad gateway)', () => {
      assert.strictEqual(isRetryableStatus(502), true);
    });

    it('returns true for 503 (service unavailable)', () => {
      assert.strictEqual(isRetryableStatus(503), true);
    });

    it('returns true for 504 (gateway timeout)', () => {
      assert.strictEqual(isRetryableStatus(504), true);
    });

    it('returns true for 599 (upper bound of 5xx)', () => {
      assert.strictEqual(isRetryableStatus(599), true);
    });

    it('returns false for 400 (bad request)', () => {
      assert.strictEqual(isRetryableStatus(400), false);
    });

    it('returns false for 401 (unauthorized)', () => {
      assert.strictEqual(isRetryableStatus(401), false);
    });

    it('returns false for 402 (payment required)', () => {
      assert.strictEqual(isRetryableStatus(402), false);
    });

    it('returns false for 403 (forbidden)', () => {
      assert.strictEqual(isRetryableStatus(403), false);
    });

    it('returns false for 404 (not found)', () => {
      assert.strictEqual(isRetryableStatus(404), false);
    });

    it('returns false for 200 (success)', () => {
      assert.strictEqual(isRetryableStatus(200), false);
    });

    it('returns false for 201 (created)', () => {
      assert.strictEqual(isRetryableStatus(201), false);
    });
  });

  describe('isNetworkError', () => {
    it('returns true for fetch failed error', () => {
      const error = new Error('fetch failed: connection refused');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for ECONNRESET error', () => {
      const error = new Error('read ECONNRESET');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for ETIMEDOUT error', () => {
      const error = new Error('connect ETIMEDOUT');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for ENOTFOUND error', () => {
      const error = new Error('getaddrinfo ENOTFOUND openrouter.ai');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for EAI_AGAIN error', () => {
      const error = new Error('getaddrinfo EAI_AGAIN');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for certificate error', () => {
      const error = new Error('certificate has expired');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for TLS error', () => {
      const error = new Error('TLS handshake failed');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns true for SSL error', () => {
      const error = new Error('SSL connection error');
      assert.strictEqual(isNetworkError(error), true);
    });

    it('returns false for non-Error object', () => {
      assert.strictEqual(isNetworkError('string error'), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isNetworkError(null), false);
    });

    it('returns false for undefined', () => {
      assert.strictEqual(isNetworkError(undefined), false);
    });

    it('returns false for generic error', () => {
      const error = new Error('Something went wrong');
      assert.strictEqual(isNetworkError(error), false);
    });

    it('returns false for API error', () => {
      const error = new Error('OpenRouter API error (400): Invalid request');
      assert.strictEqual(isNetworkError(error), false);
    });
  });

  describe('calculateBackoffWithJitter', () => {
    it('returns value within jitter range for attempt 1', () => {
      // attempt 1: base = 2000ms, jitter ±20% = 1600-2400ms
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateBackoffWithJitter(1));
      }

      const min = Math.min(...results);
      const max = Math.max(...results);

      // Base is 2000, jitter is ±20%, so range is 1600-2400
      assert.ok(min >= 1600, `min ${min} should be >= 1600`);
      assert.ok(max <= 2400, `max ${max} should be <= 2400`);
    });

    it('returns value within jitter range for attempt 2', () => {
      // attempt 2: base = 4000ms, jitter ±20% = 3200-4800ms
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateBackoffWithJitter(2));
      }

      const min = Math.min(...results);
      const max = Math.max(...results);

      assert.ok(min >= 3200, `min ${min} should be >= 3200`);
      assert.ok(max <= 4800, `max ${max} should be <= 4800`);
    });

    it('returns value within jitter range for attempt 3', () => {
      // attempt 3: base = 8000ms, jitter ±20% = 6400-9600ms
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateBackoffWithJitter(3));
      }

      const min = Math.min(...results);
      const max = Math.max(...results);

      assert.ok(min >= 6400, `min ${min} should be >= 6400`);
      assert.ok(max <= 9600, `max ${max} should be <= 9600`);
    });

    it('caps backoff at MAX_BACKOFF_MS', () => {
      // attempt 6: base = 64000ms, but should cap at 60000ms
      // With jitter ±20% on capped value: 48000-72000, but still capped at 60000
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculateBackoffWithJitter(6));
      }

      const max = Math.max(...results);
      assert.ok(max <= 60000, `max ${max} should be <= 60000 (MAX_BACKOFF_MS)`);
    });

    it('produces varied results (jitter is working)', () => {
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(calculateBackoffWithJitter(1));
      }
      // With jitter, we should get many different values
      assert.ok(results.size > 10, `should have varied results, got ${results.size} unique values`);
    });
  });

  describe('isEmptyResponse', () => {
    it('returns true for null response', () => {
      assert.strictEqual(isEmptyResponse(null), true);
    });

    it('returns true for undefined response', () => {
      assert.strictEqual(isEmptyResponse(undefined), true);
    });

    it('returns true for response with empty choices array', () => {
      const response = { choices: [] };
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns true for response with no choices property', () => {
      const response = {};
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns true for response with null content', () => {
      const response = {
        choices: [{ message: { content: null } }],
      };
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns true for response with undefined content', () => {
      const response = {
        choices: [{ message: { content: undefined } }],
      };
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns true for response with empty string content', () => {
      const response = {
        choices: [{ message: { content: '' } }],
      };
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns true for response with whitespace-only content', () => {
      const response = {
        choices: [{ message: { content: '   \n\t  ' } }],
      };
      assert.strictEqual(isEmptyResponse(response), true);
    });

    it('returns false for response with valid content', () => {
      const response = {
        choices: [{ message: { content: 'Hello, world!' } }],
      };
      assert.strictEqual(isEmptyResponse(response), false);
    });

    it('returns false for response with tool_calls (even without content)', () => {
      const response = {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'call_123', function: { name: 'test', arguments: '{}' } }],
          },
        }],
      };
      assert.strictEqual(isEmptyResponse(response), false);
    });

    it('returns false for response with non-empty tool_calls array', () => {
      const response = {
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_123', function: { name: 'test', arguments: '{}' } }],
          },
        }],
      };
      assert.strictEqual(isEmptyResponse(response), false);
    });

    it('returns true for response with empty tool_calls array and no content', () => {
      const response = {
        choices: [{
          message: {
            content: '',
            tool_calls: [],
          },
        }],
      };
      assert.strictEqual(isEmptyResponse(response), true);
    });
  });
});
