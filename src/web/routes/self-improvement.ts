/**
 * API routes for Self-Improvement Analysis.
 */

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { GitService } from '../../services/git/git-service.js';
import type { RepositoryServiceFactory } from '../../services/repository/repository-service.js';
import { SelfImprovementAgent } from '../../analysis/self-improvement-agent.js';
import { SelfImprovementChatService } from '../../services/self-improvement-chat-service.js';
import { createChatSession } from '../../domain/chat-session.js';

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

interface ChatParams extends RunParams {
  sessionId: string;
}

/**
 * Create the self-improvement routes.
 */
export function createSelfImprovementRoutes(
  repos: Repositories,
  llm: LLMService,
  git: GitService,
  repoServiceFactory?: RepositoryServiceFactory
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

      // Register the local repo path so git service can find it (only for local repos)
      if (!repo.isGitHubRepo) {
        git.registerLocalRepo(repo.id, repo.fullName);
      }

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
      runAnalysisInBackground(repos, llm, git, repoServiceFactory, runId, repoId, wiki.id, validBenchmarks.map(b => b.id));

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

  // ============================================================================
  // Chat Routes
  // ============================================================================

  const chatService = new SelfImprovementChatService(repos, llm);

  /**
   * POST /api/repos/:id/self-improvements/:runId/chat
   * Start a new chat session for a completed analysis.
   */
  router.post('/:runId/chat', async (req: Request<RunParams>, res: Response) => {
    try {
      const runId = req.params.runId;

      // Get run via CQRS query
      const runQuery = createGetSelfImprovementRunQuery(runId);
      const runResult = await handleGetSelfImprovementRun(runQuery, repos);

      if (!runResult.success || !runResult.data) {
        return res.status(404).json({ error: 'Self-improvement run not found' });
      }

      const run = runResult.data;

      if (run.status !== 'completed') {
        return res.status(400).json({ error: 'Can only chat about completed analyses' });
      }

      const sessionId = uuid();
      const session = createChatSession({
        id: sessionId,
        repoId: run.repoId,
        wikiId: run.wikiId,
        selfImprovementRunId: runId,
      });
      await repos.chatSessions.save(session);

      return res.status(201).json({ sessionId, status: 'active' });
    } catch (error) {
      console.error('Error creating chat session:', error);
      return res.status(500).json({ error: 'Failed to create chat session' });
    }
  });

  /**
   * GET /api/repos/:id/self-improvements/:runId/chat
   * List chat sessions for a run.
   */
  router.get('/:runId/chat', async (req: Request<RunParams>, res: Response) => {
    try {
      const runId = req.params.runId;
      const sessions = await repos.chatSessions.findByRun(runId);

      return res.json({
        sessions: sessions.map(s => ({
          id: s.id,
          status: s.status,
          messageCount: s.messages.length,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          totalCostUsd: s.totalCostUsd,
        })),
      });
    } catch (error) {
      console.error('Error listing chat sessions:', error);
      return res.status(500).json({ error: 'Failed to list chat sessions' });
    }
  });

  /**
   * GET /api/repos/:id/self-improvements/:runId/chat/:sessionId
   * Get a specific chat session with messages.
   */
  router.get('/:runId/chat/:sessionId', async (req: Request<ChatParams>, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      const session = await repos.chatSessions.findById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      return res.json({ session });
    } catch (error) {
      console.error('Error getting chat session:', error);
      return res.status(500).json({ error: 'Failed to get chat session' });
    }
  });

  /**
   * POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/messages
   * Send a message in a chat session.
   */
  router.post('/:runId/chat/:sessionId/messages', async (req: Request<ChatParams>, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required' });
      }

      const result = await chatService.chat(sessionId, message);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          return res.status(404).json({ error: result.error });
        }
        if (result.error?.includes('closed')) {
          return res.status(400).json({ error: result.error });
        }
        return res.status(500).json({ error: result.error });
      }

      return res.json({ message: result.data });
    } catch (error) {
      console.error('Error sending chat message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  });

  /**
   * POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/close
   * Close a chat session.
   */
  router.post('/:runId/chat/:sessionId/close', async (req: Request<ChatParams>, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      const session = await repos.chatSessions.findById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      await repos.chatSessions.close(sessionId);
      return res.json({ status: 'closed' });
    } catch (error) {
      console.error('Error closing chat session:', error);
      return res.status(500).json({ error: 'Failed to close chat session' });
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
  repoServiceFactory: RepositoryServiceFactory | undefined,
  runId: string,
  repoId: string,
  wikiId: string,
  benchmarkRunIds: string[]
): Promise<void> {
  try {
    const agent = new SelfImprovementAgent(repos, llm, git, repoServiceFactory);
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
