/**
 * Unit tests for WikiPageUpdate delete functionality.
 * Tests the new 'delete' update type in the UpdateWikiPage command.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { WikiPage, WikiPageUpdate } from '../../src/domain/wiki-page.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const wikiPages = new Map<string, WikiPage>();

  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async (id) => wikiPages.get(id) ?? null,
    findByPath: async (wikiId, path) => {
      for (const page of wikiPages.values()) {
        if (page.wikiId === wikiId && page.path === path) return page;
      }
      return null;
    },
    findByWiki: async (wikiId) => {
      return Array.from(wikiPages.values()).filter(p => p.wikiId === wikiId);
    },
    findLowConfidence: async () => [],
    findRecentlyUpdated: async () => [],
    search: async () => [],
    save: async (page) => { wikiPages.set(page.id, page); },
    delete: async (id) => { wikiPages.delete(id); },
    deleteByWiki: async (wikiId) => {
      for (const [id, page] of wikiPages) {
        if (page.wikiId === wikiId) wikiPages.delete(id);
      }
    },
    updateContent: async (id, updates) => {
      const page = wikiPages.get(id);
      if (page) {
        if (updates.content !== undefined) page.content = updates.content;
        if (updates.confidence !== undefined) page.confidence = updates.confidence;
        if (updates.sourceCommitId !== undefined) page.sourceCommitId = updates.sourceCommitId;
      }
    },
    addBacklink: async () => {},
    removeBacklink: async () => {},
  };

  return {
    wikiPages: mockWikiPages,
  } as Repositories;
}

describe('WikiPage Delete Command', () => {
  describe('delete update type', () => {
    it('deletes an existing page', async () => {
      const repos = createMockRepos();
      const wikiId = 'wiki-1';
      const pageId = uuid();

      // Create a page first
      const page: WikiPage = {
        id: pageId,
        wikiId,
        path: 'test/page-to-delete',
        title: 'Page to Delete',
        content: '# Page to Delete\n\nThis page will be deleted.',
        confidence: 0.8,
        sourceCommitId: 'commit-1',
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repos.wikiPages.save(page);

      // Delete the page
      const update: WikiPageUpdate = {
        type: 'delete',
        path: 'test/page-to-delete',
        content: '',
        sourceCommitId: 'commit-2',
        agentRunId: 'run-1',
        confidenceDelta: 0,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Verify page is deleted
      const deleted = await repos.wikiPages.findByPath(wikiId, 'test/page-to-delete');
      assert.strictEqual(deleted, null);
    });

    it('fails when page does not exist', async () => {
      const repos = createMockRepos();
      const wikiId = 'wiki-1';

      const update: WikiPageUpdate = {
        type: 'delete',
        path: 'nonexistent/page',
        content: '',
        sourceCommitId: 'commit-1',
        agentRunId: 'run-1',
        confidenceDelta: 0,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('updates links pointing to deleted page when redirectTo is specified', async () => {
      const repos = createMockRepos();
      const wikiId = 'wiki-1';

      // Create the page to be deleted
      const pageToDelete: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'old/page',
        title: 'Old Page',
        content: '# Old Page\n\nContent.',
        confidence: 0.8,
        sourceCommitId: 'commit-1',
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create a page that links to the page being deleted
      const linkingPage: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'other/page',
        title: 'Other Page',
        content: '# Other Page\n\nSee [Old Page](old/page.md) for more info.',
        confidence: 0.8,
        sourceCommitId: 'commit-1',
        links: ['old/page'],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create the new target page
      const newPage: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'new/page',
        title: 'New Page',
        content: '# New Page\n\nMerged content.',
        confidence: 0.9,
        sourceCommitId: 'commit-1',
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await repos.wikiPages.save(pageToDelete);
      await repos.wikiPages.save(linkingPage);
      await repos.wikiPages.save(newPage);

      // Delete with redirect
      const update: WikiPageUpdate = {
        type: 'delete',
        path: 'old/page',
        content: '',
        sourceCommitId: 'commit-2',
        agentRunId: 'run-1',
        confidenceDelta: 0,
        redirectTo: 'new/page',
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Verify the old page is deleted
      const deleted = await repos.wikiPages.findByPath(wikiId, 'old/page');
      assert.strictEqual(deleted, null);

      // Verify the linking page's content was updated
      const updatedLinkingPage = await repos.wikiPages.findByPath(wikiId, 'other/page');
      assert.ok(updatedLinkingPage);
      assert.ok(updatedLinkingPage.content.includes('new/page.md'));
      assert.ok(!updatedLinkingPage.content.includes('old/page.md'));
    });

    it('returns the deleted page in result for tracking', async () => {
      const repos = createMockRepos();
      const wikiId = 'wiki-1';
      const pageId = uuid();

      const page: WikiPage = {
        id: pageId,
        wikiId,
        path: 'test/tracked-delete',
        title: 'Tracked Delete',
        content: '# Tracked Delete\n\nContent.',
        confidence: 0.8,
        sourceCommitId: 'commit-1',
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repos.wikiPages.save(page);

      const update: WikiPageUpdate = {
        type: 'delete',
        path: 'test/tracked-delete',
        content: '',
        sourceCommitId: 'commit-2',
        agentRunId: 'run-1',
        confidenceDelta: 0,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // The deleted page should be returned in data for tracking
      assert.ok(result.data);
      assert.strictEqual(result.data.title, 'Tracked Delete');
    });
  });
});
