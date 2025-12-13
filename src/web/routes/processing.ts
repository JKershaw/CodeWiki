/**
 * Processing status and work queue routes.
 */

import { Router, type Request, type Response } from 'express';
import type { Dependencies } from './index.js';
import {
  createRequestStopProcessingRunCommand,
  handleRequestStopProcessingRun,
} from '../../commands/processing-run.js';

// Import CQRS queries
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createListWorkItemsQuery,
  handleListWorkItems,
} from '../../queries/index.js';
import { isCommitTarget, isPathTarget } from '../../domain/work-item.js';

/**
 * Create processing status routes.
 */
export function createProcessingRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos/{id}/work-queue:
   *   get:
   *     summary: Get work queue for a repository
   *     description: Returns pending, claimed, completed, and failed work items grouped by status
   *     tags: [Processing]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Work queue with items grouped by status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 workQueue:
   *                   type: object
   *                   properties:
   *                     pending:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: string
   *                           agentType:
   *                             type: string
   *                           targetCommitId:
   *                             type: string
   *                             nullable: true
   *                           targetPagePath:
   *                             type: string
   *                             nullable: true
   *                           status:
   *                             type: string
   *                           createdAt:
   *                             type: string
   *                             format: date-time
   *                           claimedAt:
   *                             type: string
   *                             format: date-time
   *                             nullable: true
   *                           completedAt:
   *                             type: string
   *                             format: date-time
   *                             nullable: true
   *                     claimed:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/WorkItem'
   *                     completed:
   *                       type: array
   *                       description: Limited to last 20 items
   *                       items:
   *                         $ref: '#/components/schemas/WorkItem'
   *                     failed:
   *                       type: array
   *                       description: Limited to last 10 items
   *                       items:
   *                         $ref: '#/components/schemas/WorkItem'
   *                     counts:
   *                       type: object
   *                       properties:
   *                         pending:
   *                           type: integer
   *                         claimed:
   *                           type: integer
   *                         completed:
   *                           type: integer
   *                         failed:
   *                           type: integer
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get the work queue (job list) for a repository.
   * Returns pending, claimed, completed, and failed work items.
   */
  router.get('/api/repos/:id/work-queue', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Get work items by status via CQRS queries
      const pendingQuery = createListWorkItemsQuery(repo.id, { status: 'pending' });
      const claimedQuery = createListWorkItemsQuery(repo.id, { status: 'claimed' });
      const completedQuery = createListWorkItemsQuery(repo.id, { status: 'completed' });
      const failedQuery = createListWorkItemsQuery(repo.id, { status: 'failed' });

      const [pendingResult, claimedResult, completedResult, failedResult] = await Promise.all([
        handleListWorkItems(pendingQuery, repos),
        handleListWorkItems(claimedQuery, repos),
        handleListWorkItems(completedQuery, repos),
        handleListWorkItems(failedQuery, repos),
      ]);

      const pending = pendingResult.data || [];
      const claimed = claimedResult.data || [];
      const completed = completedResult.data || [];
      const failed = failedResult.data || [];

      // Work items no longer have priority field, keep in insertion order

      // Sort claimed by claimedAt (most recent first)
      claimed.sort((a, b) =>
        (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0)
      );

      // Format work items for the response
      const formatItem = (item: typeof pending[0]) => ({
        id: item.id,
        agentType: item.agentType,
        targetCommitId: isCommitTarget(item.target) ? item.target.commitId : null,
        targetPagePath: isPathTarget(item.target) ? item.target.path : null,
        status: item.status,
        createdAt: item.createdAt,
        claimedAt: item.claimedAt,
        completedAt: item.completedAt,
      });

      res.json({
        workQueue: {
          pending: pending.map(formatItem),
          claimed: claimed.map(formatItem),
          completed: completed.slice(0, 20).map(formatItem), // Limit completed to last 20
          failed: failed.slice(0, 10).map(formatItem), // Limit failed to last 10
          counts: {
            pending: pending.length,
            claimed: claimed.length,
            completed: completed.length,
            failed: failed.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/processing:
   *   get:
   *     summary: Get processing status for a repository
   *     description: Returns the active or most recent processing run with iteration details
   *     tags: [Processing]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Processing status with iteration details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 processing:
   *                   type: object
   *                   nullable: true
   *                   properties:
   *                     id:
   *                       type: string
   *                     status:
   *                       type: string
   *                       enum: [running, completed, failed, stopping]
   *                     totalIterations:
   *                       type: integer
   *                     completedIterations:
   *                       type: integer
   *                     successfulIterations:
   *                       type: integer
   *                     failedIterations:
   *                       type: integer
   *                     totalCostUsd:
   *                       type: number
   *                       format: float
   *                     wikiPagesCreated:
   *                       type: integer
   *                     wikiPagesUpdated:
   *                       type: integer
   *                     startedAt:
   *                       type: string
   *                       format: date-time
   *                     completedAt:
   *                       type: string
   *                       format: date-time
   *                       nullable: true
   *                     error:
   *                       type: string
   *                       nullable: true
   *                     currentIteration:
   *                       type: object
   *                       nullable: true
   *                       properties:
   *                         iterationNumber:
   *                           type: integer
   *                         agentType:
   *                           type: string
   *                         startedAt:
   *                           type: string
   *                           format: date-time
   *                     iterations:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           iterationNumber:
   *                             type: integer
   *                           status:
   *                             type: string
   *                             enum: [running, completed, failed]
   *                           agentType:
   *                             type: string
   *                           durationMs:
   *                             type: integer
   *                             nullable: true
   *                           costUsd:
   *                             type: number
   *                             format: float
   *                           pagesCreated:
   *                             type: integer
   *                           pagesUpdated:
   *                             type: integer
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get processing status for a repository.
   * Returns the active or most recent processing run with iteration details.
   */
  router.get('/api/repos/:id/processing', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Try to find an active processing run first
      let processingRun = await repos.processingRuns.findActive(repo.id);

      // If no active run, get the most recent one
      if (!processingRun) {
        processingRun = await repos.processingRuns.findMostRecent(repo.id);
      }

      if (!processingRun) {
        res.json({ processing: null });
        return;
      }

      // Get iterations for this processing run
      const iterations = await repos.iterations.findByProcessingRun(processingRun.id);

      // Find the currently running iteration (if any)
      const currentIteration = iterations.find(i => i.status === 'running');

      res.json({
        processing: {
          id: processingRun.id,
          status: processingRun.status,
          totalIterations: processingRun.totalIterations,
          completedIterations: processingRun.completedIterations,
          successfulIterations: processingRun.successfulIterations,
          failedIterations: processingRun.failedIterations,
          totalCostUsd: processingRun.totalCostUsd,
          wikiPagesCreated: processingRun.wikiPagesCreated,
          wikiPagesUpdated: processingRun.wikiPagesUpdated,
          startedAt: processingRun.startedAt,
          completedAt: processingRun.completedAt,
          error: processingRun.error,
          currentIteration: currentIteration ? {
            iterationNumber: currentIteration.iterationNumber,
            agentType: currentIteration.agentType,
            startedAt: currentIteration.startedAt,
          } : null,
          iterations: iterations.map(i => ({
            iterationNumber: i.iterationNumber,
            status: i.status,
            agentType: i.agentType,
            durationMs: i.durationMs,
            costUsd: i.costUsd,
            pagesCreated: i.pagesCreated,
            pagesUpdated: i.pagesUpdated,
          })),
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/processing/stop:
   *   patch:
   *     summary: Request to stop active processing run
   *     description: Sets status to 'stopping', allowing current work to finish gracefully
   *     tags: [Processing]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Stop request accepted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Stop requested, finishing current work...
   *                 processingRunId:
   *                   type: string
   *       400:
   *         description: Processing run is not running
   *       404:
   *         description: Repository not found or no active processing run found
   *       500:
   *         description: Internal server error
   */
  /**
   * Request to stop the active processing run for a repository.
   * Sets status to 'stopping', allowing current work to finish.
   */
  router.patch('/api/repos/:id/processing/stop', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Find the active processing run
      const processingRun = await repos.processingRuns.findActive(repo.id);
      if (!processingRun) {
        res.status(404).json({ error: 'No active processing run found' });
        return;
      }

      if (processingRun.status !== 'running') {
        res.status(400).json({ error: `Processing run is not running (status: ${processingRun.status})` });
        return;
      }

      // Request graceful stop via CQRS command
      const result = await handleRequestStopProcessingRun(
        createRequestStopProcessingRunCommand(processingRun.id),
        repos
      );

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        message: 'Stop requested, finishing current work...',
        processingRunId: processingRun.id,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/page-history:
   *   get:
   *     summary: Get page count history for the active wiki
   *     description: Returns cumulative page counts at each iteration, computed from iteration data
   *     tags: [Processing]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Page count history
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pageHistory:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       iteration:
   *                         type: integer
   *                         description: Global iteration number across all processing runs
   *                       pageCount:
   *                         type: integer
   *                         description: Cumulative number of pages created
   *                       commitCoverage:
   *                         type: number
   *                         description: Percentage of commits processed (0-100)
   *                       fileCoverage:
   *                         type: number
   *                         description: Percentage of source files documented (0-100)
   *                       avgConfidence:
   *                         type: number
   *                         description: Average confidence of wiki pages (0-100)
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get page count history for the active wiki.
   * Returns cumulative page counts at each iteration, computed from iteration data.
   */
  router.get('/api/repos/:id/page-history', async (req: Request, res: Response) => {
    try {
      // Use CQRS query to get repository
      const repoQuery = createGetRepositoryQuery(req.params.id!);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      const repo = repoResult.data;

      // Get active wiki
      const wiki = await repos.wikis.findActive(repo.id);
      if (!wiki) {
        res.json({ pageHistory: [] });
        return;
      }

      // Get all processing runs for this repo, sorted by start time (oldest first)
      const processingRuns = await repos.processingRuns.findByRepo(repo.id);

      // Filter to only runs for the active wiki and sort oldest first
      const wikiRuns = processingRuns
        .filter(run => run.wikiId === wiki.id)
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

      // Build cumulative page count history with KPI snapshots
      const pageHistory: Array<{
        iteration: number;
        pageCount: number;
        // KPI snapshot fields (when available)
        commitCoverage?: number;
        fileCoverage?: number;
        avgConfidence?: number;
      }> = [];
      let globalIteration = 0;
      let cumulativePages = 0;

      for (const run of wikiRuns) {
        // Get iterations for this run
        const iterations = await repos.iterations.findByProcessingRun(run.id);

        // Sort by iteration number (should already be sorted, but ensure it)
        iterations.sort((a, b) => a.iterationNumber - b.iterationNumber);

        for (const iteration of iterations) {
          // Only count completed iterations that created pages
          if (iteration.status === 'completed') {
            globalIteration++;
            cumulativePages += iteration.pagesCreated;

            // Extract KPI data from snapshot if available
            const kpi = iteration.kpiSnapshot as {
              coveragePercent?: number;
              fileDocCoverage?: number;
              avgConfidence?: number;
            } | undefined;

            // Add a data point for each iteration
            pageHistory.push({
              iteration: globalIteration,
              pageCount: cumulativePages,
              // Include KPI metrics when available (renamed for clarity)
              ...(kpi?.coveragePercent !== undefined && { commitCoverage: kpi.coveragePercent }),
              ...(kpi?.fileDocCoverage !== undefined && { fileCoverage: kpi.fileDocCoverage }),
              ...(kpi?.avgConfidence !== undefined && { avgConfidence: kpi.avgConfidence }),
            });
          }
        }
      }

      res.json({ pageHistory });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
