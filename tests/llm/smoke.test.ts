/**
 * Smoke tests for LLM assertion infrastructure.
 *
 * These tests validate that evaluateLLM and assertLLM work correctly
 * before we use them in real agent tests.
 *
 * Run with: node --import tsx --test tests/llm/smoke.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import {
  evaluateLLM,
  assertLLM,
  LLMAssertionError,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';

describe('LLM Assertion Infrastructure', { timeout: 60000 }, () => {
  before(() => {
    // Verify API key is configured
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    console.log(`Using model: ${getLLMService().getModel()}`);
  });

  describe('evaluateLLM', () => {
    it('returns valid score structure', async () => {
      const result = await evaluateLLM(
        'The text mentions a greeting',
        'Hello, world!'
      );

      // Verify structure
      assert.ok(typeof result.score === 'number', 'score should be a number');
      assert.ok(result.score >= 0 && result.score <= 10, `score should be 0-10, got ${result.score}`);
      assert.ok(typeof result.reasoning === 'string', 'reasoning should be a string');
      assert.ok(Array.isArray(result.improvements), 'improvements should be an array');
      assert.ok(typeof result.passed === 'boolean', 'passed should be a boolean');

      console.log(formatEvaluationResult('evaluateLLM returns valid structure', result));
    });

    it('gives high score for true claims', async () => {
      const result = await evaluateLLM(
        'The text contains a greeting word like "hello" or "hi"',
        'Hello there, friend!'
      );

      assert.ok(result.score >= 7, `Expected high score for true claim, got ${result.score}`);
      assert.ok(result.passed, 'Should pass for true claim');

      console.log(formatEvaluationResult('evaluateLLM high score for true claims', result));
    });

    it('gives low score for false claims', async () => {
      const result = await evaluateLLM(
        'The text discusses elephants in detail',
        'Hello there, friend!'
      );

      assert.ok(result.score < 5, `Expected low score for false claim, got ${result.score}`);
      assert.ok(!result.passed, 'Should not pass for false claim');

      console.log(formatEvaluationResult('evaluateLLM low score for false claims', result));
    });
  });

  describe('assertLLM', () => {
    it('passes for true claims', async () => {
      const result = await assertLLM(
        'The text contains a greeting',
        'Hello there!'
      );

      assert.ok(result.passed, 'Should pass');
      console.log(formatEvaluationResult('assertLLM passes for true claims', result));
    });

    it('fails for false claims', async () => {
      await assert.rejects(
        () => assertLLM('The text mentions elephants', 'Hello there!'),
        (error: unknown) => {
          assert.ok(error instanceof LLMAssertionError, 'Should throw LLMAssertionError');
          const llmError = error as LLMAssertionError;
          assert.ok(llmError.result.score < 7, 'Score should be below threshold');
          console.log(`Expected failure: score ${llmError.result.score}/10`);
          return true;
        }
      );
    });

    it('respects custom threshold', async () => {
      // With threshold 9, a borderline-passing case should fail
      const result = await evaluateLLM(
        'The text is a friendly greeting',
        'Hi.'
      );

      console.log(formatEvaluationResult('Custom threshold test', result));

      // If the base score is between 7-8, it would pass default but might fail threshold 9
      if (result.score >= 7 && result.score < 9) {
        await assert.rejects(
          () => assertLLM('The text is a friendly greeting', 'Hi.', 9),
          LLMAssertionError
        );
      }
    });
  });

  describe('formatEvaluationResult', () => {
    it('formats passing result correctly', () => {
      const result = {
        score: 9,
        passed: true,
        reasoning: 'The evidence clearly meets the criteria',
        improvements: ['Could be more specific'],
      };

      const formatted = formatEvaluationResult('Test Name', result);

      assert.ok(formatted.includes('\u2713'), 'Should have checkmark for passing');
      assert.ok(formatted.includes('Test Name'), 'Should include test name');
      assert.ok(formatted.includes('9/10'), 'Should include score');
      assert.ok(formatted.includes('clearly meets'), 'Should include reasoning');
      assert.ok(formatted.includes('more specific'), 'Should include improvements');
    });

    it('formats failing result correctly', () => {
      const result = {
        score: 3,
        passed: false,
        reasoning: 'The evidence does not meet the criteria',
        improvements: ['Add more detail', 'Be more specific'],
      };

      const formatted = formatEvaluationResult('Failing Test', result);

      assert.ok(formatted.includes('\u2717'), 'Should have X for failing');
      assert.ok(formatted.includes('3/10'), 'Should include score');
    });
  });
});
