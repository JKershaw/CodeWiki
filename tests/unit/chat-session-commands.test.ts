/**
 * Unit tests for Chat Session CQRS commands.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileRepositories, type Repositories } from '../../src/repositories/index.js';
import {
  createStartChatSessionCommand,
  handleStartChatSession,
  createAddChatMessageCommand,
  handleAddChatMessage,
  createCloseChatSessionCommand,
  handleCloseChatSession,
} from '../../src/commands/chat-session.js';
import { createSelfImprovementRun } from '../../src/domain/self-improvement.js';

describe('Chat Session Commands', () => {
  let repos: Repositories;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'chat-commands-test-'));
    repos = createFileRepositories(tempDir);

    // Create a self-improvement run to link to
    const run = createSelfImprovementRun({
      id: 'run-1',
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      benchmarkRunIds: ['bench-1', 'bench-2'],
      iterationRange: [10, 50],
    });
    await repos.selfImprovements.save(run);
  });

  describe('StartChatSession', () => {
    it('creates a new chat session', async () => {
      // Complete the run first
      await repos.selfImprovements.complete('run-1', '# Report', 0.05);

      const command = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const result = await handleStartChatSession(command, repos);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.id, 'session-1');
        assert.strictEqual(result.data.status, 'active');
        assert.strictEqual(result.data.selfImprovementRunId, 'run-1');
        assert.deepStrictEqual(result.data.messages, []);
      }
    });

    it('fails if self-improvement run does not exist', async () => {
      const command = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'nonexistent',
      });

      const result = await handleStartChatSession(command, repos);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('not found'));
      }
    });

    it('fails if self-improvement run is not completed', async () => {
      // run-1 is in 'running' status by default
      const command = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const result = await handleStartChatSession(command, repos);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('not completed'));
      }
    });

    it('succeeds when self-improvement run is completed', async () => {
      // Complete the run
      await repos.selfImprovements.complete('run-1', '# Report', 0.05);

      const command = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      const result = await handleStartChatSession(command, repos);

      assert.strictEqual(result.success, true);
    });

    it('has correct command type', () => {
      const command = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });

      assert.strictEqual(command.type, 'StartChatSession');
    });
  });

  describe('AddChatMessage', () => {
    beforeEach(async () => {
      // Complete the run and create a session
      await repos.selfImprovements.complete('run-1', '# Report', 0.05);

      const startCommand = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      await handleStartChatSession(startCommand, repos);
    });

    it('adds a user message to a session', async () => {
      const command = createAddChatMessageCommand({
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: 'Why did the accuracy drop?',
      });

      const result = await handleAddChatMessage(command, repos);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.messages.length, 1);
        assert.strictEqual(result.data.messages[0]!.content, 'Why did the accuracy drop?');
        assert.strictEqual(result.data.messages[0]!.role, 'user');
      }
    });

    it('adds an assistant message with tool calls', async () => {
      const toolCalls = [
        { name: 'get_question_history', input: { questionId: 'q5' }, result: 'history data' },
      ];

      const command = createAddChatMessageCommand({
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'assistant',
        content: 'I investigated and found...',
        toolCalls,
        costUsd: 0.05,
      });

      const result = await handleAddChatMessage(command, repos);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.messages.length, 1);
        assert.deepStrictEqual(result.data.messages[0]!.toolCalls, toolCalls);
        assert.strictEqual(result.data.totalCostUsd, 0.05);
      }
    });

    it('fails if session does not exist', async () => {
      const command = createAddChatMessageCommand({
        sessionId: 'nonexistent',
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
      });

      const result = await handleAddChatMessage(command, repos);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('not found'));
      }
    });

    it('fails if session is closed', async () => {
      await repos.chatSessions.close('session-1');

      const command = createAddChatMessageCommand({
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
      });

      const result = await handleAddChatMessage(command, repos);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('closed'));
      }
    });

    it('has correct command type', () => {
      const command = createAddChatMessageCommand({
        sessionId: 'session-1',
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
      });

      assert.strictEqual(command.type, 'AddChatMessage');
    });
  });

  describe('CloseChatSession', () => {
    beforeEach(async () => {
      // Complete the run and create a session
      await repos.selfImprovements.complete('run-1', '# Report', 0.05);

      const startCommand = createStartChatSessionCommand({
        id: 'session-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        selfImprovementRunId: 'run-1',
      });
      await handleStartChatSession(startCommand, repos);
    });

    it('closes a chat session', async () => {
      const command = createCloseChatSessionCommand('session-1');

      const result = await handleCloseChatSession(command, repos);

      assert.strictEqual(result.success, true);

      const session = await repos.chatSessions.findById('session-1');
      assert.ok(session);
      assert.strictEqual(session.status, 'closed');
    });

    it('fails if session does not exist', async () => {
      const command = createCloseChatSessionCommand('nonexistent');

      const result = await handleCloseChatSession(command, repos);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('not found'));
      }
    });

    it('has correct command type', () => {
      const command = createCloseChatSessionCommand('session-1');

      assert.strictEqual(command.type, 'CloseChatSession');
    });
  });
});
