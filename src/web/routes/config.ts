/**
 * Configuration routes.
 *
 * Exposes server configuration to the frontend.
 */

import { Router, type Request, type Response } from 'express';

/**
 * Create configuration routes.
 */
export function createConfigRoutes(): Router {
  const router = Router();

  /**
   * Get server configuration.
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
    });
  });

  return router;
}
