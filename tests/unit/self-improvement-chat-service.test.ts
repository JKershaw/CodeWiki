/**
 * Unit tests for the Self-Improvement Chat Service.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRepositories, type Repositories, type RepositoryConnection } from '../../src/repositories/index.js';
import { SelfImprovementChatService } from '../../src/services/self-improvement-chat-service.js';
import { createSelfImprovementRun, completeSelfImprovementRun } from '../../src/domain/self-improvement.js';
import { createChatSession } from '../../src/domain/chat-session.js';
import type { LLMService, ToolUseResult } from '../../src/services/llm/llm-service.js';

// Helper to create a mock LLM service
function createMockLLM(responseContent: string, toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }> = []): LLMService {
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
      toolCalls,
      toolRounds: toolCalls.length > 0 ? 1 : 0,
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

describe('SelfImprovementChatService', () => {
  let repos: Repositories;
  let repoConnection: RepositoryConnection;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'chat-service-test-'));
    repoConnection = await createRepositories({ fileBasePath: tempDir });
    repos = repoConnection.repositories;

    // Create a completed self-improvement run
    const run = createSelfImprovementRun({
      id: 'run-1',
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      benchmarkRunIds: ['bench-1', 'bench-2'],
      iterationRange: [10, 50],
    });
    const completedRun = completeSelfImprovementRun(run, '# Analysis Report\n\nScore improved from 40% to 75%', 0.05);
    await repos.selfImprovements.save(completedRun);

    // Create a chat session
    const session = createChatSession({
      id: 'session-1',
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      selfImprovementRunId: 'run-1',
    });
    await repos.chatSessions.save(session);
  });

  describe('chat', () => {
    it('processes a user message and returns assistant response', async () => {
      const llm = createMockLLM('Based on the analysis, the accuracy improved because...');
      const service = new SelfImprovementChatService(repos, llm);

      const result = await service.chat('session-1', 'Why did the accuracy improve?');

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.role, 'assistant');
        assert.ok(result.data.content.includes('accuracy improved'));
        assert.ok(result.data.timestamp instanceof Date);
      }
    });

    it('adds both user and assistant messages to the session', async () => {
      const llm = createMockLLM('Here is my response.');
      const service = new SelfImprovementChatService(repos, llm);

      await service.chat('session-1', 'What happened to question 5?');

      const session = await repos.chatSessions.findById('session-1');
      assert.ok(session);
      assert.strictEqual(session.messages.length, 2);
      assert.strictEqual(session.messages[0]!.role, 'user');
      assert.strictEqual(session.messages[0]!.content, 'What happened to question 5?');
      assert.strictEqual(session.messages[1]!.role, 'assistant');
      assert.strictEqual(session.messages[1]!.content, 'Here is my response.');
    });

    it('includes tool calls in the assistant message', async () => {
      const toolCalls = [
        { name: 'get_question_history', input: { questionId: 'q5' }, result: 'History data...' },
      ];
      const llm = createMockLLM('I investigated question 5 and found...', toolCalls);
      const service = new SelfImprovementChatService(repos, llm);

      const result = await service.chat('session-1', 'What happened to question 5?');

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.data.toolCalls);
        assert.strictEqual(result.data.toolCalls.length, 1);
        assert.strictEqual(result.data.toolCalls[0]!.name, 'get_question_history');
      }
    });

    it('accumulates cost in the session', async () => {
      const llm = createMockLLM('Response 1');
      const service = new SelfImprovementChatService(repos, llm);

      await service.chat('session-1', 'Question 1');
      await service.chat('session-1', 'Question 2');

      const session = await repos.chatSessions.findById('session-1');
      assert.ok(session);
      // Each call costs 0.05, so 2 calls = 0.10
      assert.strictEqual(session.totalCostUsd, 0.10);
    });

    it('fails if session does not exist', async () => {
      const llm = createMockLLM('Response');
      const service = new SelfImprovementChatService(repos, llm);

      const result = await service.chat('nonexistent', 'Hello');

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('not found'));
      }
    });

    it('fails if session is closed', async () => {
      await repos.chatSessions.close('session-1');

      const llm = createMockLLM('Response');
      const service = new SelfImprovementChatService(repos, llm);

      const result = await service.chat('session-1', 'Hello');

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('closed'));
      }
    });

    it('includes report context in the system prompt', async () => {
      let capturedMessages: unknown = null;
      const llm: LLMService = {
        ...createMockLLM('Response'),
        completeWithTools: async (options) => {
          capturedMessages = options;
          return {
            content: 'Response',
            inputTokens: 1000,
            outputTokens: 500,
            costUsd: 0.05,
            model: 'mock',
            truncated: false,
            toolCalls: [],
            toolRounds: 0,
          };
        },
      };
      const service = new SelfImprovementChatService(repos, llm);

      await service.chat('session-1', 'What does the report say?');

      assert.ok(capturedMessages);
      const options = capturedMessages as { system: string };
      // System prompt should include the original report
      assert.ok(options.system.includes('Analysis Report'));
      assert.ok(options.system.includes('Score improved'));
    });

    it('builds conversation history from previous messages', async () => {
      // Pre-populate the session with messages
      await repos.chatSessions.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'First question',
        timestamp: new Date(),
      });
      await repos.chatSessions.addMessage('session-1', {
        id: 'msg-2',
        role: 'assistant',
        content: 'First answer',
        timestamp: new Date(),
      });

      let capturedMessages: unknown = null;
      const llm: LLMService = {
        ...createMockLLM('Second answer'),
        completeWithTools: async (options) => {
          capturedMessages = options;
          return {
            content: 'Second answer',
            inputTokens: 1000,
            outputTokens: 500,
            costUsd: 0.05,
            model: 'mock',
            truncated: false,
            toolCalls: [],
            toolRounds: 0,
          };
        },
      };
      const service = new SelfImprovementChatService(repos, llm);

      await service.chat('session-1', 'Follow-up question');

      assert.ok(capturedMessages);
      const options = capturedMessages as { messages: Array<{ role: string; content: string }> };
      // Should include all previous messages plus the new one
      assert.strictEqual(options.messages.length, 3);
      assert.strictEqual(options.messages[0]!.content, 'First question');
      assert.strictEqual(options.messages[1]!.content, 'First answer');
      assert.strictEqual(options.messages[2]!.content, 'Follow-up question');
    });

    it('handles LLM errors gracefully', async () => {
      const llm: LLMService = {
        ...createMockLLM(''),
        completeWithTools: async () => {
          throw new Error('Rate limit exceeded');
        },
      };
      const service = new SelfImprovementChatService(repos, llm);

      const result = await service.chat('session-1', 'Hello');

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.includes('Rate limit'));
      }
    });
  });
});
