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
  createGetWikiTreeQuery,
  handleGetWikiTree,
  createGetWikiGraphQuery,
  handleGetWikiGraph,
} from '../../queries/index.js';
import { wikiEventEmitter, type WikiEvent } from '../../services/wiki-events.js';

/**
 * Create wiki content routes.
 */
export function createWikiContentRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos/{id}/wiki:
   *   get:
   *     summary: Get wiki pages for a repository
   *     tags: [Wiki Content]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: wikiId
   *         schema:
   *           type: string
   *         description: Optional wiki ID (uses active wiki if not specified)
   *     responses:
   *       200:
   *         description: Wiki pages grouped by category
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pages:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/WikiPage'
   *                 grouped:
   *                   type: object
   *                   additionalProperties:
   *                     type: array
   *                     items:
   *                       $ref: '#/components/schemas/WikiPage'
   *       404:
   *         description: Repository or wiki not found
   *       500:
   *         description: Internal server error
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
   * @swagger
   * /api/repos/{id}/wiki-tree:
   *   get:
   *     summary: Get wiki pages as a hierarchical tree structure
   *     tags: [Wiki Content]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: wikiId
   *         schema:
   *           type: string
   *         description: Optional wiki ID (uses active wiki if not specified)
   *     responses:
   *       200:
   *         description: Wiki pages as tree structure
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/WikiTreeNode'
   *       404:
   *         description: Repository or wiki not found
   *       500:
   *         description: Internal server error
   */
  router.get('/api/repos/:id/wiki-tree', async (req: Request, res: Response) => {
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

      // Use CQRS query to get wiki tree
      const treeQuery = createGetWikiTreeQuery(wiki.id);
      const treeResult = await handleGetWikiTree(treeQuery, repos);

      res.json(treeResult.data || []);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/wiki-graph:
   *   get:
   *     summary: Get wiki pages as a graph of nodes and edges
   *     tags: [Wiki Content]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: wikiId
   *         schema:
   *           type: string
   *         description: Optional wiki ID (uses active wiki if not specified)
   *       - in: query
   *         name: category
   *         schema:
   *           type: string
   *         description: Filter nodes by category
   *       - in: query
   *         name: minConfidence
   *         schema:
   *           type: number
   *         description: Minimum confidence threshold (0-1)
   *     responses:
   *       200:
   *         description: Wiki graph with nodes and edges
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 nodes:
   *                   type: array
   *                 edges:
   *                   type: array
   *                 stats:
   *                   type: object
   *       404:
   *         description: Repository or wiki not found
   *       500:
   *         description: Internal server error
   */
  router.get('/api/repos/:id/wiki-graph', async (req: Request, res: Response) => {
    try {
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      let wiki;
      if (req.query.wikiId) {
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

      const options: { category?: string; minConfidence?: number } = {};
      if (typeof req.query.category === 'string') {
        options.category = req.query.category;
      }
      if (typeof req.query.minConfidence === 'string') {
        options.minConfidence = parseFloat(req.query.minConfidence);
      }
      const graphQuery = createGetWikiGraphQuery(wiki.id, options);
      const graphResult = await handleGetWikiGraph(graphQuery, repos);

      res.json(graphResult.data);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/wiki-events:
   *   get:
   *     summary: Server-Sent Events stream for real-time wiki updates
   *     tags: [Wiki Content]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: wikiId
   *         schema:
   *           type: string
   *         description: Optional wiki ID (uses active wiki if not specified)
   *     responses:
   *       200:
   *         description: SSE stream of wiki events
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       404:
   *         description: Repository or wiki not found
   */
  router.get('/api/repos/:id/wiki-events', async (req: Request, res: Response) => {
    try {
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      let wiki;
      if (req.query.wikiId) {
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

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      res.flushHeaders();

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ wikiId: wiki.id })}\n\n`);

      // Keep-alive ping every 30 seconds
      const pingInterval = setInterval(() => {
        res.write(`: ping\n\n`);
      }, 30000);

      // Subscribe to wiki events
      const handleEvent = (event: WikiEvent) => {
        if (event.wikiId === wiki.id) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      };

      wikiEventEmitter.on('wiki-event', handleEvent);

      // Clean up on close
      req.on('close', () => {
        clearInterval(pingInterval);
        wikiEventEmitter.off('wiki-event', handleEvent);
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/wiki/{path}:
   *   get:
   *     summary: Get a specific wiki page by path
   *     tags: [Wiki Content]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Wiki page path (can contain slashes for nested pages)
   *       - in: query
   *         name: wikiId
   *         schema:
   *           type: string
   *         description: Optional wiki ID (uses active wiki if not specified)
   *     responses:
   *       200:
   *         description: Wiki page content
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/WikiPage'
   *       404:
   *         description: Repository, wiki, or page not found
   *       500:
   *         description: Internal server error
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
