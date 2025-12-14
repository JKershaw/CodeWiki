/**
 * Unit tests for ChatSessionRepository.
 * Tests chat session storage, querying, and message management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection, type ChatSessionRepository } from '../../src/repositories/index.js';
import {
  createChatSession,
  createChatMessage,
  type ChatSession,
  type ChatMessage,
} from '../../src/domain/chat-session.js';

describe('ChatSessionRepository', () => {
  let connection: RepositoryConnection;
  let repo: ChatSessionRepository;

  beforeEach(async () => {
    connection = await createRepositories({ mongoDbName: `test-chat-${uuid()}` });
    repo = connection.repositories.chatSessions;
  });

  afterEach(async () => {
    await connection.close();
  });

  /**
   * Helper to create a chat session with sensible defaults.
   */
  function createTestSession(overrides: Partial<{
    id: string;
    repoId: string;
    wikiId: string;
    selfImprovementRunId: string;
    status: 'active' | 'closed';
  }> = {}): ChatSession {
    const session = createChatSession({
      id: overrides.id ?? uuid(),
      repoId: overrides.repoId ?? 'repo-1',
      wikiId: overrides.wikiId ?? 'wiki-1',
      selfImprovementRunId: overrides.selfImprovementRunId ?? 'run-1',
    });

    if (overrides.status === 'closed') {
      return { ...session, status: 'closed' };
    }

    return session;
  }

  /**
   * Helper to create a chat message.
   */
  function createTestMessage(overrides: Partial<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }> = {}): ChatMessage {
    return createChatMessage({
      id: overrides.id ?? uuid(),
      role: overrides.role ?? 'user',
      content: overrides.content ?? 'Test message',
    });
  }

  describe('save and findById', () => {
    it('saves and retrieves a chat session by id', async () => {
      const session = createTestSession({ id: 'session-1' });

      await repo.save(session);
      const retrieved = await repo.findById('session-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'session-1');
      assert.strictEqual(retrieved.status, 'active');
      assert.strictEqual(retrieved.selfImprovementRunId, 'run-1');
      assert.deepStrictEqual(retrieved.messages, []);
    });

    it('returns null for non-existent chat session', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const session = createTestSession();

      await repo.save(session);
      const retrieved = await repo.findById(session.id);

      assert.ok(retrieved);
      assert.ok(retrieved.createdAt instanceof Date);
      assert.ok(retrieved.updatedAt instanceof Date);
    });

    it('preserves messages with timestamps', async () => {
      const session = createTestSession();
      const message = createTestMessage({ content: 'Hello' });
      session.messages.push(message);

      await repo.save(session);
      const retrieved = await repo.findById(session.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.messages.length, 1);
      assert.strictEqual(retrieved.messages[0]!.content, 'Hello');
      assert.ok(retrieved.messages[0]!.timestamp instanceof Date);
    });
  });

  describe('findByRun', () => {
    it('returns all chat sessions for a self-improvement run', async () => {
      const session1 = createTestSession({ selfImprovementRunId: 'run-1' });
      const session2 = createTestSession({ selfImprovementRunId: 'run-1' });
      const session3 = createTestSession({ selfImprovementRunId: 'run-2' });

      await repo.save(session1);
      await repo.save(session2);
      await repo.save(session3);

      const results = await repo.findByRun('run-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(s => s.selfImprovementRunId === 'run-1'));
    });

    it('returns empty array when no sessions for run', async () => {
      const results = await repo.findByRun('nonexistent');
      assert.deepStrictEqual(results, []);
    });

    it('sorts by createdAt descending (newest first)', async () => {
      const older = createTestSession({ selfImprovementRunId: 'run-1' });
      const newer = createTestSession({ selfImprovementRunId: 'run-1' });

      // Manually set dates to ensure ordering
      older.createdAt = new Date('2024-01-01T10:00:00Z');
      newer.createdAt = new Date('2024-01-15T10:00:00Z');

      await repo.save(older);
      await repo.save(newer);

      const results = await repo.findByRun('run-1');
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]!.id, newer.id);
      assert.strictEqual(results[1]!.id, older.id);
    });
  });

  describe('findByRepo', () => {
    it('returns all chat sessions for a repository', async () => {
      const session1 = createTestSession({ repoId: 'repo-1' });
      const session2 = createTestSession({ repoId: 'repo-1' });
      const session3 = createTestSession({ repoId: 'repo-2' });

      await repo.save(session1);
      await repo.save(session2);
      await repo.save(session3);

      const results = await repo.findByRepo('repo-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(s => s.repoId === 'repo-1'));
    });

    it('returns empty array when no sessions for repo', async () => {
      const results = await repo.findByRepo('nonexistent');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('findActive', () => {
    it('returns only active chat sessions for a repository', async () => {
      const active1 = createTestSession({ repoId: 'repo-1' });
      const active2 = createTestSession({ repoId: 'repo-1' });
      const closed = createTestSession({ repoId: 'repo-1', status: 'closed' });
      const otherRepo = createTestSession({ repoId: 'repo-2' });

      await repo.save(active1);
      await repo.save(active2);
      await repo.save(closed);
      await repo.save(otherRepo);

      const results = await repo.findActive('repo-1');
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(s => s.status === 'active'));
      assert.ok(results.every(s => s.repoId === 'repo-1'));
    });

    it('returns empty array when no active sessions', async () => {
      const closed = createTestSession({ repoId: 'repo-1', status: 'closed' });
      await repo.save(closed);

      const results = await repo.findActive('repo-1');
      assert.deepStrictEqual(results, []);
    });
  });

  describe('addMessage', () => {
    it('adds a message to a chat session', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const message = createTestMessage({ content: 'Hello!' });
      await repo.addMessage('session-1', message);

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.messages.length, 1);
      assert.strictEqual(retrieved.messages[0]!.content, 'Hello!');
    });

    it('adds multiple messages in order', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const msg1 = createTestMessage({ id: 'msg-1', role: 'user', content: 'Question?' });
      const msg2 = createTestMessage({ id: 'msg-2', role: 'assistant', content: 'Answer.' });

      await repo.addMessage('session-1', msg1);
      await repo.addMessage('session-1', msg2);

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.messages.length, 2);
      assert.strictEqual(retrieved.messages[0]!.id, 'msg-1');
      assert.strictEqual(retrieved.messages[1]!.id, 'msg-2');
    });

    it('updates updatedAt timestamp', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const originalUpdatedAt = session.updatedAt;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 10));

      const message = createTestMessage({ content: 'Hello!' });
      await repo.addMessage('session-1', message);

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.ok(retrieved.updatedAt.getTime() >= originalUpdatedAt.getTime());
    });

    it('accumulates cost', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const msg1 = createTestMessage({ role: 'user', content: 'Question?' });
      const msg2 = createTestMessage({ role: 'assistant', content: 'Answer.' });

      await repo.addMessage('session-1', msg1, 0);
      await repo.addMessage('session-1', msg2, 0.05);

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.totalCostUsd, 0.05);
    });

    it('does nothing if session does not exist', async () => {
      const message = createTestMessage({ content: 'Hello!' });
      // Should not throw
      await repo.addMessage('nonexistent', message);

      const retrieved = await repo.findById('nonexistent');
      assert.strictEqual(retrieved, null);
    });
  });

  describe('close', () => {
    it('marks a session as closed', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      await repo.close('session-1');

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.status, 'closed');
    });

    it('updates updatedAt timestamp', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const originalUpdatedAt = session.updatedAt;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 10));

      await repo.close('session-1');

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.ok(retrieved.updatedAt.getTime() >= originalUpdatedAt.getTime());
    });

    it('preserves messages when closing', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      const message = createTestMessage({ content: 'Hello!' });
      await repo.addMessage('session-1', message);
      await repo.close('session-1');

      const retrieved = await repo.findById('session-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.status, 'closed');
      assert.strictEqual(retrieved.messages.length, 1);
    });

    it('does nothing if session does not exist', async () => {
      // Should not throw
      await repo.close('nonexistent');
    });
  });

  describe('delete', () => {
    it('deletes a chat session by id', async () => {
      const session = createTestSession({ id: 'session-1' });
      await repo.save(session);

      await repo.delete('session-1');

      const result = await repo.findById('session-1');
      assert.strictEqual(result, null);
    });

    it('does nothing if session does not exist', async () => {
      // Should not throw
      await repo.delete('nonexistent');
    });
  });

  describe('deleteByRepo', () => {
    it('deletes all chat sessions for a repository', async () => {
      const session1 = createTestSession({ repoId: 'repo-1' });
      const session2 = createTestSession({ repoId: 'repo-1' });
      const session3 = createTestSession({ repoId: 'repo-2' });

      await repo.save(session1);
      await repo.save(session2);
      await repo.save(session3);

      await repo.deleteByRepo('repo-1');

      const repo1Results = await repo.findByRepo('repo-1');
      const repo2Results = await repo.findByRepo('repo-2');

      assert.strictEqual(repo1Results.length, 0);
      assert.strictEqual(repo2Results.length, 1);
    });

    it('does nothing if repo has no sessions', async () => {
      // Should not throw
      await repo.deleteByRepo('nonexistent');
    });
  });

  describe('deleteByRun', () => {
    it('deletes all chat sessions for a self-improvement run', async () => {
      const session1 = createTestSession({ selfImprovementRunId: 'run-1' });
      const session2 = createTestSession({ selfImprovementRunId: 'run-1' });
      const session3 = createTestSession({ selfImprovementRunId: 'run-2' });

      await repo.save(session1);
      await repo.save(session2);
      await repo.save(session3);

      await repo.deleteByRun('run-1');

      const run1Results = await repo.findByRun('run-1');
      const run2Results = await repo.findByRun('run-2');

      assert.strictEqual(run1Results.length, 0);
      assert.strictEqual(run2Results.length, 1);
    });

    it('does nothing if run has no sessions', async () => {
      // Should not throw
      await repo.deleteByRun('nonexistent');
    });
  });
});
