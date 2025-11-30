/**
 * AI agent routes (query and spec generation).
 */

import { Router, type Request, type Response } from 'express';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import { createResearchAgent } from '../../agents/research/research-agent.js';
import { createSpecAgent } from '../../agents/spec/spec-agent.js';
import type { Dependencies } from './index.js';

/**
 * Create AI agent routes.
 */
export function createAgentsRoutes(deps: Dependencies): Router {
  const { repos, createLLM } = deps;
  const router = Router();

  /**
   * Query the wiki.
   */
  router.post('/api/repos/:id/query', async (req: Request, res: Response) => {
    try {
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const { question } = req.body;
      if (!question) {
        res.status(400).json({ error: 'Question is required' });
        return;
      }

      const llm = createLLM();
      const research = createResearchAgent(repos, llm);
      const wiki = await getOrCreateActiveWiki(repo.id, repos);
      const result = await research.query(wiki.id, question);

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Generate a spec for a coding agent task.
   */
  router.post('/api/repos/:id/spec', async (req: Request, res: Response) => {
    try {
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const { task } = req.body;
      if (!task) {
        res.status(400).json({ error: 'Task description is required' });
        return;
      }

      const llm = createLLM();
      const specAgent = createSpecAgent(repos, llm);
      const wiki = await getOrCreateActiveWiki(repo.id, repos);
      const result = await specAgent.generateSpec(wiki.id, task);

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
