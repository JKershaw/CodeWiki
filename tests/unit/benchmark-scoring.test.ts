/**
 * Unit tests for Benchmark scoring logic.
 * Tests the score calculation functions in isolation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  gradeToScore,
  difficultyWeight,
  calculateSummary,
  type BenchmarkResult,
  type BenchmarkQuestion,
} from '../../src/domain/benchmark.js';

describe('Benchmark Scoring', () => {
  describe('gradeToScore', () => {
    it('returns 1.0 for accurate', () => {
      assert.strictEqual(gradeToScore('accurate'), 1.0);
    });

    it('returns 0.5 for partial', () => {
      assert.strictEqual(gradeToScore('partial'), 0.5);
    });

    it('returns 0 for inaccurate', () => {
      assert.strictEqual(gradeToScore('inaccurate'), 0);
    });

    it('returns 0 for no_answer', () => {
      assert.strictEqual(gradeToScore('no_answer'), 0);
    });
  });

  describe('difficultyWeight', () => {
    it('returns 1.0 for easy', () => {
      assert.strictEqual(difficultyWeight('easy'), 1.0);
    });

    it('returns 1.5 for medium', () => {
      assert.strictEqual(difficultyWeight('medium'), 1.5);
    });

    it('returns 2.0 for hard', () => {
      assert.strictEqual(difficultyWeight('hard'), 2.0);
    });
  });

  describe('calculateSummary', () => {
    it('calculates basic scores correctly', () => {
      const results: BenchmarkResult[] = [
        createResult('q1', 'accurate'),
        createResult('q2', 'accurate'),
        createResult('q3', 'partial'),
        createResult('q4', 'inaccurate'),
        createResult('q5', 'no_answer'),
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'patterns', difficulty: 'easy' },
        { id: 'q3', question: 'Q3?', category: 'decisions', difficulty: 'easy' },
        { id: 'q4', question: 'Q4?', category: 'security', difficulty: 'easy' },
        { id: 'q5', question: 'Q5?', category: 'howto', difficulty: 'easy' },
      ];

      const summary = calculateSummary(results, questions);

      assert.strictEqual(summary.totalQuestions, 5);
      assert.strictEqual(summary.accurate, 2);
      assert.strictEqual(summary.partial, 1);
      assert.strictEqual(summary.inaccurate, 1);
      assert.strictEqual(summary.noAnswer, 1);
      // Score: (2*1 + 1*0.5 + 0 + 0) / 5 * 100 = 50%
      assert.strictEqual(summary.score, 50);
    });

    it('weights by difficulty', () => {
      const results: BenchmarkResult[] = [
        createResult('q1', 'accurate'),  // easy: 1.0 weight
        createResult('q2', 'accurate'),  // hard: 2.0 weight
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'patterns', difficulty: 'hard' },
      ];

      const summary = calculateSummary(results, questions);

      // Both accurate: (1.0*1.0 + 1.0*2.0) / (1.0 + 2.0) * 100 = 100%
      assert.strictEqual(summary.score, 100);
    });

    it('handles weighted partial scores', () => {
      const results: BenchmarkResult[] = [
        createResult('q1', 'accurate'),   // easy: 1.0 * 1.0 = 1.0
        createResult('q2', 'partial'),    // hard: 0.5 * 2.0 = 1.0
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'patterns', difficulty: 'hard' },
      ];

      const summary = calculateSummary(results, questions);

      // (1.0 + 1.0) / (1.0 + 2.0) * 100 = 66.67%
      assert.ok(Math.abs(summary.score - 66.67) < 0.01);
    });

    it('calculates category breakdown', () => {
      const results: BenchmarkResult[] = [
        createResult('q1', 'accurate'),
        createResult('q2', 'partial'),
        createResult('q3', 'accurate'),
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'architecture', difficulty: 'easy' },
        { id: 'q3', question: 'Q3?', category: 'patterns', difficulty: 'easy' },
      ];

      const summary = calculateSummary(results, questions);

      // Architecture: 1 accurate + 1 partial = (1 + 0.5) / 2 * 100 = 75%
      assert.strictEqual(summary.byCategory['architecture']?.total, 2);
      assert.strictEqual(summary.byCategory['architecture']?.accurate, 1);
      assert.strictEqual(summary.byCategory['architecture']?.partial, 1);
      assert.strictEqual(summary.byCategory['architecture']?.score, 75);

      // Patterns: 1 accurate = 100%
      assert.strictEqual(summary.byCategory['patterns']?.total, 1);
      assert.strictEqual(summary.byCategory['patterns']?.accurate, 1);
      assert.strictEqual(summary.byCategory['patterns']?.score, 100);
    });

    it('calculates difficulty breakdown', () => {
      const results: BenchmarkResult[] = [
        createResult('q1', 'accurate'),
        createResult('q2', 'partial'),
        createResult('q3', 'inaccurate'),
      ];

      const questions: BenchmarkQuestion[] = [
        { id: 'q1', question: 'Q1?', category: 'architecture', difficulty: 'easy' },
        { id: 'q2', question: 'Q2?', category: 'patterns', difficulty: 'medium' },
        { id: 'q3', question: 'Q3?', category: 'decisions', difficulty: 'hard' },
      ];

      const summary = calculateSummary(results, questions);

      assert.strictEqual(summary.byDifficulty.easy.total, 1);
      assert.strictEqual(summary.byDifficulty.easy.accurate, 1);
      assert.strictEqual(summary.byDifficulty.easy.score, 100);

      assert.strictEqual(summary.byDifficulty.medium.total, 1);
      assert.strictEqual(summary.byDifficulty.medium.partial, 1);
      assert.strictEqual(summary.byDifficulty.medium.score, 50);

      assert.strictEqual(summary.byDifficulty.hard.total, 1);
      assert.strictEqual(summary.byDifficulty.hard.inaccurate, 1);
      assert.strictEqual(summary.byDifficulty.hard.score, 0);
    });

    it('handles empty results', () => {
      const summary = calculateSummary([], []);

      assert.strictEqual(summary.totalQuestions, 0);
      assert.strictEqual(summary.score, 0);
    });
  });
});

// Helper to create a result
function createResult(questionId: string, grade: BenchmarkResult['grade']): BenchmarkResult {
  return {
    questionId,
    wikiAnswer: 'Answer',
    grade,
    confidence: 0.8,
    reasoning: 'Reasoning',
    codeReferences: [],
    durationMs: 1000,
    costUsd: 0.01,
  };
}
