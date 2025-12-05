/**
 * Configuration routes.
 *
 * Exposes server configuration to the frontend.
 */

import { Router, type Request, type Response } from 'express';
import { AVAILABLE_MODELS, getCurrentModel, setCurrentModel } from '../server.js';

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
      model: getCurrentModel(),
    });
  });

  /**
   * Get available models and current selection.
   */
  router.get('/api/config/models', (_req: Request, res: Response) => {
    res.json({
      models: AVAILABLE_MODELS,
      current: getCurrentModel(),
    });
  });

  /**
   * Set the current model.
   */
  router.post('/api/config/model', (req: Request, res: Response) => {
    const { model } = req.body as { model?: string };

    if (!model) {
      res.status(400).json({ error: 'Model ID is required' });
      return;
    }

    // Validate model ID is in available models
    const validModel = AVAILABLE_MODELS.find((m) => m.id === model);
    if (!validModel) {
      res.status(400).json({ error: 'Invalid model ID' });
      return;
    }

    setCurrentModel(model);
    res.json({ success: true, model: getCurrentModel() });
  });

  return router;
}
