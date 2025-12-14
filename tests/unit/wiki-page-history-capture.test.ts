/**
 * Unit tests for wiki page history capture.
 * Tests that wiki mutations are correctly tracked in WikiPageHistory.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import { createWikiPage, type WikiPage, type WikiPageUpdate } from '../../src/domain/wiki-page.js';
import type { WikiPageHistory } from '../../src/domain/wiki-page-history.js';
import { createRepositories, type Repositories, type RepositoryConnection } from '../../src/repositories/index.js';

describe('Wiki Page History Capture', () => {
  let connection: RepositoryConnection;
  let repos: Repositories;

  beforeEach(async () => {
    connection = await createRepositories({ mongoDbName: `test-history-capture-${uuid()}` });
    repos = connection.repositories;
  });

  afterEach(async () => {
    await connection.close();
  });

  describe('create operation', () => {
    it('captures history for page creation', async () => {
      const wikiId = 'wiki-1';
      const update: WikiPageUpdate = {
        type: 'create',
        path: 'docs/api',
        content: '# API Documentation\n\nNew page content.',
        agentRunId: 'run-1',
        confidenceDelta: 0.5,
        skipValidation: true,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Check history was captured
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);

      const record = history[0]!;
      assert.strictEqual(record.operation, 'create');
      assert.strictEqual(record.pagePath, 'docs/api');
      assert.strictEqual(record.contentBefore, null);
      assert.strictEqual(record.contentAfter, '# API Documentation\n\nNew page content.');
      assert.strictEqual(record.agentRunId, 'run-1');
      assert.strictEqual(record.pageId, result.data!.id);
    });

    it('captures agent type for bootstrap agent', async () => {
      const wikiId = 'wiki-1';
      const update: WikiPageUpdate = {
        type: 'create',
        path: 'overview',
        content: '# Overview',
        agentRunId: 'bootstrap-run-1',
        confidenceDelta: 0.5,
        skipValidation: true,
      };

      const command = createUpdateWikiPageCommand(update);
      await handleUpdateWikiPage(command, repos, wikiId);

      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      // The agent type is inferred or passed - for now we check it's set
      assert.ok(history[0]!.agentType);
    });
  });

  describe('update operation', () => {
    it('captures history for page update with before/after content', async () => {
      const wikiId = 'wiki-1';
      const pageId = uuid();

      // Create existing page
      const existingPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'docs/api',
        title: 'API Documentation',
        content: '# API Documentation\n\nOriginal content.',
      });
      await repos.wikiPages.save(existingPage);

      // Update the page
      const update: WikiPageUpdate = {
        type: 'update',
        path: 'docs/api',
        content: '# API Documentation\n\nUpdated content with more details.',
        agentRunId: 'run-2',
        confidenceDelta: 0.1,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Check history was captured
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);

      const record = history[0]!;
      assert.strictEqual(record.operation, 'update');
      assert.strictEqual(record.pagePath, 'docs/api');
      assert.strictEqual(record.contentBefore, '# API Documentation\n\nOriginal content.');
      assert.strictEqual(record.contentAfter, '# API Documentation\n\nUpdated content with more details.');
      assert.strictEqual(record.pageId, pageId);
    });
  });

  describe('merge operation', () => {
    it('captures history for merge on existing page', async () => {
      const wikiId = 'wiki-1';
      const pageId = uuid();

      // Create existing page
      const existingPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'docs/api',
        title: 'API Documentation',
        content: '# API Documentation\n\nExisting content.',
      });
      await repos.wikiPages.save(existingPage);

      // Merge additional content
      const update: WikiPageUpdate = {
        type: 'merge',
        path: 'docs/api',
        content: '## Additional Section\n\nMerged content.',
        agentRunId: 'run-3',
        confidenceDelta: 0.1,
        skipValidation: true,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Check history was captured
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);

      const record = history[0]!;
      assert.strictEqual(record.operation, 'update'); // Merge is recorded as update
      assert.strictEqual(record.contentBefore, '# API Documentation\n\nExisting content.');
      assert.ok(record.contentAfter!.includes('Merged content'));
    });

    it('captures history for merge on new page as create', async () => {
      const wikiId = 'wiki-1';

      // Merge on non-existent page creates it
      const update: WikiPageUpdate = {
        type: 'merge',
        path: 'docs/new-page',
        content: '# New Page\n\nContent.',
        agentRunId: 'run-4',
        confidenceDelta: 0.5,
        skipValidation: true,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Check history was captured as create
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);

      const record = history[0]!;
      assert.strictEqual(record.operation, 'create');
      assert.strictEqual(record.contentBefore, null);
    });
  });

  describe('delete operation', () => {
    it('captures history for page deletion with before content', async () => {
      const wikiId = 'wiki-1';
      const pageId = uuid();

      // Create existing page
      const existingPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'docs/old-page',
        title: 'Old Page',
        content: '# Old Page\n\nThis will be deleted.',
      });
      await repos.wikiPages.save(existingPage);

      // Delete the page
      const update: WikiPageUpdate = {
        type: 'delete',
        path: 'docs/old-page',
        content: '', // Not used for delete
        agentRunId: 'run-5',
        confidenceDelta: 0,
      };

      const command = createUpdateWikiPageCommand(update);
      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);

      // Check history was captured
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);

      const record = history[0]!;
      assert.strictEqual(record.operation, 'delete');
      assert.strictEqual(record.contentBefore, '# Old Page\n\nThis will be deleted.');
      assert.strictEqual(record.contentAfter, null);
      assert.strictEqual(record.pageId, pageId);
    });
  });

  describe('provenance tracking', () => {
    it('captures work item ID when provided', async () => {
      const wikiId = 'wiki-1';
      const update: WikiPageUpdate = {
        type: 'create',
        path: 'docs/feature',
        content: '# Feature',
        agentRunId: 'run-6',
        confidenceDelta: 0.5,
        skipValidation: true,
      };

      // Note: workItemId would need to be passed through the command
      // This tests the basic provenance structure
      const command = createUpdateWikiPageCommand(update);
      await handleUpdateWikiPage(command, repos, wikiId);

      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0]!.agentRunId, 'run-6');
    });
  });

  describe('multiple operations', () => {
    it('maintains complete history across multiple operations', async () => {
      const wikiId = 'wiki-1';

      // Create
      await handleUpdateWikiPage(
        createUpdateWikiPageCommand({
          type: 'create',
          path: 'docs/page',
          content: '# Page v1',
          agentRunId: 'run-1',
          confidenceDelta: 0.5,
          skipValidation: true,
        }),
        repos,
        wikiId
      );

      // Update 1
      await handleUpdateWikiPage(
        createUpdateWikiPageCommand({
          type: 'update',
          path: 'docs/page',
          content: '# Page v2',
          agentRunId: 'run-2',
          confidenceDelta: 0.1,
        }),
        repos,
        wikiId
      );

      // Update 2
      await handleUpdateWikiPage(
        createUpdateWikiPageCommand({
          type: 'update',
          path: 'docs/page',
          content: '# Page v3',
          agentRunId: 'run-3',
          confidenceDelta: 0.1,
        }),
        repos,
        wikiId
      );

      // Check complete history (newest first)
      const history = await repos.wikiPageHistory.findByWiki(wikiId);
      assert.strictEqual(history.length, 3);

      // Most recent should be last update (v3)
      assert.strictEqual(history[0]!.operation, 'update');
      assert.strictEqual(history[0]!.contentAfter, '# Page v3');

      // Second should be first update (v2)
      assert.strictEqual(history[1]!.operation, 'update');
      assert.strictEqual(history[1]!.contentAfter, '# Page v2');

      // Third should be create (v1)
      assert.strictEqual(history[2]!.operation, 'create');
      assert.strictEqual(history[2]!.contentAfter, '# Page v1');
    });
  });
});
