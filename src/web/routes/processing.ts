/**
 * Processing status and work queue routes.
 */

import { Router, type Request, type Response } from 'express';
import type { Dependencies } from './index.js';
import {
  createRequestStopProcessingRunCommand,
  handleRequestStopProcessingRun,
} from '../../commands/processing-run.js';

/**
 * Create processing status routes.
 */
export function createProcessingRoutes(deps: Dependencies): Router {
  const { repos } = deps;
  const router = Router();

  /**
   * Get the work queue (job list) for a repository.
   * Returns pending, claimed, completed, and failed work items.
   */
  router.get('/api/repos/:id/work-queue', async (req: Request, res: Response) => {
    try {
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Get work items by status
      const [pending, claimed, completed, failed] = await Promise.all([
        repos.workQueue.findByRepo(repo.id, { status: 'pending' }),
        repos.workQueue.findByRepo(repo.id, { status: 'claimed' }),
        repos.workQueue.findByRepo(repo.id, { status: 'completed' }),
        repos.workQueue.findByRepo(repo.id, { status: 'failed' }),
      ]);

      // Sort pending by priority (highest first)
      pending.sort((a, b) => b.priority - a.priority);

      // Sort claimed by claimedAt (most recent first)
      claimed.sort((a, b) =>
        (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0)
      );

      // Format work items for the response
      const formatItem = (item: typeof pending[0]) => ({
        id: item.id,
        agentType: item.agentType,
        targetCommitId: item.targetCommitId,
        targetPagePath: item.targetPagePath,
        priority: item.priority,
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
   * Get processing status for a repository.
   * Returns the active or most recent processing run with iteration details.
   */
  router.get('/api/repos/:id/processing', async (req: Request, res: Response) => {
    try {
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

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
   * Request to stop the active processing run for a repository.
   * Sets status to 'stopping', allowing current work to finish.
   */
  router.patch('/api/repos/:id/processing/stop', async (req: Request, res: Response) => {
    try {
      const repo = await repos.repos.findById(req.params.id!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

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

  return router;
}
