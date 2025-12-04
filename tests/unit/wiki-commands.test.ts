/**
 * Unit tests for Wiki CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createUpdateWikiSettingsCommand,
  handleUpdateWikiSettings,
  createDeleteWikiCommand,
  handleDeleteWiki,
  createIncrementWikiIterationsCommand,
  handleIncrementWikiIterations,
} from '../../src/commands/wiki.js';
import { createWiki, type Wiki, type WikiStatus } from '../../src/domain/wiki.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const wikis = new Map<string, Wiki>();
  const wikiPages = new Map<string, WikiPage>();

  const mockWikis: Repositories['wikis'] = {
    findById: async (id) => wikis.get(id) ?? null,
    findBySlug: async (repoId, slug) => {
      for (const wiki of wikis.values()) {
        if (wiki.repoId === repoId && wiki.slug === slug) return wiki;
      }
      return null;
    },
    findByRepo: async (repoId) => {
      return Array.from(wikis.values()).filter(w => w.repoId === repoId);
    },
    findActive: async (repoId) => {
      for (const wiki of wikis.values()) {
        if (wiki.repoId === repoId && wiki.isActive) return wiki;
      }
      return null;
    },
    findByStatus: async () => [],
    save: async (wiki) => { wikis.set(wiki.id, wiki); },
    delete: async (id) => { wikis.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, wiki] of wikis) {
        if (wiki.repoId === repoId) wikis.delete(id);
      }
    },
    setActive: async (id) => {
      const wiki = wikis.get(id);
      if (wiki) {
        // Deactivate others
        for (const w of wikis.values()) {
          if (w.repoId === wiki.repoId && w.id !== id) w.isActive = false;
        }
        wiki.isActive = true;
      }
    },
    updateStatus: async (id, status) => {
      const wiki = wikis.get(id);
      if (wiki) wiki.status = status;
    },
    updateLastProcessedCommit: async (id, sha) => {
      const wiki = wikis.get(id);
      if (wiki) wiki.lastProcessedCommitSha = sha;
    },
    incrementIterations: async (id, count) => {
      const wiki = wikis.get(id);
      if (wiki) {
        wiki.totalIterations = (wiki.totalIterations ?? 0) + count;
      }
    },
  };

  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async (id) => wikiPages.get(id) ?? null,
    findByPath: async () => null,
    findByWiki: async (wikiId) => {
      return Array.from(wikiPages.values()).filter(p => p.wikiId === wikiId);
    },
    findByStatus: async () => [],
    countByWiki: async (wikiId) => {
      return Array.from(wikiPages.values()).filter(p => p.wikiId === wikiId).length;
    },
    search: async () => [],
    save: async (page) => { wikiPages.set(page.id, page); },
    delete: async (id) => { wikiPages.delete(id); },
    deleteByWiki: async (wikiId) => {
      for (const [id, page] of wikiPages) {
        if (page.wikiId === wikiId) wikiPages.delete(id);
      }
    },
    bulkUpdateStatus: async () => {},
  };

  return {
    wikis: mockWikis,
    wikiPages: mockWikiPages,
  } as Repositories;
}

describe('Wiki Commands', () => {
  describe('UpdateWikiSettings', () => {
    it('updates wiki name and description', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Original Name',
        description: 'Original description',
      });
      await repos.wikis.save(wiki);

      const command = createUpdateWikiSettingsCommand(wikiId, {
        name: 'New Name',
        description: 'New description',
      });
      const result = await handleUpdateWikiSettings(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.wikis.findById(wikiId);
      assert.strictEqual(updated?.name, 'New Name');
      assert.strictEqual(updated?.description, 'New description');
    });

    it('updates branch filter', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
      });
      await repos.wikis.save(wiki);

      const command = createUpdateWikiSettingsCommand(wikiId, {
        branchFilter: 'develop',
      });
      const result = await handleUpdateWikiSettings(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.wikis.findById(wikiId);
      assert.strictEqual(updated?.branchFilter, 'develop');
    });

    it('updates path filters', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
      });
      await repos.wikis.save(wiki);

      const command = createUpdateWikiSettingsCommand(wikiId, {
        pathFilters: ['src/**', 'lib/**'],
      });
      const result = await handleUpdateWikiSettings(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.wikis.findById(wikiId);
      assert.deepStrictEqual(updated?.pathFilters, ['src/**', 'lib/**']);
    });

    it('updates config settings', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
      });
      await repos.wikis.save(wiki);

      const command = createUpdateWikiSettingsCommand(wikiId, {
        config: {
          confidenceThreshold: 0.8,
          autoPublish: false,
          enabledAgents: ['code-change', 'link'],
        },
      });
      const result = await handleUpdateWikiSettings(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.wikis.findById(wikiId);
      assert.strictEqual(updated?.config.confidenceThreshold, 0.8);
      assert.strictEqual(updated?.config.autoPublish, false);
      assert.deepStrictEqual(updated?.config.enabledAgents, ['code-change', 'link']);
    });

    it('fails when wiki does not exist', async () => {
      const repos = createMockRepos();

      const command = createUpdateWikiSettingsCommand('nonexistent', {
        name: 'New Name',
      });
      const result = await handleUpdateWikiSettings(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createUpdateWikiSettingsCommand('wiki-1', {
        name: 'Test',
      });
      assert.strictEqual(command.type, 'UpdateWikiSettings');
      assert.strictEqual(command.wikiId, 'wiki-1');
    });
  });

  describe('DeleteWiki', () => {
    it('deletes a non-active wiki', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
        isActive: false,
      });
      await repos.wikis.save(wiki);

      const command = createDeleteWikiCommand(wikiId);
      const result = await handleDeleteWiki(command, repos);

      assert.strictEqual(result.success, true);

      const deleted = await repos.wikis.findById(wikiId);
      assert.strictEqual(deleted, null);
    });

    it('deletes associated wiki pages', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
        isActive: false,
      });
      await repos.wikis.save(wiki);

      // Create some pages
      const page1: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'test/page1',
        title: 'Page 1',
        content: 'Content 1',
        summary: '',
        confidence: 0.8,
        lastUpdatedBy: 'code-change',
        lastCommitSha: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repos.wikiPages.save(page1);

      // Verify page exists
      const pagesBefore = await repos.wikiPages.findByWiki(wikiId);
      assert.strictEqual(pagesBefore.length, 1);

      const command = createDeleteWikiCommand(wikiId);
      const result = await handleDeleteWiki(command, repos);

      assert.strictEqual(result.success, true);

      // Verify pages are deleted
      const pagesAfter = await repos.wikiPages.findByWiki(wikiId);
      assert.strictEqual(pagesAfter.length, 0);
    });

    it('succeeds when wiki is active', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
        isActive: true,
      });
      await repos.wikis.save(wiki);

      const command = createDeleteWikiCommand(wikiId);
      const result = await handleDeleteWiki(command, repos);

      assert.strictEqual(result.success, true);

      // Wiki should be deleted
      const existing = await repos.wikis.findById(wikiId);
      assert.strictEqual(existing, null);
    });

    it('fails when wiki does not exist', async () => {
      const repos = createMockRepos();

      const command = createDeleteWikiCommand('nonexistent');
      const result = await handleDeleteWiki(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createDeleteWikiCommand('wiki-1');
      assert.strictEqual(command.type, 'DeleteWiki');
      assert.strictEqual(command.wikiId, 'wiki-1');
    });
  });

  describe('IncrementWikiIterations', () => {
    it('increments iteration count from zero', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
      });
      await repos.wikis.save(wiki);

      const command = createIncrementWikiIterationsCommand(wikiId, 10);
      const result = await handleIncrementWikiIterations(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.wikis.findById(wikiId);
      assert.strictEqual(updated?.totalIterations, 10);
    });

    it('accumulates iteration count across multiple increments', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const wiki = createWiki({
        id: wikiId,
        repoId: 'repo-1',
        name: 'Test Wiki',
      });
      await repos.wikis.save(wiki);

      // First increment: 20 iterations
      await handleIncrementWikiIterations(
        createIncrementWikiIterationsCommand(wikiId, 20),
        repos
      );

      // Second increment: 30 iterations
      await handleIncrementWikiIterations(
        createIncrementWikiIterationsCommand(wikiId, 30),
        repos
      );

      const updated = await repos.wikis.findById(wikiId);
      assert.strictEqual(updated?.totalIterations, 50);
    });

    it('fails when wiki does not exist', async () => {
      const repos = createMockRepos();

      const command = createIncrementWikiIterationsCommand('nonexistent', 10);
      const result = await handleIncrementWikiIterations(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createIncrementWikiIterationsCommand('wiki-1', 15);
      assert.strictEqual(command.type, 'IncrementWikiIterations');
      assert.strictEqual(command.wikiId, 'wiki-1');
      assert.strictEqual(command.count, 15);
    });
  });
});
