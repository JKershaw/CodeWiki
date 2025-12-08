/**
 * Integration tests for agentic orchestrator behavior.
 * Tests that the orchestrator can use tools to explore before deciding on work items.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { Orchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type {
  LLMService,
  CompletionOptions,
  CompletionResult,
  ToolUseOptions,
  ToolUseResult,
  UsageStats,
  RateLimitStatus,
} from '../../src/services/llm/llm-service.js';

/**
 * Enhanced mock LLM that tracks completeWithTools calls and can simulate tool use.
 */
class AgenticMockLLM implements LLMService {
  public completeCalls: CompletionOptions[] = [];
  public completeWithToolsCalls: ToolUseOptions[] = [];
  public toolCallsExecuted: Array<{ name: string; input: Record<string, unknown> }> = [];

  private defaultResponse = '# Reasoning\nTest\n\n# Work Items\nwriter,,,Test';
  private toolCallsToMake: Array<{ name: string; input: Record<string, unknown> }> = [];

  setDefaultResponse(content: string): void {
    this.defaultResponse = content;
  }

  /**
   * Configure the mock to make specific tool calls before returning.
   */
  setToolCallsToMake(calls: Array<{ name: string; input: Record<string, unknown> }>): void {
    this.toolCallsToMake = calls;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    this.completeCalls.push(options);
    return {
      content: this.defaultResponse,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      model: 'mock',
      truncated: false,
    };
  }

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    this.completeWithToolsCalls.push(options);

    // Execute any configured tool calls
    const toolCalls: ToolUseResult['toolCalls'] = [];
    for (const call of this.toolCallsToMake) {
      this.toolCallsExecuted.push(call);

      // Actually execute the tool if executeTools is provided
      if (options.executeTools) {
        const results = await options.executeTools([
          { id: `call-${toolCalls.length}`, name: call.name, input: call.input },
        ]);
        toolCalls.push({
          name: call.name,
          input: call.input,
          result: results[0]?.result ?? 'No result',
        });
      }
    }

    return {
      content: this.defaultResponse,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      model: 'mock',
      truncated: false,
      toolCalls,
      toolRounds: toolCalls.length > 0 ? 1 : 0,
    };
  }

  getUsageStats(): UsageStats {
    return { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }

  resetUsageStats(): void {}
  isRateLimited(): boolean { return false; }
  getRateLimitStatus(): RateLimitStatus {
    return { isLimited: false, reason: null, clearsInSeconds: null, currentRequests: 0, maxRequests: 60, currentHourlyCost: 0, maxHourlyCost: 5 };
  }
  getModel(): string { return 'mock'; }

  reset(): void {
    this.completeCalls = [];
    this.completeWithToolsCalls = [];
    this.toolCallsExecuted = [];
    this.toolCallsToMake = [];
    this.defaultResponse = '# Reasoning\nTest\n\n# Work Items\nwriter,,,Test';
  }
}

