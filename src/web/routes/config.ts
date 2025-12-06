/**
 * Configuration routes.
 *
 * Exposes server configuration to the frontend.
 */

import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AVAILABLE_MODELS, getCurrentModel, setCurrentModel } from '../server.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', '..', '..', 'package.json');
let packageVersion = '0.1.0';
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  packageVersion = packageJson.version || '0.1.0';
} catch {
  // Fallback to default version
}

// Get git commit hash at startup (fallback for non-Heroku environments)
let gitCommitFallback: string | null = null;
try {
  gitCommitFallback = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  // Not a git repo or git not available
}

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

  /**
   * Get version and build info.
   * Uses Heroku dyno metadata when available, with fallbacks for local dev.
   */
  router.get('/api/config/version', (_req: Request, res: Response) => {
    // Heroku dyno metadata (requires: heroku labs:enable runtime-dyno-metadata)
    const herokuCommit = process.env.HEROKU_SLUG_COMMIT;
    const herokuReleasedAt = process.env.HEROKU_RELEASE_CREATED_AT;
    const herokuReleaseVersion = process.env.HEROKU_RELEASE_VERSION;

    // Use Heroku values if available, otherwise fall back to local git/defaults
    const commit = herokuCommit
      ? herokuCommit.substring(0, 7)
      : gitCommitFallback;

    const releasedAt = herokuReleasedAt || null;
    const releaseVersion = herokuReleaseVersion || null;

    res.json({
      version: packageVersion,
      commit,
      releasedAt,
      releaseVersion,
    });
  });

  return router;
}
