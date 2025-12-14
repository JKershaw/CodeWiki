/**
 * Page routes for CodeWiki web server.
 *
 * Handles server-side routing for the multi-page application.
 */

import { Router, type Request, type Response } from 'express';

/**
 * Create page routes for the web application.
 * Each route renders a specific EJS template.
 */
export function createPageRoutes(): Router {
  const router = Router();

  // Home - repository list
  router.get('/', (_req: Request, res: Response) => {
    res.render('pages/repos');
  });

  // Wiki view
  router.get('/wiki/:repoId', (req: Request, res: Response) => {
    res.render('pages/wiki', { repoId: req.params.repoId });
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
