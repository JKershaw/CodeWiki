/**
 * Unit tests for Chat Session CQRS queries.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileRepositories, type Repositories } from '../../src/repositories/index.js';
import {
  createGetChatSessionQuery,
  handleGetChatSession,
  createGetChatSessionsForRunQuery,
  handleGetChatSessionsForRun,
} from '../../src/queries/chat-session.js';
import { createChatSession, createChatMessage } from '../../src/domain/chat-session.js';

describe('Chat Session Queries', () => {
  let repos: Repositories;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'chat-queries-test-'));
    repos = createFileRepositories(tempDir);
  });

  describe('GetChatSession', () => {
    it('returns a chat session by ID', async () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      await repos.chatSessions.save(session);

      const query = createGetChatSessionQuery('session-1');
      const result = await handleGetChatSession(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.id, 'session-1');
      assert.strictEqual(result.data?.selfImprovementRunId, 'run-1');
    });

    it('returns not found for non-existent session', async () => {
      const query = createGetChatSessionQuery('nonexistent');
      const result = await handleGetChatSession(query, repos);

      assert.strictEqual(result.success, false);
    });

    it('includes messages in the response', async () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      const message = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      });
      session.messages.push(message);
      await repos.chatSessions.save(session);

      const query = createGetChatSessionQuery('session-1');
      const result = await handleGetChatSession(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.messages.length, 1);
      assert.strictEqual(result.data?.messages[0]!.content, 'Hello');
    });

    it('has correct query type', () => {
      const query = createGetChatSessionQuery('session-1');
      assert.strictEqual(query.type, 'GetChatSession');
    });
  });

  describe('GetChatSessionsForRun', () => {
    beforeEach(async () => {
      // Create sessions for different runs
      const session1 = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      const session2 = createChatSession({
        id: 'session-2',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      const session3 = createChatSession({
        id: 'session-3',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-2',
      });

      await repos.chatSessions.save(session1);
      await repos.chatSessions.save(session2);
      await repos.chatSessions.save(session3);
    });

    it('returns all sessions for a run', async () => {
      const query = createGetChatSessionsForRunQuery('run-1');
      const result = await handleGetChatSessionsForRun(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 2);
      assert.ok(result.data?.every(s => s.selfImprovementRunId === 'run-1'));
    });

    it('returns empty array when no sessions for run', async () => {
      const query = createGetChatSessionsForRunQuery('nonexistent');
      const result = await handleGetChatSessionsForRun(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 0);
    });

    it('returns session summaries without full message content', async () => {
      // Add messages to a session
      const message = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      });
      await repos.chatSessions.addMessage('session-1', message);

      const query = createGetChatSessionsForRunQuery('run-1');
      const result = await handleGetChatSessionsForRun(query, repos);

      assert.strictEqual(result.success, true);
      const session1 = result.data?.find(s => s.id === 'session-1');
      assert.ok(session1);
      assert.strictEqual(session1.messageCount, 1);
      // Should not include full messages in list view
      assert.strictEqual((session1 as unknown as { messages?: unknown }).messages, undefined);
    });

    it('has correct query type', () => {
      const query = createGetChatSessionsForRunQuery('run-1');
      assert.strictEqual(query.type, 'GetChatSessionsForRun');
    });
  });
});
