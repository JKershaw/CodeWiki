/**
 * Integration tests for Wiki Management API endpoints.
 * Tests the multi-wiki functionality through HTTP endpoints.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer, type Server } from 'http';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';

// We need to set up the Express app with test repositories
import express from 'express';
import { v4 as uuid } from 'uuid';
import { getOrCreateActiveWiki, handleCreateWiki, createCreateWikiCommand } from '../../src/commands/create-wiki.js';
import { handleSetActiveWiki, createSetActiveWikiCommand } from '../../src/commands/set-active-wiki.js';

describe('Wiki Management API', () => {
  let ctx: TestContext;
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ctx = await createTestContext();

    // Create Express app for testing
    app = express();
    app.use(express.json());

    // API Routes for wiki management

    /**
     * List all wikis for a repository.
     */
    app.get('/api/repos/:id/wikis', async (req, res) => {
      try {
        const repo = await ctx.repos.repos.findById(req.params.id!);
        if (!repo) {
          res.status(404).json({ error: 'Repository not found' });
          return;
        }

        const wikis = await ctx.repos.wikis.findByRepo(repo.id);
        res.json(wikis);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    /**
     * Create a new wiki for a repository.
     */
    app.post('/api/repos/:id/wikis', async (req, res) => {
      try {
        const repo = await ctx.repos.repos.findById(req.params.id!);
        if (!repo) {
          res.status(404).json({ error: 'Repository not found' });
          return;
        }

        const { name, description, branchFilter, pathFilters, setActive } = req.body;
        if (!name) {
          res.status(400).json({ error: 'Wiki name is required' });
          return;
        }

        const command = createCreateWikiCommand({
          repoId: repo.id,
          name,
          description,
          branchFilter,
          pathFilters,
          setActive: setActive ?? false, // Don't auto-activate new wikis
        });

        const result = await handleCreateWiki(command, ctx.repos);
        if (!result.success) {
          res.status(400).json({ error: result.error });
          return;
        }

        res.status(201).json(result.data);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    /**
     * Get a specific wiki.
     */
    app.get('/api/repos/:id/wikis/:wikiId', async (req, res) => {
      try {
        const wiki = await ctx.repos.wikis.findById(req.params.wikiId!);
        if (!wiki || wiki.repoId !== req.params.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }

        // Get wiki stats
        const pages = await ctx.repos.wikiPages.findByWiki(wiki.id);

        res.json({
          ...wiki,
          stats: {
            pageCount: pages.length,
            avgConfidence: pages.length > 0
              ? pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length
              : 0,
          },
        });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    /**
     * Update a wiki's settings.
     */
    app.put('/api/repos/:id/wikis/:wikiId', async (req, res) => {
      try {
        const wiki = await ctx.repos.wikis.findById(req.params.wikiId!);
        if (!wiki || wiki.repoId !== req.params.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }

        const { name, description, branchFilter, pathFilters } = req.body;

        // Update wiki fields
        const updatedWiki = {
          ...wiki,
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(branchFilter !== undefined ? { branchFilter } : {}),
          ...(pathFilters !== undefined ? { pathFilters } : {}),
          updatedAt: new Date(),
        };

        await ctx.repos.wikis.save(updatedWiki);
        res.json(updatedWiki);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    /**
     * Delete a wiki.
     */
    app.delete('/api/repos/:id/wikis/:wikiId', async (req, res) => {
      try {
        const wiki = await ctx.repos.wikis.findById(req.params.wikiId!);
        if (!wiki || wiki.repoId !== req.params.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }

        // Don't allow deleting the active wiki
        if (wiki.isActive) {
          res.status(400).json({ error: 'Cannot delete the active wiki. Set another wiki as active first.' });
          return;
        }

        // Delete wiki pages first
        await ctx.repos.wikiPages.deleteByWiki(wiki.id);
        await ctx.repos.wikis.delete(wiki.id);

        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    /**
     * Set a wiki as active.
     */
    app.post('/api/repos/:id/wikis/:wikiId/activate', async (req, res) => {
      try {
        const wiki = await ctx.repos.wikis.findById(req.params.wikiId!);
        if (!wiki || wiki.repoId !== req.params.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }

        const command = createSetActiveWikiCommand(wiki.id);
        const result = await handleSetActiveWiki(command, ctx.repos);

        if (!result.success) {
          res.status(400).json({ error: result.error });
          return;
        }

        res.json(result.data);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Start server on random port
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  describe('GET /api/repos/:id/wikis', () => {
    it('returns empty array when no wikis exist', async () => {
      const repoId = 'wikis-list-empty';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`);
      assert.strictEqual(response.status, 200);

      const wikis = await response.json();
      assert.ok(Array.isArray(wikis));
      assert.strictEqual(wikis.length, 0);
    });

    it('returns all wikis for a repository', async () => {
      const repoId = 'wikis-list-multiple';
      await createTestRepo(ctx, repoId);

      // Create two wikis
      await getOrCreateActiveWiki(repoId, ctx.repos); // Creates 'main' wiki

      const command = createCreateWikiCommand({
        repoId,
        name: 'api-docs',
        description: 'API Documentation',
        setActive: false,
      });
      await handleCreateWiki(command, ctx.repos);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`);
      assert.strictEqual(response.status, 200);

      const wikis = await response.json();
      assert.strictEqual(wikis.length, 2);
      assert.ok(wikis.some((w: any) => w.name === 'main'));
      assert.ok(wikis.some((w: any) => w.name === 'api-docs'));
    });

    it('returns 404 for non-existent repository', async () => {
      const response = await fetch(`${baseUrl}/api/repos/nonexistent/wikis`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/repos/:id/wikis', () => {
    it('creates a new wiki', async () => {
      const repoId = 'wikis-create';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'feature-docs',
          description: 'Documentation for new feature',
        }),
      });

      assert.strictEqual(response.status, 201);
      const wiki = await response.json();
      assert.strictEqual(wiki.name, 'feature-docs');
      assert.strictEqual(wiki.description, 'Documentation for new feature');
      assert.strictEqual(wiki.repoId, repoId);
    });

    it('creates a wiki with branch filter', async () => {
      const repoId = 'wikis-create-branch';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'v2-docs',
          branchFilter: 'release/v2',
        }),
      });

      assert.strictEqual(response.status, 201);
      const wiki = await response.json();
      assert.strictEqual(wiki.branchFilter, 'release/v2');
    });

    it('creates a wiki with path filters', async () => {
      const repoId = 'wikis-create-paths';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'api-only',
          pathFilters: ['src/api/**', 'docs/api/**'],
        }),
      });

      assert.strictEqual(response.status, 201);
      const wiki = await response.json();
      assert.deepStrictEqual(wiki.pathFilters, ['src/api/**', 'docs/api/**']);
    });

    it('returns 400 when name is missing', async () => {
      const repoId = 'wikis-create-noname';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'No name provided' }),
      });

      assert.strictEqual(response.status, 400);
    });

    it('returns 400 when slug already exists', async () => {
      const repoId = 'wikis-create-dupe';
      await createTestRepo(ctx, repoId);

      // Create first wiki
      await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'duplicate' }),
      });

      // Try to create another with same name
      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'duplicate' }),
      });

      assert.strictEqual(response.status, 400);
      const error = await response.json();
      assert.ok(error.error.includes('already exists'));
    });
  });

  describe('GET /api/repos/:id/wikis/:wikiId', () => {
    it('returns wiki details with stats', async () => {
      const repoId = 'wikis-get-detail';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add some pages
      await ctx.repos.wikiPages.save({
        id: uuid(),
        wikiId: wiki.id,
        path: 'test/page1',
        title: 'Test Page 1',
        content: '# Test',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`);
      assert.strictEqual(response.status, 200);

      const result = await response.json();
      assert.strictEqual(result.id, wiki.id);
      assert.strictEqual(result.name, 'main');
      assert.strictEqual(result.stats.pageCount, 1);
      assert.strictEqual(result.stats.avgConfidence, 0.8);
    });

    it('returns 404 for non-existent wiki', async () => {
      const repoId = 'wikis-get-notfound';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/nonexistent`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('PUT /api/repos/:id/wikis/:wikiId', () => {
    it('updates wiki name and description', async () => {
      const repoId = 'wikis-update';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'updated-main',
          description: 'Updated description',
        }),
      });

      assert.strictEqual(response.status, 200);
      const updated = await response.json();
      assert.strictEqual(updated.name, 'updated-main');
      assert.strictEqual(updated.description, 'Updated description');
    });

    it('updates branch filter', async () => {
      const repoId = 'wikis-update-branch';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchFilter: 'develop',
        }),
      });

      assert.strictEqual(response.status, 200);
      const updated = await response.json();
      assert.strictEqual(updated.branchFilter, 'develop');
    });
  });

  describe('DELETE /api/repos/:id/wikis/:wikiId', () => {
    it('deletes a non-active wiki', async () => {
      const repoId = 'wikis-delete';
      await createTestRepo(ctx, repoId);
      await getOrCreateActiveWiki(repoId, ctx.repos); // Creates active 'main' wiki

      // Create another wiki (not active)
      const createResponse = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'to-delete' }),
      });
      const wiki = await createResponse.json();

      // Delete it
      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`, {
        method: 'DELETE',
      });

      assert.strictEqual(response.status, 204);

      // Verify it's gone
      const checkResponse = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`);
      assert.strictEqual(checkResponse.status, 404);
    });

    it('returns 400 when deleting active wiki', async () => {
      const repoId = 'wikis-delete-active';
      await createTestRepo(ctx, repoId);
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${wiki.id}`, {
        method: 'DELETE',
      });

      assert.strictEqual(response.status, 400);
      const error = await response.json();
      assert.ok(error.error.includes('active'));
    });
  });

  describe('POST /api/repos/:id/wikis/:wikiId/activate', () => {
    it('activates a wiki and deactivates others', async () => {
      const repoId = 'wikis-activate';
      await createTestRepo(ctx, repoId);
      const mainWiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      assert.strictEqual(mainWiki.isActive, true);

      // Create another wiki
      const createResponse = await fetch(`${baseUrl}/api/repos/${repoId}/wikis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'secondary' }),
      });
      const secondaryWiki = await createResponse.json();
      assert.strictEqual(secondaryWiki.isActive, false);

      // Activate secondary
      const activateResponse = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${secondaryWiki.id}/activate`, {
        method: 'POST',
      });

      assert.strictEqual(activateResponse.status, 200);
      const activated = await activateResponse.json();
      assert.strictEqual(activated.isActive, true);

      // Verify main is now inactive
      const mainResponse = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/${mainWiki.id}`);
      const mainNow = await mainResponse.json();
      assert.strictEqual(mainNow.isActive, false);
    });

    it('returns 404 for non-existent wiki', async () => {
      const repoId = 'wikis-activate-notfound';
      await createTestRepo(ctx, repoId);

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/wikis/nonexistent/activate`, {
        method: 'POST',
      });

      assert.strictEqual(response.status, 404);
    });
  });
});
