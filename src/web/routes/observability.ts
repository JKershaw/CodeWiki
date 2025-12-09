/**
 * Observability routes for viewing orchestrator decisions and agent runs.
 *
 * Provides API endpoints to inspect how the system made decisions,
 * which agents ran, their outcomes, and associated costs.
 */

import { Router, type Request, type Response } from 'express';
import type { Dependencies } from './index.js';

// Import CQRS queries
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createListOrchestratorRunsQuery,
  handleListOrchestratorRuns,
  createGetOrchestratorRunQuery,
  handleGetOrchestratorRun,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createGetAgentRunQuery,
  handleGetAgentRun,
  createCountAgentRunsByStatusQuery,
  handleCountAgentRunsByStatus,
} from '../../queries/index.js';

import type { AgentType, AgentRunStatus } from '../../domain/agent-run.js';

/**
 * Create observability routes.
 */
export function createObservabilityRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos/{id}/orchestrator-runs:
   *   get:
   *     summary: List orchestrator runs
   *     description: Shows how the system prioritized and scheduled work through orchestrator decisions
   *     tags: [Observability]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Maximum number of orchestrator runs to return
   *       - in: query
   *         name: usedLLM
   *         schema:
   *           type: boolean
   *         description: Filter by whether LLM was used for decision making
   *     responses:
   *       200:
   *         description: List of orchestrator decision runs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 orchestratorRuns:
   *                   type: array
   *                   items:
   *                     type: object
   *                 count:
   *                   type: integer
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * List orchestrator runs (decisions) for a repository.
   * Shows how the system prioritized and scheduled work.
   */
  router.get('/api/repos/:id/orchestrator-runs', async (req: Request, res: Response) => {
    try {
      // Validate repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Parse query params
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const usedLLM = req.query.usedLLM === 'true' ? true :
                      req.query.usedLLM === 'false' ? false : undefined;

      // Fetch orchestrator runs - only include usedLLM filter if specified
      const queryOptions: { limit: number; usedLLM?: boolean } = { limit };
      if (usedLLM !== undefined) {
        queryOptions.usedLLM = usedLLM;
      }
      const query = createListOrchestratorRunsQuery(req.params.id!, queryOptions);
      const result = await handleListOrchestratorRuns(query, repos);

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        orchestratorRuns: result.data,
        count: result.data?.length ?? 0,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/orchestrator-runs/{runId}:
   *   get:
   *     summary: Get specific orchestrator run
   *     description: Includes the complete context snapshot and prompt sent to the LLM
   *     tags: [Observability]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *         description: Orchestrator run ID
   *     responses:
   *       200:
   *         description: Detailed orchestrator run information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 orchestratorRun:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     repoId:
   *                       type: string
   *                     timestamp:
   *                       type: string
   *                     usedLLM:
   *                       type: boolean
   *                     model:
   *                       type: string
   *                     costUsd:
   *                       type: number
   *                     durationMs:
   *                       type: number
   *                     decision:
   *                       type: object
   *                     workItemsCreated:
   *                       type: integer
   *                     context:
   *                       type: object
   *                     promptSent:
   *                       type: string
   *                     rawResponse:
   *                       type: string
   *       404:
   *         description: Repository or orchestrator run not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get a specific orchestrator run with full details.
   * Includes the complete context snapshot and prompt sent to the LLM.
   */
  router.get('/api/repos/:id/orchestrator-runs/:runId', async (req: Request, res: Response) => {
    try {
      // Validate repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Fetch the specific orchestrator run
      const query = createGetOrchestratorRunQuery(req.params.runId!);
      const result = await handleGetOrchestratorRun(query, repos);

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      const run = result.data!;

      res.json({
        orchestratorRun: {
          id: run.id,
          repoId: run.repoId,
          timestamp: run.timestamp,
          usedLLM: run.usedLLM,
          model: run.model,
          costUsd: run.costUsd,
          durationMs: run.durationMs,
          decision: run.decision,
          workItemsCreated: run.workItemsCreated,
          context: run.context,
          promptSent: run.promptSent,
          rawResponse: run.rawResponse,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/agent-runs:
   *   get:
   *     summary: List agent runs
   *     description: Shows individual agent executions with their outcomes
   *     tags: [Observability]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *         description: Maximum number of agent runs to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *         description: Number of agent runs to skip for pagination
   *       - in: query
   *         name: agentType
   *         schema:
   *           type: string
   *         description: Filter by agent type (e.g., 'security', 'quality', 'coverage')
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, running, completed, failed]
   *         description: Filter by agent run status
   *     responses:
   *       200:
   *         description: List of agent runs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 agentRuns:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       agentType:
   *                         type: string
   *                       status:
   *                         type: string
   *                       targetCommitId:
   *                         type: string
   *                       targetPath:
   *                         type: string
   *                       startedAt:
   *                         type: string
   *                       completedAt:
   *                         type: string
   *                       durationMs:
   *                         type: number
   *                       costUsd:
   *                         type: number
   *                       error:
   *                         type: string
   *                       resultSummary:
   *                         type: string
   *                       findingsCount:
   *                         type: integer
   *                       requestedUpdatesCount:
   *                         type: integer
   *                 count:
   *                   type: integer
   *                 offset:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * List agent runs for a repository.
   * Shows individual agent executions with their outcomes.
   */
  router.get('/api/repos/:id/agent-runs', async (req: Request, res: Response) => {
    try {
      // Validate repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Parse query params
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const agentType = req.query.agentType as AgentType | undefined;
      const status = req.query.status as AgentRunStatus | undefined;

      // Fetch agent runs - only include filters if specified
      const queryOptions: { limit: number; offset: number; agentType?: AgentType; status?: AgentRunStatus } = { limit, offset };
      if (agentType !== undefined) {
        queryOptions.agentType = agentType;
      }
      if (status !== undefined) {
        queryOptions.status = status;
      }
      const query = createListAgentRunsQuery(req.params.id!, queryOptions);
      const result = await handleListAgentRuns(query, repos);

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      // Format for API response
      const agentRuns = (result.data ?? []).map(run => ({
        id: run.id,
        agentType: run.agentType,
        status: run.status,
        targetCommitId: run.targetCommitId,
        targetPath: run.targetPath,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        costUsd: run.costUsd,
        error: run.error,
        resultSummary: run.result?.summary,
        findingsCount: run.result?.findings?.length ?? 0,
        requestedUpdatesCount: run.requestedUpdates?.length ?? 0,
      }));

      res.json({
        agentRuns,
        count: agentRuns.length,
        offset,
        limit,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/agent-runs/{runId}:
   *   get:
   *     summary: Get specific agent run
   *     description: Includes the complete result, findings, and requested updates
   *     tags: [Observability]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent run ID
   *     responses:
   *       200:
   *         description: Detailed agent run information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 agentRun:
   *                   $ref: '#/components/schemas/AgentRun'
   *       404:
   *         description: Repository or agent run not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get a specific agent run with full details.
   * Includes the complete result, findings, and requested updates.
   */
  router.get('/api/repos/:id/agent-runs/:runId', async (req: Request, res: Response) => {
    try {
      // Validate repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Fetch the specific agent run
      const query = createGetAgentRunQuery(req.params.runId!);
      const result = await handleGetAgentRun(query, repos);

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      res.json({
        agentRun: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/observability/summary:
   *   get:
   *     summary: Get observability summary
   *     description: Aggregated stats including costs, success rates, and agent distribution
   *     tags: [Observability]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Aggregated observability metrics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summary:
   *                   type: object
   *                   properties:
   *                     costs:
   *                       type: object
   *                       properties:
   *                         orchestrator:
   *                           type: number
   *                           description: Total cost of orchestrator decisions in USD
   *                         agents:
   *                           type: number
   *                           description: Total cost of agent runs in USD
   *                         total:
   *                           type: number
   *                           description: Total combined cost in USD
   *                     agentRuns:
   *                       type: object
   *                       properties:
   *                         pending:
   *                           type: integer
   *                           description: Number of pending agent runs
   *                         running:
   *                           type: integer
   *                           description: Number of currently running agents
   *                         completed:
   *                           type: integer
   *                           description: Number of successfully completed agent runs
   *                         failed:
   *                           type: integer
   *                           description: Number of failed agent runs
   *                         total:
   *                           type: integer
   *                           description: Total number of agent runs
   *                         successRate:
   *                           type: number
   *                           description: Success rate percentage (0-100)
   *                     orchestratorRuns:
   *                       type: object
   *                       properties:
   *                         total:
   *                           type: integer
   *                           description: Total number of orchestrator runs
   *                         llmDecisions:
   *                           type: integer
   *                           description: Number of decisions made using LLM
   *                         deterministicDecisions:
   *                           type: integer
   *                           description: Number of deterministic decisions
   *                     agentDistribution:
   *                       type: object
   *                       additionalProperties:
   *                         type: object
   *                         properties:
   *                           count:
   *                             type: integer
   *                             description: Number of runs for this agent type
   *                           cost:
   *                             type: number
   *                             description: Total cost for this agent type in USD
   *                           avgDuration:
   *                             type: number
   *                             description: Average duration in milliseconds
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get observability summary for a repository.
   * Aggregated stats including costs, success rates, and agent distribution.
   */
  router.get('/api/repos/:id/observability/summary', async (req: Request, res: Response) => {
    try {
      // Validate repository exists
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Get agent run counts by status
      const statusQuery = createCountAgentRunsByStatusQuery(req.params.id!);
      const statusResult = await handleCountAgentRunsByStatus(statusQuery, repos);
      const statusCounts = statusResult.data ?? { pending: 0, running: 0, completed: 0, failed: 0 };

      // Get recent orchestrator runs for cost calculation
      const orchestratorQuery = createListOrchestratorRunsQuery(req.params.id!, { limit: 100 });
      const orchestratorResult = await handleListOrchestratorRuns(orchestratorQuery, repos);
      const orchestratorRuns = orchestratorResult.data ?? [];

      // Get recent agent runs for cost and distribution
      const agentQuery = createListAgentRunsQuery(req.params.id!, { limit: 200 });
      const agentResult = await handleListAgentRuns(agentQuery, repos);
      const agentRuns = agentResult.data ?? [];

      // Calculate total costs
      const orchestratorCost = orchestratorRuns.reduce((sum, r) => sum + r.costUsd, 0);
      const agentCost = agentRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

      // Calculate agent type distribution
      const agentDistribution: Record<string, { count: number; cost: number; avgDuration: number }> = {};
      for (const run of agentRuns) {
        if (!agentDistribution[run.agentType]) {
          agentDistribution[run.agentType] = { count: 0, cost: 0, avgDuration: 0 };
        }
        const dist = agentDistribution[run.agentType]!;
        dist.count++;
        dist.cost += run.costUsd ?? 0;
        dist.avgDuration += run.durationMs ?? 0;
      }

      // Calculate averages
      for (const type of Object.keys(agentDistribution)) {
        const dist = agentDistribution[type]!;
        if (dist.count > 0) {
          dist.avgDuration /= dist.count;
        }
      }

      // Calculate success rate
      const totalCompleted = statusCounts.completed + statusCounts.failed;
      const successRate = totalCompleted > 0
        ? (statusCounts.completed / totalCompleted) * 100
        : 100;

      res.json({
        summary: {
          costs: {
            orchestrator: orchestratorCost,
            agents: agentCost,
            total: orchestratorCost + agentCost,
          },
          agentRuns: {
            ...statusCounts,
            total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
            successRate: Math.round(successRate * 10) / 10,
          },
          orchestratorRuns: {
            total: orchestratorRuns.length,
            llmDecisions: orchestratorRuns.filter(r => r.usedLLM).length,
            deterministicDecisions: orchestratorRuns.filter(r => !r.usedLLM).length,
          },
          agentDistribution,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
