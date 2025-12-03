/**
 * Integration tests for Self-Improvement Chat API endpoints.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer, type Server } from 'http';
import express from 'express';
import { v4 as uuid } from 'uuid';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRepositories, type Repositories, type RepositoryConnection } from '../../src/repositories/index.js';
import { createSelfImprovementRun, completeSelfImprovementRun } from '../../src/domain/self-improvement.js';
import { createChatSession } from '../../src/domain/chat-session.js';
import { SelfImprovementChatService } from '../../src/services/self-improvement-chat-service.js';
import type { LLMService, ToolUseResult } from '../../src/services/llm/llm-service.js';

// Helper to create a mock LLM
function createMockLLM(responseContent: string): LLMService {
  return {
    complete: async () => ({
      content: responseContent,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.01,
      model: 'mock',
      truncated: false,
    }),
    completeWithTools: async () => ({
      content: responseContent,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
      model: 'mock',
      truncated: false,
      toolCalls: [],
      toolRounds: 0,
    } as ToolUseResult),
    getUsageStats: () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
    }),
    resetUsageStats: () => {},
    isRateLimited: () => false,
    getModel: () => 'mock',
  };
}

describe('Self-Improvement Chat API', () => {
  let repos: Repositories;
  let repoConnection: RepositoryConnection;
  let tempDir: string;
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'chat-api-test-'));
    repoConnection = await createRepositories({ fileBasePath: tempDir });
    repos = repoConnection.repositories;

    // Create Express app for testing
    app = express();
    app.use(express.json());

    const llm = createMockLLM('This is a mock response about the analysis.');
    const chatService = new SelfImprovementChatService(repos, llm);

    // POST /api/repos/:id/self-improvements/:runId/chat
    // Start a new chat session
    app.post('/api/repos/:id/self-improvements/:runId/chat', async (req, res) => {
      try {
        const { runId } = req.params;
        const run = await repos.selfImprovements.findById(runId);

        if (!run) {
          res.status(404).json({ error: 'Self-improvement run not found' });
          return;
        }

        if (run.status !== 'completed') {
          res.status(400).json({ error: 'Can only chat about completed analyses' });
          return;
        }

        const sessionId = uuid();
        const session = createChatSession({
          id: sessionId,
          repoId: run.repoId,
          wikiId: run.wikiId,
          selfImprovementRunId: runId,
        });
        await repos.chatSessions.save(session);

        res.status(201).json({ sessionId, status: 'active' });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // GET /api/repos/:id/self-improvements/:runId/chat
    // List chat sessions for a run
    app.get('/api/repos/:id/self-improvements/:runId/chat', async (req, res) => {
      try {
        const { runId } = req.params;
        const sessions = await repos.chatSessions.findByRun(runId);

        res.json({
          sessions: sessions.map(s => ({
            id: s.id,
            status: s.status,
            messageCount: s.messages.length,
            createdAt: s.createdAt,
            totalCostUsd: s.totalCostUsd,
          })),
        });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // GET /api/repos/:id/self-improvements/:runId/chat/:sessionId
    // Get a specific chat session
    app.get('/api/repos/:id/self-improvements/:runId/chat/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const session = await repos.chatSessions.findById(sessionId);

        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        res.json({ session });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/messages
    // Send a message
    app.post('/api/repos/:id/self-improvements/:runId/chat/:sessionId/messages', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
          res.status(400).json({ error: 'Message is required' });
          return;
        }

        const result = await chatService.chat(sessionId, message);

        if (!result.success) {
          if (result.error?.includes('not found')) {
            res.status(404).json({ error: result.error });
            return;
          }
          if (result.error?.includes('closed')) {
            res.status(400).json({ error: result.error });
            return;
          }
          res.status(500).json({ error: result.error });
          return;
        }

        res.json({ message: result.data });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/close
    // Close a chat session
    app.post('/api/repos/:id/self-improvements/:runId/chat/:sessionId/close', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const session = await repos.chatSessions.findById(sessionId);

        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        await repos.chatSessions.close(sessionId);
        res.json({ status: 'closed' });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Start server
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'object' && address !== null) {
      baseUrl = `http://localhost:${address.port}`;
    }
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await repoConnection.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clear chat sessions between tests
    // (We can't easily clear file-based repos, so we'll use unique IDs)
  });

  describe('POST /api/repos/:id/self-improvements/:runId/chat', () => {
    it('creates a new chat session', async () => {
      // Create a completed self-improvement run
      const run = createSelfImprovementRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      const completedRun = completeSelfImprovementRun(run, '# Report', 0.05);
      await repos.selfImprovements.save(completedRun);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${completedRun.id}/chat`,
        { method: 'POST' }
      );

      assert.strictEqual(response.status, 201);
      const data = await response.json() as { sessionId: string; status: string };
      assert.ok(data.sessionId);
      assert.strictEqual(data.status, 'active');
    });

    it('returns 404 for non-existent run', async () => {
      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/nonexistent/chat`,
        { method: 'POST' }
      );

      assert.strictEqual(response.status, 404);
    });

    it('returns 400 for non-completed run', async () => {
      // Create a running self-improvement run
      const run = createSelfImprovementRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      await repos.selfImprovements.save(run);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${run.id}/chat`,
        { method: 'POST' }
      );

      assert.strictEqual(response.status, 400);
    });
  });

  describe('POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/messages', () => {
    it('sends a message and receives a response', async () => {
      // Create a completed run and session
      const run = createSelfImprovementRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      const completedRun = completeSelfImprovementRun(run, '# Report', 0.05);
      await repos.selfImprovements.save(completedRun);

      const session = createChatSession({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: completedRun.id,
      });
      await repos.chatSessions.save(session);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${completedRun.id}/chat/${session.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Why did accuracy improve?' }),
        }
      );

      assert.strictEqual(response.status, 200);
      const data = await response.json() as { message: { role: string; content: string } };
      assert.strictEqual(data.message.role, 'assistant');
      assert.ok(data.message.content.includes('mock response'));
    });

    it('returns 400 for missing message', async () => {
      const run = createSelfImprovementRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      const completedRun = completeSelfImprovementRun(run, '# Report', 0.05);
      await repos.selfImprovements.save(completedRun);

      const session = createChatSession({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: completedRun.id,
      });
      await repos.chatSessions.save(session);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${completedRun.id}/chat/${session.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      assert.strictEqual(response.status, 400);
    });

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/run-1/chat/nonexistent/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Hello' }),
        }
      );

      assert.strictEqual(response.status, 404);
    });
  });

  describe('GET /api/repos/:id/self-improvements/:runId/chat', () => {
    it('lists chat sessions for a run', async () => {
      const runId = uuid();
      const run = createSelfImprovementRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      const completedRun = completeSelfImprovementRun(run, '# Report', 0.05);
      await repos.selfImprovements.save(completedRun);

      // Create two sessions
      const session1 = createChatSession({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: runId,
      });
      const session2 = createChatSession({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: runId,
      });
      await repos.chatSessions.save(session1);
      await repos.chatSessions.save(session2);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${runId}/chat`
      );

      assert.strictEqual(response.status, 200);
      const data = await response.json() as { sessions: Array<{ id: string }> };
      assert.strictEqual(data.sessions.length, 2);
    });
  });

  describe('POST /api/repos/:id/self-improvements/:runId/chat/:sessionId/close', () => {
    it('closes a chat session', async () => {
      const run = createSelfImprovementRun({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        benchmarkRunIds: ['b1', 'b2'],
        iterationRange: [10, 50],
      });
      const completedRun = completeSelfImprovementRun(run, '# Report', 0.05);
      await repos.selfImprovements.save(completedRun);

      const session = createChatSession({
        id: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: completedRun.id,
      });
      await repos.chatSessions.save(session);

      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/${completedRun.id}/chat/${session.id}/close`,
        { method: 'POST' }
      );

      assert.strictEqual(response.status, 200);

      // Verify session is closed
      const closedSession = await repos.chatSessions.findById(session.id);
      assert.strictEqual(closedSession?.status, 'closed');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(
        `${baseUrl}/api/repos/repo-1/self-improvements/run-1/chat/nonexistent/close`,
        { method: 'POST' }
      );

      assert.strictEqual(response.status, 404);
    });
  });
});
