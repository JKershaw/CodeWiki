/**
 * Wiki content reading routes.
 */

import { Router, type Request, type Response } from 'express';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import type { Dependencies } from './index.js';

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
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Use specified wiki or active wiki
      let wiki;
      if (req.query.wikiId) {
        wiki = await repos.wikis.findById(req.query.wikiId as string);
        if (!wiki || wiki.repoId !== repo.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }
      } else {
        wiki = await getOrCreateActiveWiki(repo.id, repos);
      }
      const pages = await repos.wikiPages.findByWiki(wiki.id);

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
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Use specified wiki or active wiki
      let wiki;
      if (req.query.wikiId) {
        wiki = await repos.wikis.findById(req.query.wikiId as string);
        if (!wiki || wiki.repoId !== repo.id) {
          res.status(404).json({ error: 'Wiki not found' });
          return;
        }
      } else {
        wiki = await getOrCreateActiveWiki(repo.id, repos);
      }
      const page = await repos.wikiPages.findByPath(wiki.id, req.params.path!);
      if (!page) {
        res.status(404).json({ error: 'Wiki page not found' });
        return;
      }

      res.json(page);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
