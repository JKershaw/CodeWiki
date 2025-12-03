/**
 * Route module aggregator for CodeWiki web server.
 *
 * Exports all route modules and the Dependencies type used for dependency injection.
 */

import { Router } from 'express';
import type { Repositories } from '../../repositories/interfaces/index.js';
import type { GitService } from '../../services/git/git-service.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { JwtService } from '../../services/auth/jwt-service.js';

import { createReposRoutes } from './repos.js';
import { createWikisRoutes } from './wikis.js';
import { createWikiContentRoutes } from './wiki-content.js';
import { createAgentsRoutes } from './agents.js';
import { createProcessingRoutes } from './processing.js';
import { createFilesystemRoutes } from './filesystem.js';
import { createBenchmarksRoutes } from './benchmarks.js';
import { createQualityBenchmarksRoutes } from './quality-benchmarks.js';
import { createSelfImprovementRoutes } from './self-improvement.js';
import { createConfigRoutes } from './config.js';

/**
 * Dependencies required by route handlers.
 */
export interface Dependencies {
  repos: Repositories;
  git: GitService;
  createLLM: () => LLMService;
  /** Optional JWT service for authenticated git operations */
  jwtService?: JwtService;
}

/**
 * Create and configure all API routes.
 * Returns a single router with all routes mounted.
 */
export function createApiRoutes(deps: Dependencies): Router {
  const router = Router();

  // Mount route modules
  router.use(createReposRoutes(deps));
  router.use(createWikisRoutes(deps));
  router.use(createWikiContentRoutes(deps));
  router.use(createAgentsRoutes(deps));
  router.use(createProcessingRoutes(deps));
  router.use(createFilesystemRoutes(deps));
  router.use(createBenchmarksRoutes(deps));
  router.use(createQualityBenchmarksRoutes(deps));
  router.use('/api/repos/:id/self-improvements', createSelfImprovementRoutes(deps.repos, deps.createLLM(), deps.git));
  router.use(createConfigRoutes());

  return router;
}

export { createReposRoutes } from './repos.js';
export { createWikisRoutes } from './wikis.js';
export { createWikiContentRoutes } from './wiki-content.js';
export { createAgentsRoutes } from './agents.js';
export { createProcessingRoutes } from './processing.js';
export { createFilesystemRoutes } from './filesystem.js';
export { createBenchmarksRoutes } from './benchmarks.js';
export { createQualityBenchmarksRoutes } from './quality-benchmarks.js';
export { createSelfImprovementRoutes } from './self-improvement.js';
export { createConfigRoutes } from './config.js';
