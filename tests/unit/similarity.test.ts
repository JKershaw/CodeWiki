/**
 * Unit tests for similarity utilities.
 * Tests content, title, and path similarity calculations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateJaccardSimilarity,
  calculateTitleSimilarity,
  calculatePathSimilarity,
  findSimilarPage,
} from '../../src/utils/similarity.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('Similarity Utilities', () => {
  describe('calculateJaccardSimilarity', () => {
    it('returns 1.0 for identical content', () => {
      const content = 'The quick brown fox jumps over the lazy dog';
      assert.strictEqual(calculateJaccardSimilarity(content, content), 1.0);
    });

    it('returns 0 for completely different content', () => {
      const content1 = 'alpha beta gamma delta epsilon';
      const content2 = 'one two three four five';
      assert.strictEqual(calculateJaccardSimilarity(content1, content2), 0);
    });

    it('returns partial similarity for overlapping content', () => {
      const content1 = 'the quick brown fox jumps';
      const content2 = 'the quick red fox leaps';
      const similarity = calculateJaccardSimilarity(content1, content2);
      assert.ok(similarity > 0);
      assert.ok(similarity < 1);
    });

    it('ignores short words (< 5 chars)', () => {
      const content1 = 'a the is of to';
      const content2 = 'a an is at or';
      // All words are short, should be 0
      assert.strictEqual(calculateJaccardSimilarity(content1, content2), 0);
    });

    it('is case insensitive', () => {
      const content1 = 'Quick BROWN Fox';
      const content2 = 'quick brown fox';
      assert.strictEqual(calculateJaccardSimilarity(content1, content2), 1.0);
    });

    it('returns 0 for empty content', () => {
      assert.strictEqual(calculateJaccardSimilarity('', 'some content'), 0);
      assert.strictEqual(calculateJaccardSimilarity('some content', ''), 0);
      assert.strictEqual(calculateJaccardSimilarity('', ''), 0);
    });
  });

  describe('calculateTitleSimilarity', () => {
    it('returns 1.0 for identical titles', () => {
      assert.strictEqual(calculateTitleSimilarity('LLM Service', 'LLM Service'), 1.0);
    });

    it('returns 1.0 for same words different order', () => {
      // Normalized same words, different order
      assert.strictEqual(calculateTitleSimilarity('Service LLM', 'LLM Service'), 1.0);
    });

    it('returns 1.0 for case-insensitive matches', () => {
      assert.strictEqual(calculateTitleSimilarity('LLM SERVICE', 'llm service'), 1.0);
    });

    it('returns high similarity for titles with minor differences', () => {
      const sim = calculateTitleSimilarity('LLM Service', 'LLM Service Overview');
      assert.ok(sim >= 0.5, `Expected >= 0.5, got ${sim}`);
    });

    it('returns 0 for completely different titles', () => {
      assert.strictEqual(calculateTitleSimilarity('Getting Started', 'Architecture Overview'), 0);
    });

    it('handles titles with special characters', () => {
      const sim = calculateTitleSimilarity('LLM-Service', 'LLM Service');
      assert.ok(sim >= 0.5, `Expected >= 0.5, got ${sim}`);
    });
  });

  describe('calculatePathSimilarity', () => {
    it('returns 1.0 for identical paths', () => {
      assert.strictEqual(calculatePathSimilarity('services/llm', 'services/llm'), 1.0);
    });

    it('returns high similarity for paths with same components', () => {
      const sim = calculatePathSimilarity('services/llm', 'services/llm-service');
      assert.ok(sim >= 0.5, `Expected >= 0.5, got ${sim}`);
    });

    it('returns partial similarity for same category', () => {
      const sim = calculatePathSimilarity('services/auth', 'services/user');
      assert.ok(sim > 0, `Expected > 0, got ${sim}`);
    });

    it('returns 0 for completely different paths', () => {
      const sim = calculatePathSimilarity('services/llm', 'architecture/overview');
      assert.ok(sim < 0.5, `Expected < 0.5, got ${sim}`);
    });

    it('handles nested paths', () => {
      const sim = calculatePathSimilarity('services/llm/openrouter', 'services/llm-service');
      assert.ok(sim >= 0.3, `Expected >= 0.3, got ${sim}`);
    });
  });

  describe('findSimilarPage', () => {
    const createTestPage = (id: string, path: string, title: string, content: string): WikiPage => ({
      id,
      wikiId: 'wiki-1',
      path,
      title,
      content,
      confidence: 0.5,
      links: [],
      backlinks: [],
      sourceCommits: [],
      sourceAgentRunIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const existingPages: WikiPage[] = [
      createTestPage('1', 'services/llm', 'LLM Service', '# LLM Service\n\nService for language model integration and API calls.'),
      createTestPage('2', 'architecture/overview', 'Architecture Overview', '# Architecture Overview\n\nSystem architecture and design patterns.'),
      createTestPage('3', 'guides/getting-started', 'Getting Started', '# Getting Started\n\nHow to set up and run the project.'),
    ];

    it('finds page with exact title match', () => {
      const result = findSimilarPage(
        'LLM Service',
        'components/llm-wrapper',
        'Some different content about language models',
        existingPages
      );
      assert.ok(result !== null);
      assert.strictEqual(result.page.id, '1');
      assert.strictEqual(result.matchType, 'title');
    });

    it('finds page with similar path at lower threshold', () => {
      // Path similarity is 0.5 (services + llm match, but service is extra)
      // Use 0.5 threshold to catch this case
      const result = findSimilarPage(
        'OpenRouter LLM',
        'services/llm-service',
        'Integration with OpenRouter API',
        existingPages,
        0.5 // Lower threshold to catch path similarity
      );
      assert.ok(result !== null);
      assert.strictEqual(result.page.id, '1');
      assert.strictEqual(result.matchType, 'path');
    });

    it('finds page with exact path match', () => {
      const result = findSimilarPage(
        'Different Title',
        'services/llm', // Exact same path
        'Different content',
        existingPages
      );
      assert.ok(result !== null);
      assert.strictEqual(result.page.id, '1');
      assert.strictEqual(result.matchType, 'path');
    });

    it('returns null when no similar page exists', () => {
      const result = findSimilarPage(
        'Database Configuration',
        'config/database',
        'How to configure the database connection.',
        existingPages
      );
      assert.strictEqual(result, null);
    });

    it('returns null for empty existing pages', () => {
      const result = findSimilarPage(
        'Any Title',
        'any/path',
        'Any content',
        []
      );
      assert.strictEqual(result, null);
    });

    it('respects similarity threshold', () => {
      // "LLM Service Overview" should still match "LLM Service"
      const result = findSimilarPage(
        'LLM Service Overview',
        'components/llm-overview',
        'Overview of the language model service.',
        existingPages,
        0.5 // 50% threshold
      );
      assert.ok(result !== null);
      assert.strictEqual(result.page.id, '1');
    });
  });
});
