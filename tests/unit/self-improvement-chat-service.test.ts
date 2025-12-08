/**
 * Unit tests for the Self-Improvement Chat Service.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRepositories, type Repositories, type RepositoryConnection } from '../../src/repositories/index.js';
import { SelfImprovementChatService } from '../../src/services/self-improvement-chat-service.js';
import { createSelfImprovementRun, completeSelfImprovementRun } from '../../src/domain/self-improvement.js';
import { createChatSession } from '../../src/domain/chat-session.js';
import { createRepo } from '../../src/domain/repo.js';
import type { LLMService, ToolUseResult, CompleteWithToolsOptions } from '../../src/services/llm/llm-service.js';
import type { GitService } from '../../src/services/git/git-service.js';
import type { RepositoryServiceFactory, RepositoryService } from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';

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

  afterEach(async () => {
    await repoConnection.close();
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

  describe('source tools context', () => {
    it('provides source context via repoServiceFactory for GitHub repos', async () => {
      // Create a GitHub repo entity
      const githubRepo = createRepo({
        id: 'repo-1',
        fullName: 'test-owner/test-repo',
        owner: 'test-owner',
        repoName: 'test-repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/test-owner/test-repo.git',
        defaultBranch: 'main',
      });
      await repos.repos.save(githubRepo);

      // Create mock repoService that we can verify was created
      let repoServiceCreated = false;
      const mockRepoService: RepositoryService = {
        loadCommits: async () => [],
        getCommitDiff: async () => '',
        getFileContent: async () => 'file content',
        listDirectory: async () => [],
        getFileTree: async () => [],
        fileExists: async () => true,
        getDefaultBranch: async () => 'main',
      };

      const mockRepoServiceFactory: RepositoryServiceFactory = {
        getService: (_repo: Repo) => {
          repoServiceCreated = true;
          return mockRepoService;
        },
        getServiceWithToken: (_repo: Repo, _token: string) => {
          repoServiceCreated = true;
          return mockRepoService;
        },
      };

      // Capture what context is passed to the tool executor
      let capturedOptions: CompleteWithToolsOptions | null = null;
      const llm: LLMService = {
        ...createMockLLM('Response'),
        completeWithTools: async (options) => {
          capturedOptions = options;
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

      const service = new SelfImprovementChatService(repos, llm, undefined, mockRepoServiceFactory);
      await service.chat('session-1', 'Read the source code');

      // Verify repoServiceFactory was used
      assert.strictEqual(repoServiceCreated, true);
      assert.ok(capturedOptions);
    });

    it('provides source context via local filesystem for local repos', async () => {
      // Create a local repo entity
      const localRepo = createRepo({
        id: 'repo-1',
        fullName: 'local/test-repo',
        isGitHubRepo: false,
        cloneUrl: '/path/to/local/repo',
        defaultBranch: 'main',
      });
      await repos.repos.save(localRepo);

      // Create a mock local repo directory
      const localRepoPath = join(tempDir, 'repos', 'repo-1');
      await mkdir(localRepoPath, { recursive: true });
      await writeFile(join(localRepoPath, 'README.md'), '# Test Repo');

      // Create mock git service that returns the local path
      const mockGitService: Partial<GitService> = {
        getRepoPath: (repoId: string) => join(tempDir, 'repos', repoId),
      };

      // With UnifiedRepoAccessFactory, the factory does create a RepositoryService
      // internally, but for local repos it creates a LocalRepoAccess that uses
      // the gitService for filesystem operations.
      let repoServiceCreated = false;
      const mockRepoServiceFactory: RepositoryServiceFactory = {
        getService: () => {
          repoServiceCreated = true;
          return {} as RepositoryService;
        },
        getServiceWithToken: () => {
          repoServiceCreated = true;
          return {} as RepositoryService;
        },
      };

      const llm = createMockLLM('Response');
      const service = new SelfImprovementChatService(
        repos,
        llm,
        mockGitService as GitService,
        mockRepoServiceFactory
      );

      await service.chat('session-1', 'Read the source code');

      // With the new UnifiedRepoAccessFactory, the service is created for all repos
      // (including local ones), but LocalRepoAccess uses the gitService internally
      // This is the expected behavior as UnifiedRepoAccessFactory encapsulates the
      // distinction between local and GitHub repos behind a unified interface
      assert.strictEqual(repoServiceCreated, true);
    });

    it('falls back to repoServiceFactory when local path does not exist', async () => {
      // Create a local repo entity but don't create the directory
      const localRepo = createRepo({
        id: 'repo-1',
        fullName: 'local/test-repo',
        isGitHubRepo: false,
        cloneUrl: '/path/to/local/repo',
        defaultBranch: 'main',
      });
      await repos.repos.save(localRepo);

      // Mock git service that returns a non-existent path
      const mockGitService: Partial<GitService> = {
        getRepoPath: () => '/non/existent/path',
      };

      let repoServiceCreated = false;
      const mockRepoServiceFactory: RepositoryServiceFactory = {
        getService: () => {
          repoServiceCreated = true;
          return {} as RepositoryService;
        },
        getServiceWithToken: () => {
          repoServiceCreated = true;
          return {} as RepositoryService;
        },
      };

      const llm = createMockLLM('Response');
      const service = new SelfImprovementChatService(
        repos,
        llm,
        mockGitService as GitService,
        mockRepoServiceFactory
      );

      await service.chat('session-1', 'Read the source code');

      // Should fall back to repoServiceFactory when local path doesn't exist
      assert.strictEqual(repoServiceCreated, true);
    });

    it('uses authenticated service for GitHub repos with user access token', async () => {
      // Create a user with an access token
      await repos.users.save({
        id: 'user-1',
        githubId: '12345',
        username: 'testuser',
        accessToken: 'test-access-token',
        createdAt: new Date(),
      });

      // Create a GitHub repo linked to the user
      const githubRepo = createRepo({
        id: 'repo-1',
        fullName: 'test-owner/test-repo',
        owner: 'test-owner',
        repoName: 'test-repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/test-owner/test-repo.git',
        defaultBranch: 'main',
        userId: 'user-1',
      });
      await repos.repos.save(githubRepo);

      let usedToken: string | undefined;
      const mockRepoServiceFactory: RepositoryServiceFactory = {
        getService: () => ({} as RepositoryService),
        getServiceWithToken: (_repo: Repo, token: string) => {
          usedToken = token;
          return {} as RepositoryService;
        },
      };

      const llm = createMockLLM('Response');
      const service = new SelfImprovementChatService(repos, llm, undefined, mockRepoServiceFactory);

      await service.chat('session-1', 'Read the source code');

      // Should use authenticated service with the user's token
      assert.strictEqual(usedToken, 'test-access-token');
    });
  });
});
