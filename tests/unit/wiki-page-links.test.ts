/**
 * Unit tests for wiki page links functionality.
 * Tests link array population through WikiPageUpdate and repository operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import { createWikiPage, type WikiPage, type WikiPageUpdate } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create a minimal mock repositories object for testing page links
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
    addBacklink: async (pageId, linkingPagePath) => {
      const page = pages.get(pageId);
      if (page && !page.backlinks.includes(linkingPagePath)) {
        page.backlinks.push(linkingPagePath);
      }
    },
    removeBacklink: async (pageId, linkingPagePath) => {
      const page = pages.get(pageId);
      if (page) {
        page.backlinks = page.backlinks.filter(l => l !== linkingPagePath);
      }
    },
    updateLinks: async (id, links) => {
      const page = pages.get(id);
      if (page) {
        page.links = links;
      }
    },
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

describe('WikiPageUpdate links field', () => {
  it('should accept a links array in WikiPageUpdate', () => {
    // This test verifies the WikiPageUpdate interface has the links field
    const update: WikiPageUpdate = {
      type: 'merge',
      path: 'test/page',
      content: '## Related Pages\n\n- [Other Page](other/page)',
      agentRunId: 'agent-1',
      confidenceDelta: 0.05,
      links: ['other/page', 'another/page'],
    };

    assert.ok(Array.isArray(update.links));
    assert.strictEqual(update.links!.length, 2);
  });
});

describe('handleUpdateWikiPage with links', () => {
  describe('merge operation with links', () => {
    it('should update page links array when links provided in merge update', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page with empty links
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/source-page',
        title: 'Source Page',
        content: '# Source Page\n\nThis page has some content.',
      });
      repos._pages.set(pageId, initialPage);

      // Verify initial state has empty links
      assert.deepStrictEqual(initialPage.links, []);

      // Create target pages that will be linked to
      const targetPage1 = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'test/target-1',
        title: 'Target 1',
        content: '# Target 1\n\nTarget content.',
      });
      const targetPage2 = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'test/target-2',
        title: 'Target 2',
        content: '# Target 2\n\nTarget content.',
      });
      repos._pages.set(targetPage1.id, targetPage1);
      repos._pages.set(targetPage2.id, targetPage2);

      // Merge update with links
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/source-page',
        content: '\n\n## Related Pages\n\n- [Target 1](test/target-1) - Related content\n- [Target 2](test/target-2) - More related content',
        agentRunId: 'link-agent-1',
        confidenceDelta: 0.05,
        links: ['test/target-1', 'test/target-2'],
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // The key assertion: links array should be populated
      const updatedPage = repos._pages.get(pageId)!;
      assert.deepStrictEqual(updatedPage.links, ['test/target-1', 'test/target-2']);
    });

    it('should add backlinks to target pages when links are created', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const sourcePageId = uuid();
      const targetPageId = uuid();

      // Create source page
      const sourcePage = createWikiPage({
        id: sourcePageId,
        wikiId,
        path: 'source/page',
        title: 'Source Page',
        content: '# Source Page\n\nContent.',
      });
      repos._pages.set(sourcePageId, sourcePage);

      // Create target page
      const targetPage = createWikiPage({
        id: targetPageId,
        wikiId,
        path: 'target/page',
        title: 'Target Page',
        content: '# Target Page\n\nContent.',
      });
      repos._pages.set(targetPageId, targetPage);

      // Verify initial state
      assert.deepStrictEqual(targetPage.backlinks, []);

      // Merge update that links source -> target
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'source/page',
        content: '\n\n## Related Pages\n\n- [Target Page](target/page)',
        agentRunId: 'link-agent-1',
        confidenceDelta: 0.05,
        links: ['target/page'],
      });

      await handleUpdateWikiPage(command, repos, wikiId);

      // Target page should now have source page in its backlinks
      const updatedTargetPage = repos._pages.get(targetPageId)!;
      assert.ok(updatedTargetPage.backlinks.includes('source/page'));
    });
  });

  describe('create operation with links', () => {
    it('should set links array when creating page with links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create a target page first
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'existing/target',
        title: 'Existing Target',
        content: '# Existing Target\n\nContent.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Create new page with links
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'new/page',
        content: '# New Page\n\nContent.\n\n## Related Pages\n\n- [Existing Target](existing/target)',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        links: ['existing/target'],
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data?.links, ['existing/target']);
    });
  });

  describe('update operation with links', () => {
    it('should replace links array when updating page with new links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create page with existing links
      const page = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Test Page',
        content: '# Test Page\n\nContent.',
      });
      page.links = ['old/link'];
      repos._pages.set(pageId, page);

      // Update with new links
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        content: '# Test Page\n\nUpdated content.\n\n## Related\n\n- [New Link](new/link)',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
        links: ['new/link'],
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;
      assert.deepStrictEqual(updatedPage.links, ['new/link']);
    });
  });
});

describe('Repository updateLinks method', () => {
  it('should update links array on page', async () => {
    const repos = createMockRepos();
    const pageId = uuid();
    const wikiId = uuid();

    const page = createWikiPage({
      id: pageId,
      wikiId,
      path: 'test/page',
      title: 'Test',
      content: '# Test\n\nContent.',
    });
    repos._pages.set(pageId, page);

    // Verify initial empty links
    assert.deepStrictEqual(page.links, []);

    // Update links
    await repos.wikiPages.updateLinks(pageId, ['link/one', 'link/two']);

    const updated = repos._pages.get(pageId)!;
    assert.deepStrictEqual(updated.links, ['link/one', 'link/two']);
  });

  it('should replace existing links with new ones', async () => {
    const repos = createMockRepos();
    const pageId = uuid();
    const wikiId = uuid();

    const page = createWikiPage({
      id: pageId,
      wikiId,
      path: 'test/page',
      title: 'Test',
      content: '# Test\n\nContent.',
    });
    page.links = ['old/link'];
    repos._pages.set(pageId, page);

    await repos.wikiPages.updateLinks(pageId, ['new/link-1', 'new/link-2']);

    const updated = repos._pages.get(pageId)!;
    assert.deepStrictEqual(updated.links, ['new/link-1', 'new/link-2']);
  });
});
