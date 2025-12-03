/**
 * Unit tests for Chat Session domain types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createChatSession,
  createChatMessage,
  addMessageToSession,
  closeChatSession,
  type ChatSession,
  type ChatMessage,
} from '../../src/domain/chat-session.js';

describe('Chat Session Domain', () => {
  describe('createChatSession', () => {
    it('creates a session in active state with no messages', () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      assert.strictEqual(session.id, 'session-1');
      assert.strictEqual(session.repoId, 'repo-1');
      assert.strictEqual(session.wikiId, 'wiki-1');
      assert.strictEqual(session.selfImprovementRunId, 'run-1');
      assert.strictEqual(session.status, 'active');
      assert.deepStrictEqual(session.messages, []);
      assert.strictEqual(session.totalCostUsd, 0);
      assert.ok(session.createdAt instanceof Date);
      assert.ok(session.updatedAt instanceof Date);
    });

    it('sets createdAt and updatedAt to the same time', () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      assert.strictEqual(
        session.createdAt.getTime(),
        session.updatedAt.getTime()
      );
    });
  });

  describe('createChatMessage', () => {
    it('creates a user message', () => {
      const message = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Why did the accuracy drop on question 5?',
      });

      assert.strictEqual(message.id, 'msg-1');
      assert.strictEqual(message.role, 'user');
      assert.strictEqual(message.content, 'Why did the accuracy drop on question 5?');
      assert.strictEqual(message.toolCalls, undefined);
      assert.ok(message.timestamp instanceof Date);
    });

    it('creates an assistant message with tool calls', () => {
      const toolCalls = [
        {
          name: 'get_question_history',
          input: { questionId: 'q5' },
          result: 'Question history data...',
        },
      ];

      const message = createChatMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'I investigated question 5 and found...',
        toolCalls,
      });

      assert.strictEqual(message.id, 'msg-2');
      assert.strictEqual(message.role, 'assistant');
      assert.strictEqual(message.content, 'I investigated question 5 and found...');
      assert.deepStrictEqual(message.toolCalls, toolCalls);
      assert.ok(message.timestamp instanceof Date);
    });

    it('handles empty content', () => {
      const message = createChatMessage({
        id: 'msg-3',
        role: 'user',
        content: '',
      });

      assert.strictEqual(message.content, '');
    });
  });

  describe('addMessageToSession', () => {
    it('adds a message to an empty session', () => {
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

      const updated = addMessageToSession(session, message);

      assert.strictEqual(updated.messages.length, 1);
      assert.strictEqual(updated.messages[0].id, 'msg-1');
      assert.strictEqual(updated.messages[0].content, 'Hello');
    });

    it('adds a message to a session with existing messages', () => {
      let session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const msg1 = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'First message',
      });

      const msg2 = createChatMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'Second message',
      });

      session = addMessageToSession(session, msg1);
      session = addMessageToSession(session, msg2);

      assert.strictEqual(session.messages.length, 2);
      assert.strictEqual(session.messages[0].id, 'msg-1');
      assert.strictEqual(session.messages[1].id, 'msg-2');
    });

    it('accumulates cost from assistant messages', () => {
      let session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const userMsg = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Question?',
      });

      const assistantMsg = createChatMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer.',
      });

      session = addMessageToSession(session, userMsg, 0);
      session = addMessageToSession(session, assistantMsg, 0.05);

      assert.strictEqual(session.totalCostUsd, 0.05);

      // Add another exchange
      const userMsg2 = createChatMessage({
        id: 'msg-3',
        role: 'user',
        content: 'Follow up?',
      });

      const assistantMsg2 = createChatMessage({
        id: 'msg-4',
        role: 'assistant',
        content: 'More details.',
      });

      session = addMessageToSession(session, userMsg2, 0);
      session = addMessageToSession(session, assistantMsg2, 0.03);

      assert.strictEqual(session.totalCostUsd, 0.08);
    });

    it('updates the updatedAt timestamp', async () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const originalUpdatedAt = session.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const message = createChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      });

      const updated = addMessageToSession(session, message);

      assert.ok(updated.updatedAt.getTime() >= originalUpdatedAt.getTime());
    });

    it('does not mutate the original session', () => {
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

      addMessageToSession(session, message, 0.05);

      // Original should be unchanged
      assert.strictEqual(session.messages.length, 0);
      assert.strictEqual(session.totalCostUsd, 0);
    });
  });

  describe('closeChatSession', () => {
    it('marks session as closed', () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const closed = closeChatSession(session);

      assert.strictEqual(closed.status, 'closed');
      assert.strictEqual(closed.id, 'session-1');
    });

    it('updates the updatedAt timestamp', async () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const originalUpdatedAt = session.updatedAt;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 10));

      const closed = closeChatSession(session);

      assert.ok(closed.updatedAt.getTime() >= originalUpdatedAt.getTime());
    });

    it('does not mutate the original session', () => {
      const session = createChatSession({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      closeChatSession(session);

      assert.strictEqual(session.status, 'active');
    });

    it('preserves messages when closing', () => {
      let session = createChatSession({
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

      session = addMessageToSession(session, message);
      const closed = closeChatSession(session);

      assert.strictEqual(closed.messages.length, 1);
      assert.strictEqual(closed.messages[0].id, 'msg-1');
    });
  });
});
