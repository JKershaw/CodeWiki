/**
 * Wiki content reading routes.
 */

import { Router, type Request, type Response } from 'express';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import type { Dependencies } from './index.js';

// Import CQRS queries
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createGetWikiQuery,
  handleGetWiki,
  createListWikiPagesQuery,
  handleListWikiPages,
  createGetWikiPageQuery,
  handleGetWikiPage,
} from '../../queries/index.js';

/**
 * Create wiki content routes.
 */
export function createWikiContentRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * Get wiki pages for a repository.
   * Supports optional ?wikiId query param to get pages for a specific wiki.
   */
  router.get('/api/repos/:id/wiki', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Use specified wiki or active wiki
      let wiki;
      if (req.query.wikiId) {
        // Use CQRS query to get wiki
        const wikiQuery = createGetWikiQuery(req.query.wikiId as string);
        const wikiResult = await handleGetWiki(wikiQuery, repos);
        if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== repo.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }
        wiki = wikiResult.data;
      } else {
        wiki = await getOrCreateActiveWiki(repo.id, repos);
      }
      // Use CQRS query to get wiki pages
      const pagesQuery = createListWikiPagesQuery(wiki.id);
      const pagesResult = await handleListWikiPages(pagesQuery, repos);
      const pages = pagesResult.data || [];

      // Group by category (first part of path)
      const grouped: Record<string, typeof pages> = {};
      for (const page of pages) {
        const category = page.path.split('/')[0] || 'uncategorized';
        if (!grouped[category]) grouped[category] = [];
        grouped[category]!.push(page);
      }

      res.json({ pages, grouped });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Get a specific wiki page.
   * Supports optional ?wikiId query param to get page from a specific wiki.
   */
  router.get('/api/repos/:id/wiki/:path(*)', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Use specified wiki or active wiki
      let wiki;
      if (req.query.wikiId) {
        // Use CQRS query to get wiki
        const wikiQuery = createGetWikiQuery(req.query.wikiId as string);
        const wikiResult = await handleGetWiki(wikiQuery, repos);
        if (!wikiResult.success || !wikiResult.data || wikiResult.data.repoId !== repo.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }
        wiki = wikiResult.data;
      } else {
        wiki = await getOrCreateActiveWiki(repo.id, repos);
      }
      // Use CQRS query to get wiki page
      const pageQuery = createGetWikiPageQuery(wiki.id, req.params.path!);
      const pageResult = await handleGetWikiPage(pageQuery, repos);
      if (!pageResult.success || !pageResult.data) {
        res.status(404).json({ error: 'Wiki page not found' });
        return;
      }

      res.json(pageResult.data);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
