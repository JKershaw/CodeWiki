/**
 * Unit tests for update-wiki-page command.
 * Tests title extraction and page update operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  extractTitle,
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import { createWikiPage, type WikiPage } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';

describe('extractTitle', () => {
  it('extracts title from H1 heading at start of content', () => {
    const content = '# My Page Title\n\nSome content here.';
    assert.strictEqual(extractTitle(content), 'My Page Title');
  });

  it('extracts title from H1 heading not at start of content', () => {
    const content = 'Some intro text\n\n# The Real Title\n\nMore content.';
    assert.strictEqual(extractTitle(content), 'The Real Title');
  });

  it('returns Untitled when no H1 heading exists', () => {
    const content = 'No heading here, just text.';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });

  it('returns Untitled for empty content', () => {
    assert.strictEqual(extractTitle(''), 'Untitled');
  });

  it('ignores H2 and lower headings', () => {
    const content = '## H2 Heading\n\n### H3 Heading';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });

  it('extracts first H1 when multiple exist', () => {
    const content = '# First Title\n\n# Second Title';
    assert.strictEqual(extractTitle(content), 'First Title');
  });

  it('handles H1 with extra whitespace', () => {
    // Regex `^#\s+(.+)$` consumes whitespace after #, captures the rest
    const content = '#   Title With Spaces   \n\nContent';
    assert.strictEqual(extractTitle(content), 'Title With Spaces   ');
  });

  it('handles H1 with special characters', () => {
    const content = '# My Title: A Story (Part 1)\n\nContent';
    assert.strictEqual(extractTitle(content), 'My Title: A Story (Part 1)');
  });
});

// Create a minimal mock repositories object for testing page updates
function createMockRepos(): Repositories & { _pages: Map<string, WikiPage> } {
  const pages = new Map<string, WikiPage>();
  const histories: unknown[] = [];

  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async (id) => pages.get(id) ?? null,
    findByPath: async (wikiId, path) => {
      for (const page of pages.values()) {
        if (page.wikiId === wikiId && page.path === path) return page;
      }
      return null;
    },
    findByWiki: async (wikiId) => {
      return Array.from(pages.values()).filter(p => p.wikiId === wikiId);
    },
    findLowConfidence: async () => [],
    findRecentlyUpdated: async () => [],
    search: async () => [],
    save: async (page) => { pages.set(page.id, page); },
    delete: async (id) => { pages.delete(id); },
    deleteByWiki: async () => {},
    updateContent: async (id, updates) => {
      const page = pages.get(id);
      if (page) {
        page.content = updates.content;
        if (updates.title !== undefined) {
          page.title = updates.title;
        }
        if (updates.confidence !== undefined) {
          page.confidence = updates.confidence;
        }
        page.updatedAt = new Date();
      }
    },
    addBacklink: async () => {},
    removeBacklink: async () => {},
  };

  const mockWikiPageHistory: Repositories['wikiPageHistory'] = {
    save: async (history) => { histories.push(history); },
    findById: async () => null,
    findByPage: async () => [],
    findByWiki: async () => [],
    findByAgentRun: async () => [],
    deleteByWiki: async () => {},
    getNextSequenceNumber: async () => histories.length + 1,
  };

  return {
    wikiPages: mockWikiPages,
    wikiPageHistory: mockWikiPageHistory,
    _pages: pages,
  } as Repositories & { _pages: Map<string, WikiPage> };
}

describe('handleUpdateWikiPage', () => {
  describe('create operation', () => {
    it('extracts title from content when title not provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: '# Auto Extracted Title\n\nPage content here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Auto Extracted Title');
    });

    it('uses provided title instead of extracting', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        title: 'Explicit Title',
        content: '# Content Title\n\nPage content here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Explicit Title');
    });

    it('falls back to Untitled when no H1 and no title provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: 'No heading here, just text.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Untitled');
    });
  });

  describe('update operation', () => {
    it('updates title when content changes', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with new content that has different H1
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        content: '# New Updated Title\n\nUpdated content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'New Updated Title');
    });

    it('uses explicit title on update when provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with explicit title
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        title: 'Explicit Override Title',
        content: '# Content Title\n\nUpdated content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Explicit Override Title');
    });

    it('sets title to Untitled when content has no H1', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with content that has no H1
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        content: 'No heading in this update.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Untitled');
    });
  });

  describe('merge operation', () => {
    it('creates page with extracted title when page does not exist', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/new-page',
        content: '# Merged Page Title\n\nMerged content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Merged Page Title');
    });

    it('extracts title from merged content when page exists', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page with a title
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Merge additional content (merged content will have original H1 first)
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '## Additional Section\n\nMore content here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // The merged content keeps the original H1, so title should be "Original Title"
      assert.strictEqual(result.data?.title, 'Original Title');
    });
  });
});
