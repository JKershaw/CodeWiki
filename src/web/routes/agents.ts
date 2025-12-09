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
   * @swagger
   * /api/repos/{id}/query:
   *   post:
   *     summary: Query the wiki with a question
   *     description: Queries the wiki using the research agent to find answers and relevant sources
   *     tags: [Agents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - question
   *             properties:
   *               question:
   *                 type: string
   *                 description: The question to ask about the repository
   *     responses:
   *       200:
   *         description: Query result with answer and sources
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/QueryResult'
   *       400:
   *         description: Missing required field (question)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
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
   * @swagger
   * /api/repos/{id}/spec:
   *   post:
   *     summary: Generate a coding spec for a task
   *     description: Uses the spec agent to generate a detailed specification for a coding task
   *     tags: [Agents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - task
   *             properties:
   *               task:
   *                 type: string
   *                 description: Description of the coding task
   *     responses:
   *       200:
   *         description: Specification result with generated spec
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SpecResult'
   *       400:
   *         description: Missing required field (task)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       404:
   *         description: Repository not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
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
