/**
 * Page routes for CodeWiki web server.
 *
 * Handles server-side routing for the multi-page application.
 */

import { Router, type Request, type Response } from 'express';
import type { Repositories } from '../../repositories/interfaces/index.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createGetWikiQuery,
  handleGetWiki,
  createGetWikiTreeQuery,
  handleGetWikiTree,
  createGetWikiPageQuery,
  handleGetWikiPage,
} from '../../queries/index.js';
import { markdownToHtml, escapeHtml } from '../utils/markdown.js';

/**
 * Dependencies for page routes.
 */
export interface PageRouteDependencies {
  repos: Repositories;
}

/**
 * Create page routes for the web application.
 * Each route renders a specific EJS template.
 */
export function createPageRoutes(deps?: PageRouteDependencies): Router {
  const router = Router();

  // Home - repository list
  router.get('/', (_req: Request, res: Response) => {
    res.render('pages/repos');
  });

  // Wiki view with optional page path
  router.get('/wiki/:repoId/:path(*)?', async (req: Request, res: Response) => {
    const repoId = req.params.repoId!;
    const pagePath = req.params.path || null;
    const wikiIdParam = req.query.wikiId as string | undefined;

    // If no dependencies, fall back to client-side rendering
    if (!deps) {
      res.render('pages/wiki', {
        repoId,
        repo: null,
        wikis: [],
        currentWiki: null,
        tree: [],
        page: null,
        pageHtml: '',
        currentPath: pagePath,
        escapeHtml,
      });
      return;
    }

    const { repos } = deps;

    try {
      // Fetch repository
      const repoQuery = createGetRepositoryQuery(repoId);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).render('pages/wiki', {
          repoId,
          repo: null,
          wikis: [],
          currentWiki: null,
          tree: [],
          page: null,
          pageHtml: '',
          currentPath: null,
          escapeHtml,
          error: 'Repository not found',
        });
        return;
      }
      const repo = repoResult.data;

      // Fetch all wikis for this repo
      const wikis = await repos.wikis.findByRepo(repoId);

      // Determine current wiki
      let currentWiki;
      if (wikiIdParam) {
        const wikiQuery = createGetWikiQuery(wikiIdParam);
        const wikiResult = await handleGetWiki(wikiQuery, repos);
        if (wikiResult.success && wikiResult.data && wikiResult.data.repoId === repoId) {
          currentWiki = wikiResult.data;
        }
      }
      if (!currentWiki) {
        currentWiki = await getOrCreateActiveWiki(repoId, repos);
      }

      // Fetch wiki tree
      const treeQuery = createGetWikiTreeQuery(currentWiki.id);
      const treeResult = await handleGetWikiTree(treeQuery, repos);
      const tree = treeResult.data || [];

      // Fetch page if path provided
      let page = null;
      let pageHtml = '';
      if (pagePath) {
        const pageQuery = createGetWikiPageQuery(currentWiki.id, pagePath);
        const pageResult = await handleGetWikiPage(pageQuery, repos);
        if (pageResult.success && pageResult.data) {
          page = pageResult.data;
          pageHtml = markdownToHtml(page.content);
        }
      }

      res.render('pages/wiki', {
        repoId,
        repo,
        wikis,
        currentWiki,
        tree,
        page,
        pageHtml,
        currentPath: pagePath,
        escapeHtml,
      });
    } catch (error) {
      console.error('Error rendering wiki page:', error);
      res.status(500).render('pages/wiki', {
        repoId,
        repo: null,
        wikis: [],
        currentWiki: null,
        tree: [],
        page: null,
        pageHtml: '',
        currentPath: null,
        escapeHtml,
        error: 'Internal server error',
      });
    }
  });

  // Graph view
  router.get('/graph/:repoId', (req: Request, res: Response) => {
    res.render('pages/graph', { repoId: req.params.repoId });
  });

  // Query/Ask view
  router.get('/query/:repoId', (req: Request, res: Response) => {
    res.render('pages/query', { repoId: req.params.repoId });
  });

  // Spec generation view
  router.get('/spec/:repoId', (req: Request, res: Response) => {
    res.render('pages/spec', { repoId: req.params.repoId });
  });

  // Benchmark view
  router.get('/benchmark/:repoId', (req: Request, res: Response) => {
    res.render('pages/benchmark', { repoId: req.params.repoId });
  });

  // Debug/Observability view
  router.get('/debug/:repoId', (req: Request, res: Response) => {
    res.render('pages/debug', { repoId: req.params.repoId });
  });

  return router;
}
