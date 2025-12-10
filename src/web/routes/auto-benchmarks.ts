/**
 * Auto-Benchmark API routes.
 *
 * Provides endpoints to run multi-cycle auto-benchmarks, view status, and stop runs.
 */

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Dependencies } from './index.js';
import { AutoBenchmarkRunner, type AutoBenchmarkDependencies } from '../../auto-benchmark/auto-benchmark-runner.js';
import { createExecutor } from '../../executor/executor.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { BenchmarkRunner } from '../../benchmark/benchmark-runner.js';
import { QualityBenchmarkRunner } from '../../quality-benchmark/quality-benchmark-runner.js';
import { createUnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import type { AutoBenchmarkConfig } from '../../domain/auto-benchmark.js';
import {
  handleStopAutoBenchmark,
  handleDeleteAutoBenchmark,
  createStopAutoBenchmarkCommand,
  createDeleteAutoBenchmarkCommand,
} from '../../commands/auto-benchmark.js';

/**
 * Create auto-benchmark routes.
 */
export function createAutoBenchmarksRoutes(deps: Dependencies): Router {
  const { repos, git, createLLM, repoServiceFactory } = deps;
  const router = Router();

  /**
   * Create the AutoBenchmarkRunner with real dependencies.
   */
  function createRunner(): AutoBenchmarkRunner {
    const llm = createLLM();

    // Create unified repo access factory for orchestrator
    const repoAccessFactory = repoServiceFactory
      ? createUnifiedRepoAccessFactory({
          repos,
          repoServiceFactory,
          gitService: git,
        })
      : undefined;

    // Create orchestrator and executor
    const orchestrator = createOrchestrator(repos, llm, { useLLM: true }, repoAccessFactory);
    const executor = createExecutor(repos, git, llm, orchestrator, repoServiceFactory);

    // Create benchmark runners
    const benchmarkRunner = new BenchmarkRunner(repos, llm, git, repoServiceFactory);
    const qualityRunner = new QualityBenchmarkRunner(repos, llm);

    const runnerDeps: AutoBenchmarkDependencies = {
      repos,
      runIterations: async (repoId, iterations) => {
        await executor.runIterations(repoId, iterations);
      },
      runAccuracyBenchmark: async (repoId, wikiId) => {
        await benchmarkRunner.run(repoId, wikiId);
      },
      runQualityBenchmark: async (repoId, wikiId) => {
        await qualityRunner.run(repoId, wikiId);
      },
    };

    return new AutoBenchmarkRunner(runnerDeps);
  }

  /**
   * @swagger
   * /api/repos/{id}/auto-benchmarks:
   *   post:
   *     summary: Start an auto-benchmark run
   *     description: Starts a multi-cycle auto-benchmark run. Each cycle runs iterations followed by benchmarks.
   *     tags: [Auto-Benchmarks]
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
   *               iterationsPerCycle:
   *                 type: integer
   *                 default: 5
   *                 description: Number of wiki generation iterations per cycle
   *               maxCycles:
   *                 type: integer
   *                 default: 10
   *                 description: Maximum number of cycles to run
   *               includeQuality:
   *                 type: boolean
   *                 default: false
   *                 description: Whether to include quality benchmarks
   *     responses:
   *       202:
   *         description: Auto-benchmark started successfully
   *       400:
   *         description: No active wiki or invalid configuration
   *       404:
   *         description: Repository not found
   *       409:
   *         description: An auto-benchmark is already running
   *       500:
   *         description: Internal server error
   */
  router.post('/api/repos/:id/auto-benchmarks', async (req: Request, res: Response) => {
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

      // Check if there's already a running auto-benchmark
      const running = await repos.autoBenchmarks.findRunning(repoId);
      if (running) {
        res.status(409).json({
          error: 'An auto-benchmark is already running for this repository',
          runId: running.id,
        });
        return;
      }

      // Parse configuration from request body
      const config: AutoBenchmarkConfig = {
        iterationsPerCycle: req.body.iterationsPerCycle ?? 5,
        maxCycles: req.body.maxCycles ?? 10,
        includeQuality: req.body.includeQuality ?? false,
      };

      // Validate configuration
      if (config.iterationsPerCycle <= 0 || config.maxCycles <= 0) {
        res.status(400).json({ error: 'iterationsPerCycle and maxCycles must be positive' });
        return;
      }

      // Register local repo if needed
      if (!repo.isGitHubRepo) {
        git.registerLocalRepo(repoId, repo.fullName);
      }

      // Generate run ID
      const runId = uuid();

      // Start auto-benchmark in background
      const runner = createRunner();
      runner.run(runId, repoId, wiki.id, config).catch(error => {
        console.error(`[AutoBenchmark] Run ${runId} failed:`, error);
      });

      // Wait briefly for record to be created
      await new Promise(resolve => setTimeout(resolve, 100));

      res.status(202).json({
        runId,
        status: 'running',
        message: 'Auto-benchmark started, poll /api/repos/:id/auto-benchmarks/:runId for status',
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/auto-benchmarks:
   *   get:
   *     summary: Get auto-benchmark history
   *     description: Returns auto-benchmark history for the repository.
   *     tags: [Auto-Benchmarks]
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
   *         description: Maximum number of runs to return
   *     responses:
   *       200:
   *         description: Auto-benchmark history retrieved successfully
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  router.get('/api/repos/:id/auto-benchmarks', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;
      const limit = parseInt(req.query.limit as string) || 20;

      // Verify repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      const runs = await repos.autoBenchmarks.findByRepo(repoId, { limit });

      res.json({ runs });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/auto-benchmarks/{runId}:
   *   get:
   *     summary: Get auto-benchmark run details
   *     description: Returns details and current status of an auto-benchmark run.
   *     tags: [Auto-Benchmarks]
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
   *         description: Auto-benchmark run ID
   *     responses:
   *       200:
   *         description: Run details retrieved successfully
   *       404:
   *         description: Run not found
   *       500:
   *         description: Internal server error
   */
  router.get('/api/repos/:id/auto-benchmarks/:runId', async (req: Request, res: Response) => {
    try {
      const runId = req.params.runId!;

      const run = await repos.autoBenchmarks.findById(runId);
      if (!run) {
        res.status(404).json({ error: 'Auto-benchmark run not found' });
        return;
      }

      res.json(run);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/auto-benchmarks/{runId}/stop:
   *   post:
   *     summary: Stop an auto-benchmark run
   *     description: Request graceful stop of an auto-benchmark run. The run will stop after the current phase completes.
   *     tags: [Auto-Benchmarks]
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
   *         description: Auto-benchmark run ID
   *     responses:
   *       200:
   *         description: Stop requested successfully
   *       404:
   *         description: Run not found
   *       500:
   *         description: Internal server error
   */
  router.post('/api/repos/:id/auto-benchmarks/:runId/stop', async (req: Request, res: Response) => {
    try {
      const runId = req.params.runId!;

      const command = createStopAutoBenchmarkCommand(runId);
      const result = await handleStopAutoBenchmark(command, repos);

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      res.json({ message: 'Stop requested, run will stop after current phase completes' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @swagger
   * /api/repos/{id}/auto-benchmarks/{runId}:
   *   delete:
   *     summary: Delete an auto-benchmark run
   *     description: Delete an auto-benchmark run from history.
   *     tags: [Auto-Benchmarks]
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
   *         description: Auto-benchmark run ID
   *     responses:
   *       204:
   *         description: Run deleted successfully
   *       404:
   *         description: Run not found
   *       500:
   *         description: Internal server error
   */
  router.delete('/api/repos/:id/auto-benchmarks/:runId', async (req: Request, res: Response) => {
    try {
      const runId = req.params.runId!;

      const command = createDeleteAutoBenchmarkCommand(runId);
      const result = await handleDeleteAutoBenchmark(command, repos);

      if (!result.success) {
        res.status(404).json({ error: result.error });
        return;
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
