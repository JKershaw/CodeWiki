/**
 * Unit tests for wiki research tools.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  searchWikiTool,
  readPageTool,
  listPagesTool,
  getRelatedPagesTool,
  type WikiToolContext,
} from '../../src/services/llm/wiki-tools.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

/**
 * Create a mock wiki page for testing.
 */
function createMockPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-1',
    wikiId: 'wiki-1',
    path: 'test/page',
    title: 'Test Page',
    content: 'This is test content for the wiki page.',
    confidence: 0.8,
    sourceCommits: ['commit-1'],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Wiki Research Tools', () => {
  describe('search_wiki', () => {
    it('finds pages by keyword in title', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs', title: 'CQRS Pattern', content: 'Command query...' }),
        createMockPage({ path: 'guides/setup', title: 'Getting Started', content: 'How to setup...' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await searchWikiTool.execute({ query: 'CQRS' }, context);

      assert.ok(result.includes('CQRS Pattern'), 'Should find page with matching title');
      assert.ok(result.includes('architecture/cqrs'), 'Should include page path');
    });

    it('finds pages by keyword in content', async () => {
      const pages = [
        createMockPage({ path: 'api/endpoints', title: 'API Reference', content: 'The authentication endpoint...' }),
        createMockPage({ path: 'guides/setup', title: 'Setup Guide', content: 'Configure the database...' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await searchWikiTool.execute({ query: 'authentication' }, context);

      assert.ok(result.includes('API Reference'), 'Should find page with matching content');
    });

    it('returns no results message when nothing matches', async () => {
      const pages = [
        createMockPage({ path: 'test', title: 'Test', content: 'Hello world' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await searchWikiTool.execute({ query: 'nonexistent' }, context);

      assert.ok(result.includes('No pages found'), 'Should indicate no matches');
    });

    it('handles empty query gracefully', async () => {
      const context: WikiToolContext = { pages: [] };

      const result = await searchWikiTool.execute({ query: 'a b' }, context);

      assert.ok(result.includes('more specific'), 'Should ask for more specific query');
    });

    it('ranks title matches higher than content matches', async () => {
      const pages = [
        createMockPage({ path: 'docs/auth', title: 'Authentication Guide', content: 'Basic info' }),
        createMockPage({ path: 'other/page', title: 'Other Page', content: 'authentication details here' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await searchWikiTool.execute({ query: 'authentication' }, context);

      // Title match should appear first
      const titleMatchPos = result.indexOf('Authentication Guide');
      const contentMatchPos = result.indexOf('Other Page');
      assert.ok(titleMatchPos < contentMatchPos, 'Title match should rank higher');
    });
  });

  describe('read_page', () => {
    it('reads page content by exact path', async () => {
      const pages = [
        createMockPage({
          path: 'architecture/cqrs',
          title: 'CQRS Pattern',
          content: 'Full explanation of CQRS...',
          confidence: 0.9,
        }),
      ];
      const context: WikiToolContext = { pages };

      const result = await readPageTool.execute({ path: 'architecture/cqrs' }, context);

      assert.ok(result.includes('CQRS Pattern'), 'Should include title');
      assert.ok(result.includes('Full explanation'), 'Should include content');
      assert.ok(result.includes('90%'), 'Should include confidence');
    });

    it('reads page by partial path match', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs-pattern', title: 'CQRS' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await readPageTool.execute({ path: 'cqrs' }, context);

      assert.ok(result.includes('CQRS'), 'Should find page by partial match');
    });

    it('suggests similar pages when not found', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs', title: 'CQRS' }),
        createMockPage({ path: 'architecture/events', title: 'Events' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await readPageTool.execute({ path: 'architecture/nonexistent' }, context);

      assert.ok(result.includes('not found'), 'Should indicate not found');
      assert.ok(result.includes('architecture/cqrs'), 'Should suggest similar pages');
    });

    it('includes links and backlinks in metadata', async () => {
      const pages = [
        createMockPage({
          path: 'architecture/cqrs',
          title: 'CQRS',
          links: ['architecture/events', 'guides/setup'],
          backlinks: ['overview'],
        }),
      ];
      const context: WikiToolContext = { pages };

      const result = await readPageTool.execute({ path: 'architecture/cqrs' }, context);

      assert.ok(result.includes('Links to:'), 'Should show outgoing links');
      assert.ok(result.includes('Linked from:'), 'Should show incoming links');
    });

    it('truncates very long content', async () => {
      const longContent = 'x'.repeat(5000);
      const pages = [
        createMockPage({ path: 'long', title: 'Long Page', content: longContent }),
      ];
      const context: WikiToolContext = { pages, maxContentLength: 1000 };

      const result = await readPageTool.execute({ path: 'long' }, context);

      assert.ok(result.includes('truncated'), 'Should indicate truncation');
      assert.ok(result.length < longContent.length, 'Should be shorter than original');
    });
  });

  describe('list_pages', () => {
    it('lists all pages grouped by category', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs', title: 'CQRS' }),
        createMockPage({ path: 'architecture/events', title: 'Events' }),
        createMockPage({ path: 'guides/setup', title: 'Setup' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await listPagesTool.execute({}, context);

      assert.ok(result.includes('3 pages'), 'Should show total count');
      assert.ok(result.includes('architecture/'), 'Should group by category');
      assert.ok(result.includes('guides/'), 'Should show all categories');
    });

    it('filters by category when specified', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs', title: 'CQRS' }),
        createMockPage({ path: 'guides/setup', title: 'Setup' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await listPagesTool.execute({ category: 'architecture' }, context);

      assert.ok(result.includes('CQRS'), 'Should include matching category');
      assert.ok(!result.includes('Setup'), 'Should exclude other categories');
    });

    it('handles empty wiki', async () => {
      const context: WikiToolContext = { pages: [] };

      const result = await listPagesTool.execute({}, context);

      assert.ok(result.includes('empty'), 'Should indicate wiki is empty');
    });

    it('handles category with no matches', async () => {
      const pages = [
        createMockPage({ path: 'architecture/cqrs', title: 'CQRS' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await listPagesTool.execute({ category: 'nonexistent' }, context);

      assert.ok(result.includes('No pages found'), 'Should indicate no matches');
    });
  });

  describe('get_related_pages', () => {
    it('returns links and backlinks for a page', async () => {
      const pages = [
        createMockPage({
          path: 'architecture/cqrs',
          title: 'CQRS Pattern',
          links: ['architecture/events'],
          backlinks: ['overview'],
        }),
        createMockPage({ path: 'architecture/events', title: 'Event System' }),
        createMockPage({ path: 'overview', title: 'Overview' }),
      ];
      const context: WikiToolContext = { pages };

      const result = await getRelatedPagesTool.execute({ path: 'architecture/cqrs' }, context);

      assert.ok(result.includes('Event System'), 'Should include linked page title');
      assert.ok(result.includes('Overview'), 'Should include backlinked page title');
    });

    it('handles page with no links', async () => {
      const pages = [
        createMockPage({ path: 'isolated', title: 'Isolated Page', links: [], backlinks: [] }),
      ];
      const context: WikiToolContext = { pages };

      const result = await getRelatedPagesTool.execute({ path: 'isolated' }, context);

      assert.ok(result.includes('(none)'), 'Should indicate no links');
    });

    it('returns error for nonexistent page', async () => {
      const context: WikiToolContext = { pages: [] };

      const result = await getRelatedPagesTool.execute({ path: 'nonexistent' }, context);

      assert.ok(result.includes('not found'), 'Should indicate page not found');
    });
  });
});
