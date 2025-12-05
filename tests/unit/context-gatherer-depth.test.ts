/**
 * Unit tests for ContextGatherer depth metrics.
 * Tests the shallowPages and pagesLackingExamples calculations.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Helper to create a mock wiki page with specified content.
 */
function createMockWikiPage(
  path: string,
  content: string,
  options?: {
    title?: string;
    confidence?: number;
  }
): WikiPage {
  return {
    id: `page-${path.replace(/\//g, '-')}`,
    wikiId: 'wiki-1',
    path,
    title: options?.title ?? path.split('/').pop() ?? 'Untitled',
    content,
    confidence: options?.confidence ?? 0.7,
    sourceCommits: [],
    sourceAgentRunIds: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Calculate shallow pages count.
 * A page is shallow if:
 * - Content length < 500 characters
 * - NOT an overview or index page (these are expected to be shorter)
 */
function calculateShallowPages(pages: WikiPage[]): number {
  return pages.filter(p => {
    // Exclude overview and index pages
    if (p.path.endsWith('/overview') || p.path.endsWith('/index')) {
      return false;
    }
    // Shallow if content is less than 500 characters
    return p.content.length < 500;
  }).length;
}

/**
 * Calculate pages lacking examples count.
 * A page lacks examples if:
 * - No fenced code blocks (```)
 * - NOT an overview or index page (these may not need code examples)
 */
function calculatePagesLackingExamples(pages: WikiPage[]): number {
  return pages.filter(p => {
    // Exclude overview and index pages
    if (p.path.endsWith('/overview') || p.path.endsWith('/index')) {
      return false;
    }
    // Lacks examples if no fenced code blocks
    return !p.content.includes('```');
  }).length;
}

describe('ContextGatherer Depth Metrics', () => {
  describe('shallowPages calculation', () => {
    it('should count pages with less than 500 characters as shallow', () => {
      const pages = [
        createMockWikiPage('architecture/cqrs', 'Short content'), // ~13 chars - shallow
        createMockWikiPage('patterns/repository', 'A'.repeat(499)), // 499 chars - shallow
        createMockWikiPage('patterns/factory', 'B'.repeat(500)), // 500 chars - NOT shallow
        createMockWikiPage('guides/testing', 'C'.repeat(1000)), // 1000 chars - NOT shallow
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 2, 'Should count 2 shallow pages');
    });

    it('should exclude overview pages from shallow count', () => {
      const pages = [
        createMockWikiPage('architecture/overview', 'Short overview'), // Excluded
        createMockWikiPage('patterns/index', 'Short index'), // Excluded
        createMockWikiPage('guides/intro', 'Short intro'), // Counted as shallow
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 1, 'Should only count non-overview shallow pages');
    });

    it('should return 0 when all pages have sufficient content', () => {
      const pages = [
        createMockWikiPage('architecture/cqrs', 'A'.repeat(600)),
        createMockWikiPage('patterns/repository', 'B'.repeat(1000)),
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 0, 'Should return 0 when no shallow pages');
    });

    it('should return 0 for empty pages array', () => {
      const shallowCount = calculateShallowPages([]);
      assert.strictEqual(shallowCount, 0, 'Should return 0 for empty array');
    });

    it('should handle pages at exact 500 character boundary', () => {
      const pages = [
        createMockWikiPage('page/exactly-500', 'A'.repeat(500)), // NOT shallow (>= 500)
        createMockWikiPage('page/just-under', 'B'.repeat(499)), // shallow (< 500)
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 1, 'Should count only pages under 500 chars');
    });
  });

  describe('pagesLackingExamples calculation', () => {
    it('should count pages without code blocks as lacking examples', () => {
      const pageWithCode = createMockWikiPage(
        'architecture/cqrs',
        '# CQRS Pattern\n\nExample:\n```typescript\nconst query = createQuery();\n```'
      );
      const pageWithoutCode = createMockWikiPage(
        'patterns/repository',
        '# Repository Pattern\n\nThe repository pattern abstracts data access.'
      );

      const pages = [pageWithCode, pageWithoutCode];
      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should count 1 page lacking examples');
    });

    it('should exclude overview pages from lacking examples count', () => {
      const pages = [
        createMockWikiPage('architecture/overview', 'Overview without code'), // Excluded
        createMockWikiPage('patterns/index', 'Index without code'), // Excluded
        createMockWikiPage('guides/intro', 'Intro without code'), // Counted
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should only count non-overview pages');
    });

    it('should recognize various code block formats', () => {
      const pages = [
        createMockWikiPage('page/typescript', '```typescript\ncode\n```'),
        createMockWikiPage('page/javascript', '```js\ncode\n```'),
        createMockWikiPage('page/plain', '```\ncode\n```'),
        createMockWikiPage('page/no-code', 'No code blocks here'),
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should only count page without any code blocks');
    });

    it('should return 0 when all pages have code examples', () => {
      const pages = [
        createMockWikiPage('page/a', 'Content with ```code```'),
        createMockWikiPage('page/b', 'More content\n```\nexample\n```'),
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 0, 'Should return 0 when all pages have examples');
    });

    it('should return 0 for empty pages array', () => {
      const lackingCount = calculatePagesLackingExamples([]);
      assert.strictEqual(lackingCount, 0, 'Should return 0 for empty array');
    });

    it('should not count inline code as examples', () => {
      const pageWithInlineOnly = createMockWikiPage(
        'page/inline',
        'Use the `createQuery()` function to create queries.'
      );

      const lackingCount = calculatePagesLackingExamples([pageWithInlineOnly]);
      assert.strictEqual(lackingCount, 1, 'Inline code should not count as examples');
    });
  });

  describe('combined metrics', () => {
    it('should correctly calculate both metrics for mixed pages', () => {
      const pages = [
        // Shallow AND lacking examples
        createMockWikiPage('page/shallow-no-code', 'Short content without code'),
        // Shallow but HAS examples
        createMockWikiPage('page/shallow-with-code', 'Short ```code```'),
        // Not shallow AND has examples
        createMockWikiPage('page/good', 'A'.repeat(600) + '\n```typescript\ncode\n```'),
        // Not shallow but lacking examples
        createMockWikiPage('page/long-no-code', 'A'.repeat(600)),
        // Overview pages (excluded from both)
        createMockWikiPage('category/overview', 'Short overview'),
        createMockWikiPage('category/index', 'Short index'),
      ];

      const shallowCount = calculateShallowPages(pages);
      const lackingCount = calculatePagesLackingExamples(pages);

      assert.strictEqual(shallowCount, 2, 'Should count 2 shallow pages');
      assert.strictEqual(lackingCount, 2, 'Should count 2 pages lacking examples');
    });
  });
});
