/**
 * Unit tests for update-wiki-page command.
 * Tests title extraction and page update operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  extractTitle,
  extractTitleFromPath,
  extractTitleWithFallback,
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
    // Title is trimmed to remove leading/trailing whitespace
    const content = '#   Title With Spaces   \n\nContent';
    assert.strictEqual(extractTitle(content), 'Title With Spaces');
  });

  it('handles H1 with special characters', () => {
    const content = '# My Title: A Story (Part 1)\n\nContent';
    assert.strictEqual(extractTitle(content), 'My Title: A Story (Part 1)');
  });

  it('extracts title from H1 without space after # (lenient parsing)', () => {
    // LLMs sometimes generate `#Title` without a space - we handle this gracefully
    const content = '#NoSpaceTitle\n\nContent';
    assert.strictEqual(extractTitle(content), 'NoSpaceTitle');
  });

  it('extracts title from H1 with zero spaces after #', () => {
    const content = '#ZeroSpaceTitle\n\nSome content here.';
    assert.strictEqual(extractTitle(content), 'ZeroSpaceTitle');
  });

  it('returns Untitled when H1 has only whitespace after #', () => {
    const content = '#    \n\nContent';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });
});

describe('extractTitleFromPath', () => {
  it('extracts title from simple path', () => {
    assert.strictEqual(extractTitleFromPath('overview'), 'Overview');
  });

  it('extracts title from path with directory', () => {
    assert.strictEqual(extractTitleFromPath('architecture/overview'), 'Overview');
  });

  it('converts hyphens to spaces and capitalizes', () => {
    assert.strictEqual(extractTitleFromPath('architecture/cqrs-pattern'), 'Cqrs Pattern');
  });

  it('handles deep paths', () => {
    assert.strictEqual(extractTitleFromPath('docs/guides/getting-started'), 'Getting Started');
  });

  it('returns Untitled for empty path', () => {
    assert.strictEqual(extractTitleFromPath(''), 'Untitled');
  });

  it('handles path ending with slash', () => {
    // Split on '/' and pop returns empty string
    assert.strictEqual(extractTitleFromPath('test/'), 'Untitled');
  });
});

describe('extractTitleWithFallback', () => {
  it('extracts title from content when H1 exists', () => {
    const content = '# My Page Title\n\nContent here.';
    assert.strictEqual(extractTitleWithFallback(content, 'test/page'), 'My Page Title');
  });

  it('falls back to path when no H1 in content', () => {
    const content = 'No heading here, just text.';
    assert.strictEqual(extractTitleWithFallback(content, 'architecture/system-design'), 'System Design');
  });

  it('prefers content H1 over path-based title', () => {
    const content = '# Explicit Title\n\nContent.';
    assert.strictEqual(extractTitleWithFallback(content, 'different/path-name'), 'Explicit Title');
  });

  it('falls back to path for empty content', () => {
    assert.strictEqual(extractTitleWithFallback('', 'test/my-page'), 'My Page');
  });

  it('handles H1 without space (lenient) before falling back', () => {
    const content = '#DirectTitle\n\nContent.';
    assert.strictEqual(extractTitleWithFallback(content, 'fallback/path'), 'DirectTitle');
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
    updateLinks: async () => {},
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

    it('falls back to path-based title when no H1 and no title provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'architecture/system-design',
        content: 'No heading here, just text.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Falls back to title derived from path
      assert.strictEqual(result.data?.title, 'System Design');
    });

    it('extracts title from H1 without space (lenient parsing)', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: '#NoSpaceTitle\n\nContent without space after hash.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'NoSpaceTitle');
    });

    it('applies confidenceDelta when creating a page', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/high-confidence',
        content: '# High Confidence Page\n\nContent here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5, // Should result in 0.5 (base) + 0.5 = 1.0
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Base confidence is 0.5, plus delta of 0.5 should give 1.0
      assert.strictEqual(result.data?.confidence, 1.0);
    });

    it('caps confidence at 1.0 when delta exceeds maximum', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/over-confidence',
        content: '# Very High Confidence Page\n\nContent here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.8, // 0.5 + 0.8 = 1.3, should cap at 1.0
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 1.0);
    });

    it('applies small confidenceDelta correctly', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/low-confidence',
        content: '# Low Confidence Page\n\nContent here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1, // Should result in 0.5 + 0.1 = 0.6
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 0.6);
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

    it('falls back to path-based title when updated content has no H1', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'guides/quick-start',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with content that has no H1
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'guides/quick-start',
        content: 'No heading in this update.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Falls back to path-based title instead of 'Untitled'
      assert.strictEqual(result.data?.title, 'Quick Start');
    });
  });

  describe('merge operation', () => {
    it('applies confidenceDelta when merge creates a new page', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/merge-new',
        content: '# Merge Created Page\n\nContent here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.3, // Should result in 0.5 + 0.3 = 0.8
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 0.8);
    });

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
