/**
 * Wiki management routes.
 */

import { Router, type Request, type Response } from 'express';
import { handleCreateWiki, createCreateWikiCommand } from '../../commands/create-wiki.js';
import { handleSetActiveWiki, createSetActiveWikiCommand } from '../../commands/set-active-wiki.js';
import {
  createUpdateWikiSettingsCommand,
  handleUpdateWikiSettings,
  createDeleteWikiCommand,
  handleDeleteWiki,
} from '../../commands/wiki.js';
import type { Dependencies } from './index.js';

// Import CQRS queries
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createGetWikiQuery,
  handleGetWiki,
  createListWikisQuery,
  handleListWikis,
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';

/**
 * Create wiki management routes.
 */
export function createWikisRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * List all wikis for a repository.
   */
  router.get('/api/repos/:id/wikis', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Use CQRS query to list wikis
      const wikisQuery = createListWikisQuery(repo.id);
      const wikisResult = await handleListWikis(wikisQuery, repos);
      res.json(wikisResult.data || []);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Create a new wiki for a repository.
   */
  router.post('/api/repos/:id/wikis', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

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
        setActive: setActive ?? false,
      });

      const result = await handleCreateWiki(command, repos);
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
   * Get a specific wiki with stats.
   */
  router.get('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get wiki
      const wikiQuery = createGetWikiQuery(req.params.wikiId!);
      const wikiResult = await handleGetWiki(wikiQuery, repos);
      if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== req.params.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
      const wiki = wikiResult.data;

      // Use CQRS query to get wiki pages
      const pagesQuery = createListWikiPagesQuery(wiki.id);
      const pagesResult = await handleListWikiPages(pagesQuery, repos);
      const pages = pagesResult.data || [];

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
  router.put('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get wiki
      const wikiQuery = createGetWikiQuery(req.params.wikiId!);
      const wikiResult = await handleGetWiki(wikiQuery, repos);
      if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== req.params.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
      const wiki = wikiResult.data;

      const { name, description, branchFilter, pathFilters } = req.body;

      // Use UpdateWikiSettings CQRS command
      const result = await handleUpdateWikiSettings(
        createUpdateWikiSettingsCommand(wiki.id, {
          name,
          description,
          branchFilter,
          pathFilters,
        }),
        repos
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      // Fetch updated wiki via CQRS query
      const updatedWikiQuery = createGetWikiQuery(wiki.id);
      const updatedWikiResult = await handleGetWiki(updatedWikiQuery, repos);
      res.json(updatedWikiResult.data);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Delete a wiki.
   */
  router.delete('/api/repos/:id/wikis/:wikiId', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get wiki
      const wikiQuery = createGetWikiQuery(req.params.wikiId!);
      const wikiResult = await handleGetWiki(wikiQuery, repos);
      if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== req.params.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
      const wiki = wikiResult.data;

      // Use DeleteWiki CQRS command (handles active check and page deletion)
      const result = await handleDeleteWiki(
        createDeleteWikiCommand(wiki.id),
        repos
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Set a wiki as active.
   */
  router.post('/api/repos/:id/wikis/:wikiId/activate', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get wiki
      const wikiQuery = createGetWikiQuery(req.params.wikiId!);
      const wikiResult = await handleGetWiki(wikiQuery, repos);
      if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== req.params.id) {
        res.status(404).json({ error: 'Wiki not found' });
        return;
      }
      const wiki = wikiResult.data;

      const command = createSetActiveWikiCommand(wiki.id);
      const result = await handleSetActiveWiki(command, repos);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json(result.data);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