describe('Agentic Orchestrator', () => {
  let ctx: TestContext;
  let llm: AgenticMockLLM;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    llm = new AgenticMockLLM();
  });

  describe('uses completeWithTools instead of complete', () => {
    it('should call completeWithTools when LLM mode is enabled', async () => {
      const repoId = 'agentic-orch-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project\n\nA test project.',
        'src/index.ts': 'export const x = 1;',
      });

      // Create a wiki with a page so bootstrap doesn't trigger
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-1',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content for the overview page.',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Should use completeWithTools, not complete
      assert.strictEqual(llm.completeWithToolsCalls.length, 1, 'Should call completeWithTools once');
      assert.strictEqual(llm.completeCalls.length, 0, 'Should not call complete');
    });

    it('should pass tools to the LLM call', async () => {
      const repoId = 'agentic-orch-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-2',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      const call = llm.completeWithToolsCalls[0];
      assert.ok(call, 'Should have a completeWithTools call');
      assert.ok(Array.isArray(call.tools), 'Should pass tools array');
      assert.ok(call.tools.length > 0, 'Should have at least one tool');

      // Check that standard codebase tools are available
      const toolNames = call.tools.map(t => t.name);
      assert.ok(toolNames.includes('read_file'), 'Should include read_file tool');
      assert.ok(toolNames.includes('list_directory'), 'Should include list_directory tool');
      assert.ok(toolNames.includes('search_files'), 'Should include search_files tool');
    });

    it('should include executeTools callback', async () => {
      const repoId = 'agentic-orch-test-3';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-3',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      const call = llm.completeWithToolsCalls[0];
      assert.ok(call, 'Should have a completeWithTools call');
      assert.ok(typeof call.executeTools === 'function', 'Should include executeTools callback');
    });

    it('should set reasonable maxToolRounds', async () => {
      const repoId = 'agentic-orch-test-4';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-4',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      const call = llm.completeWithToolsCalls[0];
      assert.ok(call, 'Should have a completeWithTools call');
      assert.ok(call.maxToolRounds !== undefined, 'Should specify maxToolRounds');
      assert.ok(call.maxToolRounds! >= 3, 'Should allow at least 3 tool rounds');
      assert.ok(call.maxToolRounds! <= 10, 'Should not allow more than 10 tool rounds');
    });
  });

  describe('tool execution', () => {
    it('should execute tools when LLM requests them', async () => {
      const repoId = 'agentic-orch-tool-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project\n\nThis is a test.',
        'src/index.ts': 'export const main = () => console.log("hello");',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-tool-1',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Configure mock to request reading the README
      llm.setToolCallsToMake([
        { name: 'read_file', input: { path: 'README.md' } },
      ]);

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // The mock should have tracked the tool execution
      assert.strictEqual(llm.toolCallsExecuted.length, 1, 'Should execute one tool call');
      assert.strictEqual(llm.toolCallsExecuted[0].name, 'read_file');

      // The tool result should contain the README content
      const call = llm.completeWithToolsCalls[0];
      assert.ok(call?.tools, 'Should have tools');
      // Tool was executed and result captured
      assert.ok(llm.toolCallsExecuted[0].input.path === 'README.md');
    });

    it('should allow listing directory contents', async () => {
      const repoId = 'agentic-orch-tool-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const x = 1;',
        'src/utils.ts': 'export const y = 2;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-tool-2',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Configure mock to list src directory
      llm.setToolCallsToMake([
        { name: 'list_directory', input: { path: 'src' } },
      ]);

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      assert.strictEqual(llm.toolCallsExecuted.length, 1, 'Should execute one tool call');
      assert.strictEqual(llm.toolCallsExecuted[0].name, 'list_directory');
    });
  });

  describe('response parsing', () => {
    it('should still parse work items from the final response', async () => {
      const repoId = 'agentic-orch-parse-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-parse-1',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      llm.setDefaultResponse(`# Reasoning
After exploring the codebase with tools, I recommend focusing on documentation.

# Work Items
writer,,,Improve page readability based on codebase exploration`);

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: true }, ctx.git);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 5);

      assert.ok(workItems.length > 0, 'Should generate work items');
      assert.strictEqual(workItems[0].agentType, 'writer', 'Should parse writer agent from response');
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to deterministic when LLM is not provided', async () => {
      const repoId = 'agentic-orch-fallback-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-fallback-1',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // No LLM provided
      const orchestrator = new Orchestrator(ctx.repos, undefined, { useLLM: true }, ctx.git);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Should not throw, should use deterministic fallback
      assert.ok(Array.isArray(workItems), 'Should return work items array');
    });

    it('should fall back to deterministic when LLM mode is disabled', async () => {
      const repoId = 'agentic-orch-fallback-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: 'test-page-fallback-2',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: 'Test content',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const orchestrator = new Orchestrator(ctx.repos, llm, { useLLM: false }, ctx.git);
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Should not call LLM at all
      assert.strictEqual(llm.completeWithToolsCalls.length, 0, 'Should not call LLM');
      assert.strictEqual(llm.completeCalls.length, 0, 'Should not call LLM');
    });
  });
});
