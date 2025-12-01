/**
 * API routes for Self-Improvement Analysis.
 */

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import { SelfImprovementAgent } from '../../analysis/self-improvement-agent.js';

interface RepoParams {
  id: string;
}

interface RunParams extends RepoParams {
  runId: string;
}

/**
 * Create the self-improvement routes.
 */
export function createSelfImprovementRoutes(
  repos: Repositories,
  llm: LLMService
): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET /api/repos/:id/self-improvements
   * List self-improvement analysis history for a repository.
   */
  router.get('/', async (req: Request<RepoParams>, res: Response) => {
    try {
      const repoId = req.params.id;
      const limit = parseInt(req.query['limit'] as string) || 10;

      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const runs = await repos.selfImprovements.findLatest(repoId, limit);

      return res.json({
        analyses: runs.map(run => ({
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          iterationRange: run.iterationRange,
          benchmarkRunCount: run.benchmarkRunIds.length,
          costUsd: run.costUsd,
          hasReport: run.report.length > 0,
        })),
      });
    } catch (error) {
      console.error('Error listing self-improvements:', error);
      return res.status(500).json({ error: 'Failed to list analyses' });
    }
  });

  /**
   * GET /api/repos/:id/self-improvements/:runId
   * Get a specific self-improvement analysis run with its report.
   */
  router.get('/:runId', async (req: Request<RunParams>, res: Response) => {
    try {
      const runId = req.params.runId;

      const run = await repos.selfImprovements.findById(runId);
      if (!run) {
        return res.status(404).json({ error: 'Analysis run not found' });
      }

      return res.json({ run });
    } catch (error) {
      console.error('Error getting self-improvement run:', error);
      return res.status(500).json({ error: 'Failed to get analysis run' });
    }
  });

  /**
   * POST /api/repos/:id/self-improvements
   * Start a new self-improvement analysis.
   */
  router.post('/', async (req: Request<RepoParams>, res: Response) => {
    try {
      const repoId = req.params.id;
      const { benchmarkRunIds } = req.body;

      // Validate inputs
      if (!Array.isArray(benchmarkRunIds) || benchmarkRunIds.length < 2) {
        return res.status(400).json({
          error: 'At least 2 benchmark run IDs are required',
        });
      }

      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const wiki = await repos.wikis.findActive(repoId);
      if (!wiki) {
        return res.status(400).json({ error: 'No active wiki found' });
      }

      // Check if there's already a running analysis
      const running = await repos.selfImprovements.findRunning(repoId);
      if (running) {
        return res.status(409).json({
          error: 'An analysis is already running',
          runId: running.id,
        });
      }

      // Validate benchmark runs exist and are completed
      const validBenchmarks = [];
      for (const id of benchmarkRunIds) {
        const benchmark = await repos.benchmarks.findById(id);
        if (benchmark && benchmark.status === 'completed') {
          validBenchmarks.push(benchmark);
        }
      }

      if (validBenchmarks.length < 2) {
        return res.status(400).json({
          error: 'At least 2 completed benchmark runs are required',
        });
      }

      // Sort by iteration to get range
      validBenchmarks.sort((a, b) => a.iterationCount - b.iterationCount);
      const iterationRange: [number, number] = [
        validBenchmarks[0]!.iterationCount,
        validBenchmarks[validBenchmarks.length - 1]!.iterationCount,
      ];

      const runId = uuid();

      // Create the run record
      const run = {
        id: runId,
        repoId,
        wikiId: wiki.id,
        status: 'running' as const,
        startedAt: new Date(),
        completedAt: null,
        benchmarkRunIds: validBenchmarks.map(b => b.id),
        iterationRange,
        report: '',
        costUsd: 0,
        error: null,
      };

      await repos.selfImprovements.save(run);

      // Run analysis in background (don't await)
      runAnalysisInBackground(repos, llm, runId, repoId, wiki.id, validBenchmarks.map(b => b.id));

      // Return immediately
      return res.json({
        runId,
        status: 'running',
        message: 'Analysis started',
      });
    } catch (error) {
      console.error('Error starting self-improvement:', error);
      return res.status(500).json({ error: 'Failed to start analysis' });
    }
  });

  return router;
}

/**
 * Run the analysis in the background.
 */
async function runAnalysisInBackground(
  repos: Repositories,
  llm: LLMService,
  runId: string,
  repoId: string,
  wikiId: string,
  benchmarkRunIds: string[]
): Promise<void> {
  try {
    const agent = new SelfImprovementAgent(repos, llm);
    const result = await agent.analyze(repoId, wikiId, benchmarkRunIds);

    // Update the run with results
    if (result.status === 'completed') {
      await repos.selfImprovements.complete(runId, result.report, result.costUsd);
    } else {
      await repos.selfImprovements.fail(runId, result.error ?? 'Unknown error');
    }
  } catch (error) {
    console.error('Self-improvement analysis failed:', error);
    await repos.selfImprovements.fail(
      runId,
      error instanceof Error ? error.message : String(error)
    );
  }
}
