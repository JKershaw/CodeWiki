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
        skipValidation: true,
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

  describe('merge operation links handling', () => {
    it('should merge links array when merging, not replace existing links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create page with existing links
      const page = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Test Page',
        content: '# Test Page\n\nContent.\n\n## Related\n\n- [Old Link](old/link)',
      });
      page.links = ['old/link', 'another/old'];
      repos._pages.set(pageId, page);

      // Create target page for backlink
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'new/link',
        title: 'New Link Target',
        content: '# New Link Target\n\nContent.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Merge with new links - should ADD to existing, not replace
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '\n\n- [New Link](new/link) - Added by link agent',
        agentRunId: 'link-agent-1',
        confidenceDelta: 0.05,
        links: ['new/link'],
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;

      // Should have BOTH old and new links
      assert.ok(updatedPage.links.includes('old/link'), 'Should preserve existing link');
      assert.ok(updatedPage.links.includes('another/old'), 'Should preserve another existing link');
      assert.ok(updatedPage.links.includes('new/link'), 'Should add new link');
      assert.strictEqual(updatedPage.links.length, 3, 'Should have all 3 links');
    });

    it('should not duplicate links when merging same link twice', async () => {
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
      page.links = ['existing/link'];
      repos._pages.set(pageId, page);

      // Merge with same link that already exists
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '\n\n- [Existing Link](existing/link) - Re-suggested',
        agentRunId: 'link-agent-1',
        confidenceDelta: 0.05,
        links: ['existing/link'],
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;

      // Should not have duplicate
      assert.strictEqual(updatedPage.links.length, 1, 'Should not duplicate links');
      assert.deepStrictEqual(updatedPage.links, ['existing/link']);
    });
  });
});

describe('Auto-extraction of links from content', () => {
  describe('create operation', () => {
    it('should auto-extract links from content when links not provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create a target page that will be linked to
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'architecture/auth',
        title: 'Auth Module',
        content: '# Auth Module\n\nAuthentication details.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Create new page WITH markdown links in content but WITHOUT explicit links array
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'guides/security',
        content: '# Security Guide\n\nFor authentication, see [Auth Module](architecture/auth). This guide covers security best practices and integration patterns for secure applications.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        // NOTE: no links: [] provided - should be auto-extracted
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // The key assertion: links should be auto-extracted from content
      assert.deepStrictEqual(result.data?.links, ['architecture/auth']);
    });

    it('should auto-extract multiple links from content', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create target pages
      const page1 = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'architecture/api',
        title: 'API',
        content: '# API\n\nAPI docs.',
      });
      const page2 = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'guides/testing',
        title: 'Testing',
        content: '# Testing\n\nTesting docs.',
      });
      repos._pages.set(page1.id, page1);
      repos._pages.set(page2.id, page2);

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'overview',
        content: '# Project Overview\n\nSee [API](architecture/api) and [Testing Guide](guides/testing) for more details. This document provides a comprehensive overview of the entire project structure.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        // No links provided
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.ok(result.data?.links.includes('architecture/api'));
      assert.ok(result.data?.links.includes('guides/testing'));
      assert.strictEqual(result.data?.links.length, 2);
    });

    it('should not override explicitly provided links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create target page
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'explicit/target',
        title: 'Explicit Target',
        content: '# Explicit Target\n\nContent.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Content has one link, but we explicitly provide a different links array
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: '# Test Page\n\nSee [Other Page](other/page) for info. This is comprehensive documentation that passes validation requirements.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        links: ['explicit/target'], // Explicitly provided - should be used as-is
        skipValidation: true,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Should use explicitly provided links, not auto-extracted
      assert.deepStrictEqual(result.data?.links, ['explicit/target']);
    });

    it('should create backlinks for auto-extracted links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create target page
      const targetPageId = uuid();
      const targetPage = createWikiPage({
        id: targetPageId,
        wikiId,
        path: 'target/page',
        title: 'Target Page',
        content: '# Target Page\n\nContent.',
      });
      repos._pages.set(targetPageId, targetPage);

      // Verify no backlinks initially
      assert.deepStrictEqual(targetPage.backlinks, []);

      // Create page with markdown link but no explicit links array
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'source/page',
        content: '# Source Page\n\nCheck out [Target Page](target/page) for details. This document contains comprehensive information about the topic.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        // No links provided - should auto-extract and create backlinks
      });

      await handleUpdateWikiPage(command, repos, wikiId);

      // Target page should now have backlink from source page
      const updatedTarget = repos._pages.get(targetPageId)!;
      assert.ok(updatedTarget.backlinks.includes('source/page'));
    });
  });

  describe('update operation', () => {
    it('should auto-extract links from updated content when links not provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page with no links
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Test Page',
        content: '# Test Page\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Create target page
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'new/target',
        title: 'New Target',
        content: '# New Target\n\nContent.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Update with content containing links but no explicit links array
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        content: '# Test Page\n\nUpdated to reference [New Target](new/target) now.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
        // No links provided
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;
      assert.deepStrictEqual(updatedPage.links, ['new/target']);
    });
  });

  describe('merge operation', () => {
    it('should auto-extract links from merged content when links not provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Test Page',
        content: '# Test Page\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Create target page
      const targetPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'related/page',
        title: 'Related Page',
        content: '# Related Page\n\nContent.',
      });
      repos._pages.set(targetPage.id, targetPage);

      // Merge content with links but no explicit links array
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '\n\n## Related\n\nSee also [Related Page](related/page).',
        agentRunId: 'agent-1',
        confidenceDelta: 0.05,
        // No links provided - should auto-extract from merged content
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;
      assert.ok(updatedPage.links.includes('related/page'));
    });

    it('should merge auto-extracted links with existing links', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page with existing links
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Test Page',
        content: '# Test Page\n\nOriginal with [Old Link](old/link).',
      });
      initialPage.links = ['old/link'];
      repos._pages.set(pageId, initialPage);

      // Create target page for new link
      const newTarget = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'new/link',
        title: 'New Link',
        content: '# New Link\n\nContent.',
      });
      repos._pages.set(newTarget.id, newTarget);

      // Merge content with new link, no explicit links array
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '\n\n## More\n\nAlso see [New Link](new/link).',
        agentRunId: 'agent-1',
        confidenceDelta: 0.05,
        // No links provided
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      const updatedPage = repos._pages.get(pageId)!;
      // Should have both old and new links
      assert.ok(updatedPage.links.includes('old/link'), 'Should keep existing link');
      assert.ok(updatedPage.links.includes('new/link'), 'Should add new auto-extracted link');
    });
  });

  describe('edge cases', () => {
    it('should handle content with no links gracefully', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/no-links',
        content: '# No Links Here\n\nJust plain text without any markdown links. This is comprehensive documentation that passes all validation requirements.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        // No links in content, none provided
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data?.links, []);
    });

    it('should ignore external URLs during auto-extraction', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create internal target
      const internalPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'internal/page',
        title: 'Internal',
        content: '# Internal\n\nContent.',
      });
      repos._pages.set(internalPage.id, internalPage);

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/mixed-links',
        content: '# Mixed Links\n\nSee [Internal](internal/page) and [External](https://example.com). This documentation provides comprehensive information about mixed linking strategies.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Should only have internal link, not external
      assert.deepStrictEqual(result.data?.links, ['internal/page']);
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
