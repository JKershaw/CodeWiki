/**
 * Benchmark API routes.
 *
 * Provides endpoints to run benchmarks, view results, and compare runs.
 */

import { Router, type Request, type Response } from 'express';
import type { Dependencies } from './index.js';
import { BenchmarkRunner } from '../../benchmark/benchmark-runner.js';
import {
  handleGetBenchmarkRun,
  handleGetBenchmarkHistory,
  handleCompareBenchmarks,
  createGetBenchmarkRunQuery,
  createGetBenchmarkHistoryQuery,
  createCompareBenchmarksQuery,
} from '../../queries/benchmark.js';

/**
 * Create benchmark routes.
 */
export function createBenchmarksRoutes(deps: Dependencies): Router {
  const { repos, git, createLLM } = deps;
  const router = Router();

  /**
   * Start a benchmark run for a repository.
   * Returns immediately with runId; client should poll for completion.
   */
  router.post('/api/repos/:id/benchmarks', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Get active wiki
      const wiki = await repos.wikis.findActive(repoId);
      if (!wiki) {
        res.status(400).json({ error: 'No active wiki for this repository' });
        return;
      }

      // Check if there's already a running benchmark
      const running = await repos.benchmarks.findRunning(repoId);
      if (running) {
        res.status(409).json({
          error: 'A benchmark is already running',
          runId: running.id,
        });
        return;
      }

      // Create LLM service and runner
      const llm = createLLM();
      const runner = new BenchmarkRunner(repos, llm, git);

      // Parse options from request body
      const options: { questionIds?: string[]; maxConcurrency?: number } = {};
      if (req.body.questionIds) {
        options.questionIds = req.body.questionIds as string[];
      }
      if (req.body.maxConcurrency) {
        options.maxConcurrency = req.body.maxConcurrency as number;
      }

      // Start benchmark in background
      const benchmarkPromise = runner.run(repoId, wiki.id, options);

      // Get the run ID by waiting briefly for initialization
      // The benchmark creates a run record immediately
      await new Promise(resolve => setTimeout(resolve, 100));

      const startedRun = await repos.benchmarks.findRunning(repoId);

      // Continue processing in background
      benchmarkPromise.catch(error => {
        console.error('Benchmark failed:', error);
      });

      if (startedRun) {
        res.status(202).json({
          runId: startedRun.id,
          status: 'running',
          message: 'Benchmark started, poll /api/repos/:id/benchmarks/:runId for results',
        });
      } else {
        // Wait for the full result if quick start failed
        const result = await benchmarkPromise;
        res.status(201).json({
          runId: result.id,
          status: result.status,
        });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Get benchmark history for a repository.
   */
  router.get('/api/repos/:id/benchmarks', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await handleGetBenchmarkHistory(
        createGetBenchmarkHistoryQuery(repoId, limit),
        repos
      );

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        benchmarks: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Compare multiple benchmark runs.
   * NOTE: This route must be defined BEFORE /:runId to avoid "compare" matching as a runId.
   */
  router.get('/api/repos/:id/benchmarks/compare', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const idsParam = req.query.ids as string;
      if (!idsParam) {
        res.status(400).json({ error: 'Missing ids query parameter' });
        return;
      }

      const runIds = idsParam.split(',').map(id => id.trim()).filter(id => id);
      if (runIds.length < 2) {
        res.status(400).json({ error: 'At least 2 benchmark IDs required for comparison' });
        return;
      }

      const result = await handleCompareBenchmarks(
        createCompareBenchmarksQuery(runIds),
        repos
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        comparison: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Get a specific benchmark run.
   */
  router.get('/api/repos/:id/benchmarks/:runId', async (req: Request, res: Response) => {
    try {
      const { id: repoId, runId } = req.params;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const result = await handleGetBenchmarkRun(
        createGetBenchmarkRunQuery(runId!),
        repos
      );

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      // Verify the benchmark belongs to this repository
      if (result.data!.repoId !== repoId) {
        res.status(404).json({ error: 'Benchmark not found for this repository' });
        return;
      }

      res.json({
        benchmark: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
