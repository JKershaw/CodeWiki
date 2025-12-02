/**
 * API routes for Self-Improvement Analysis.
 */

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { GitService } from '../../services/git/git-service.js';
import { SelfImprovementAgent } from '../../analysis/self-improvement-agent.js';

// CQRS imports
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createGetActiveWikiQuery,
  handleGetActiveWiki,
} from '../../queries/index.js';
import {
  createGetBenchmarkRunQuery,
  handleGetBenchmarkRun,
} from '../../queries/benchmark.js';
import {
  createGetSelfImprovementRunQuery,
  handleGetSelfImprovementRun,
  createGetSelfImprovementHistoryQuery,
  handleGetSelfImprovementHistory,
} from '../../queries/self-improvement.js';
import {
  createStartSelfImprovementCommand,
  handleStartSelfImprovement,
  handleCompleteSelfImprovement,
  createCompleteSelfImprovementCommand,
  handleFailSelfImprovement,
  createFailSelfImprovementCommand,
} from '../../commands/self-improvement.js';

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
  llm: LLMService,
  git: GitService
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

      // Verify repo exists via CQRS query
      const repoQuery = createGetRepositoryQuery(repoId);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      // Get history via CQRS query
      const historyQuery = createGetSelfImprovementHistoryQuery(repoId, limit);
      const historyResult = await handleGetSelfImprovementHistory(historyQuery, repos);

      if (!historyResult.success) {
        return res.status(500).json({ error: historyResult.error });
      }

      return res.json({
        analyses: historyResult.data?.map(entry => ({
          ...entry,
          hasReport: true, // History entries are from completed/failed runs
        })) ?? [],
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

      // Get run via CQRS query
      const runQuery = createGetSelfImprovementRunQuery(runId);
      const runResult = await handleGetSelfImprovementRun(runQuery, repos);

      if (!runResult.success || !runResult.data) {
        return res.status(404).json({ error: 'Analysis run not found' });
      }

      return res.json({ run: runResult.data });
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

      // Verify repo exists via CQRS query
      const repoQuery = createGetRepositoryQuery(repoId);
      const repoResult = await handleGetRepository(repoQuery, repos);
      if (!repoResult.success || !repoResult.data) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      const repo = repoResult.data;

      // Register the local repo path so git service can find it
      git.registerLocalRepo(repo.id, repo.fullName);

      // Get active wiki via CQRS query
      const wikiQuery = createGetActiveWikiQuery(repoId);
      const wikiResult = await handleGetActiveWiki(wikiQuery, repos);
      if (!wikiResult.success || !wikiResult.data) {
        return res.status(400).json({ error: 'No active wiki found' });
      }
      const wiki = wikiResult.data;

      // Validate benchmark runs exist and are completed via CQRS queries
      const validBenchmarks = [];
      for (const id of benchmarkRunIds) {
        const benchmarkQuery = createGetBenchmarkRunQuery(id);
        const benchmarkResult = await handleGetBenchmarkRun(benchmarkQuery, repos);
        if (benchmarkResult.success && benchmarkResult.data && benchmarkResult.data.status === 'completed') {
          validBenchmarks.push(benchmarkResult.data);
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

      // Start the run via CQRS command
      const startCommand = createStartSelfImprovementCommand({
        id: runId,
        repoId,
        wikiId: wiki.id,
        benchmarkRunIds: validBenchmarks.map(b => b.id),
        iterationRange,
      });
      const startResult = await handleStartSelfImprovement(startCommand, repos);

      if (!startResult.success) {
        // Check if it's a conflict (already running)
        if (startResult.error?.includes('already running')) {
          return res.status(409).json({
            error: 'An analysis is already running',
          });
        }
        return res.status(500).json({ error: startResult.error });
      }

      // Run analysis in background (don't await)
      runAnalysisInBackground(repos, llm, git, runId, repoId, wiki.id, validBenchmarks.map(b => b.id));

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
  git: GitService,
  runId: string,
  repoId: string,
  wikiId: string,
  benchmarkRunIds: string[]
): Promise<void> {
  try {
    const agent = new SelfImprovementAgent(repos, llm, git);
    const result = await agent.analyze(repoId, wikiId, benchmarkRunIds);

    // Update the run with results via CQRS commands
    if (result.status === 'completed') {
      const completeCommand = createCompleteSelfImprovementCommand({
        runId,
        report: result.report,
        costUsd: result.costUsd,
      });
      await handleCompleteSelfImprovement(completeCommand, repos);
    } else {
      const failCommand = createFailSelfImprovementCommand(runId, result.error ?? 'Unknown error');
      await handleFailSelfImprovement(failCommand, repos);
    }
  } catch (error) {
    console.error('Self-improvement analysis failed:', error);
    const failCommand = createFailSelfImprovementCommand(
      runId,
      error instanceof Error ? error.message : String(error)
    );
    await handleFailSelfImprovement(failCommand, repos);
  }
}
