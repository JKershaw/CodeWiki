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
import {
  handleDeleteQualityBenchmark,
  createDeleteQualityBenchmarkCommand,
} from '../../commands/quality-benchmark.js';
import { getQualityProgress } from '../../benchmark/benchmark-progress.js';

/**
 * Create quality benchmark routes.
 */
export function createQualityBenchmarksRoutes(deps: Dependencies): Router {
  const { repos, createLLM } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos/{id}/quality-benchmarks:
   *   post:
   *     summary: Start a quality benchmark run
   *     description: Starts a quality benchmark run for a repository's active wiki. Returns immediately with runId; client should poll for completion.
   *     tags: [Quality Benchmarks]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               maxPages:
   *                 type: integer
   *                 description: Maximum number of pages to benchmark
   *               includeLowestConfidence:
   *                 type: integer
   *                 description: Number of lowest confidence pages to include
   *               includeRecentlyUpdated:
   *                 type: integer
   *                 description: Number of recently updated pages to include
   *               maxConcurrency:
   *                 type: integer
   *                 description: Maximum concurrent benchmark operations
   *     responses:
   *       202:
   *         description: Quality benchmark started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 runId:
   *                   type: string
   *                 status:
   *                   type: string
   *                 message:
   *                   type: string
   *       400:
   *         description: Bad request (e.g., no active wiki)
   *       404:
   *         description: Repository not found
   *       409:
   *         description: A quality benchmark is already running
   *       500:
   *         description: Server error
   */
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
   * @swagger
   * /api/repos/{id}/quality-benchmarks:
   *   get:
   *     summary: Get quality benchmark history
   *     description: Returns quality benchmark history for a repository's active wiki
   *     tags: [Quality Benchmarks]
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
   *         description: Maximum number of benchmark runs to return
   *     responses:
   *       200:
   *         description: Quality benchmark history retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 qualityBenchmarks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/QualityBenchmarkRun'
   *       400:
   *         description: Bad request (e.g., no active wiki)
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Server error
   */
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
   * @swagger
   * /api/repos/{id}/quality-benchmarks/compare:
   *   get:
   *     summary: Compare multiple quality benchmark runs
   *     description: Compare results from multiple quality benchmark runs
   *     tags: [Quality Benchmarks]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *       - in: query
   *         name: ids
   *         required: true
   *         schema:
   *           type: string
   *         description: Comma-separated list of benchmark run IDs to compare (at least 2)
   *     responses:
   *       200:
   *         description: Comparison results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 comparison:
   *                   type: object
   *       400:
   *         description: Bad request (e.g., missing or insufficient IDs)
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Server error
   */
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
   * @swagger
   * /api/repos/{id}/quality-benchmarks/{runId}:
   *   get:
   *     summary: Get a specific quality benchmark run
   *     description: Returns details for a specific quality benchmark run
   *     tags: [Quality Benchmarks]
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
   *         description: Quality benchmark run ID
   *     responses:
   *       200:
   *         description: Quality benchmark run details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 qualityBenchmark:
   *                   $ref: '#/components/schemas/QualityBenchmarkRun'
   *       404:
   *         description: Repository or quality benchmark run not found
   *       500:
   *         description: Server error
   */
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

  /**
   * @swagger
   * /api/repos/{id}/quality-benchmarks/{runId}/progress:
   *   get:
   *     summary: Get live progress for a running quality benchmark
   *     description: Returns in-memory progress data if available. Useful for polling during a running benchmark.
   *     tags: [Quality Benchmarks]
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
   *         description: Quality benchmark run ID
   *     responses:
   *       200:
   *         description: Progress data for running quality benchmark
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 runId:
   *                   type: string
   *                 totalPages:
   *                   type: integer
   *                 completedCount:
   *                   type: integer
   *                 startedAt:
   *                   type: string
   *                   format: date-time
   *       404:
   *         description: No progress data available (benchmark may have completed or server restarted)
   *       500:
   *         description: Server error
   */
  /**
   * Get live progress for a running quality benchmark.
   * Returns in-memory progress data if available.
   */
  router.get('/api/repos/:id/quality-benchmarks/:runId/progress', async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;

      const progress = getQualityProgress(runId!);

      if (!progress) {
        // No in-memory progress - benchmark may have completed or server restarted
        res.status(404).json({
          error: 'No progress data available',
          message: 'Benchmark may have completed or server was restarted',
        });
        return;
      }

      res.json({
        runId: progress.runId,
        totalPages: progress.totalPages,
        completedCount: progress.completedCount,
        startedAt: progress.startedAt,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/quality-benchmarks/{runId}:
   *   delete:
   *     summary: Delete a specific quality benchmark run
   *     description: Deletes a quality benchmark run and all its associated data
   *     tags: [Quality Benchmarks]
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
   *         description: Quality benchmark run ID to delete
   *     responses:
   *       204:
   *         description: Quality benchmark run deleted successfully
   *       400:
   *         description: Bad request (e.g., cannot delete running benchmark)
   *       404:
   *         description: Repository or quality benchmark run not found
   *       500:
   *         description: Server error
   */
  /**
   * Delete a specific quality benchmark run.
   */
  router.delete('/api/repos/:id/quality-benchmarks/:runId', async (req: Request, res: Response) => {
    try {
      const { id: repoId, runId } = req.params;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId!);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // First, fetch the benchmark to verify it belongs to this repository
      const getResult = await handleGetQualityBenchmarkRun(
        createGetQualityBenchmarkRunQuery(runId!),
        repos
      );

      if (!getResult.success) {
        res.status(404).json({ error: getResult.error });
        return;
      }

      // Verify the benchmark belongs to this repository
      if (getResult.data!.repoId !== repoId) {
        res.status(404).json({ error: 'Quality benchmark not found for this repository' });
        return;
      }

      // Delete the benchmark
      const deleteResult = await handleDeleteQualityBenchmark(
        createDeleteQualityBenchmarkCommand(runId!),
        repos
      );

      if (!deleteResult.success) {
        res.status(400).json({ error: deleteResult.error });
        return;
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
