/**
 * Quality Benchmark API routes.
 *
 * Provides endpoints to run quality benchmarks, view results, and compare runs.
 */

import { Router, type Request, type Response } from 'express';
import type { Dependencies } from './index.js';
import { QualityBenchmarkRunner } from '../../quality-benchmark/quality-benchmark-runner.js';
import {
  handleGetQualityBenchmarkRun,
  handleGetQualityBenchmarkHistory,
  handleCompareQualityBenchmarks,
  createGetQualityBenchmarkRunQuery,
  createGetQualityBenchmarkHistoryQuery,
  createCompareQualityBenchmarksQuery,
} from '../../queries/quality-benchmark.js';

/**
 * Create quality benchmark routes.
 */
export function createQualityBenchmarksRoutes(deps: Dependencies): Router {
  const { repos, createLLM } = deps;
  const router = Router();

  /**
   * Start a quality benchmark run for a repository.
   * Returns immediately with runId; client should poll for completion.
   */
  router.post('/api/repos/:id/quality-benchmarks', async (req: Request, res: Response) => {
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

      // Check if there's already a running quality benchmark for this wiki
      const running = await repos.qualityBenchmarks.findRunningByWiki(wiki.id);
      if (running) {
        res.status(409).json({
          error: 'A quality benchmark is already running for this wiki',
          runId: running.id,
        });
        return;
      }

      // Create LLM service and runner
      const llm = createLLM();
      const runner = new QualityBenchmarkRunner(repos, llm);

      // Parse options from request body
      const options: {
        selection?: {
          maxPages?: number;
          includeLowestConfidence?: number;
          includeRecentlyUpdated?: number;
        };
        maxConcurrency?: number;
      } = {};

      if (req.body.maxPages) {
        options.selection = options.selection || {};
        options.selection.maxPages = req.body.maxPages as number;
      }
      if (req.body.includeLowestConfidence) {
        options.selection = options.selection || {};
        options.selection.includeLowestConfidence = req.body.includeLowestConfidence as number;
      }
      if (req.body.includeRecentlyUpdated) {
        options.selection = options.selection || {};
        options.selection.includeRecentlyUpdated = req.body.includeRecentlyUpdated as number;
      }
      if (req.body.maxConcurrency) {
        options.maxConcurrency = req.body.maxConcurrency as number;
      }

      // Start benchmark in background
      const benchmarkPromise = runner.run(repoId, wiki.id, options);

      // Get the run ID by waiting briefly for initialization
      // The benchmark creates a run record immediately
      await new Promise(resolve => setTimeout(resolve, 100));

      const startedRun = await repos.qualityBenchmarks.findRunningByWiki(wiki.id);

      // Continue processing in background
      benchmarkPromise.catch(error => {
        console.error('Quality benchmark failed:', error);
      });

      if (startedRun) {
        res.status(202).json({
          runId: startedRun.id,
          status: 'running',
          message: 'Quality benchmark started, poll /api/repos/:id/quality-benchmarks/:runId for results',
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
   * Get quality benchmark history for a repository.
   * Returns only benchmarks for the currently active wiki.
   */
  router.get('/api/repos/:id/quality-benchmarks', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Get active wiki to filter benchmarks
      const wiki = await repos.wikis.findActive(repoId);
      if (!wiki) {
        res.status(400).json({ error: 'No active wiki for this repository' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await handleGetQualityBenchmarkHistory(
        createGetQualityBenchmarkHistoryQuery(repoId, { wikiId: wiki.id, limit }),
        repos
      );

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        qualityBenchmarks: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * Compare multiple quality benchmark runs.
   * NOTE: This route must be defined BEFORE /:runId to avoid "compare" matching as a runId.
   */
  router.get('/api/repos/:id/quality-benchmarks/compare', async (req: Request, res: Response) => {
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

      const result = await handleCompareQualityBenchmarks(
        createCompareQualityBenchmarksQuery(runIds),
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
   * Get a specific quality benchmark run.
   */
  router.get('/api/repos/:id/quality-benchmarks/:runId', async (req: Request, res: Response) => {
    try {
      const { id: repoId, runId } = req.params;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const result = await handleGetQualityBenchmarkRun(
        createGetQualityBenchmarkRunQuery(runId!),
        repos
      );

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      // Verify the benchmark belongs to this repository
      if (result.data!.repoId !== repoId) {
        res.status(404).json({ error: 'Quality benchmark not found for this repository' });
        return;
      }

      res.json({
        qualityBenchmark: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
