/**
 * Mock LLM service for integration tests.
 *
 * Provides predictable responses without calling real AI APIs.
 */

import type {
  LLMService,
  CompletionOptions,
  CompletionResult,
  ToolUseOptions,
  ToolUseResult,
  UsageStats,
} from '../../src/services/llm/llm-service.js';

type ResponseHandler = (messages: Array<{ role: string; content: string }>) => string | Promise<string>;

/**
 * A mock LLM service that returns predictable responses.
 */
export class MockLLMService implements LLMService {
  private responseHandlers: ResponseHandler[] = [];
  private defaultContent = 'Default mock response';
  private _stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    requestCount: 0,
  };

  public completionHistory: CompletionOptions[] = [];
  public toolUseHistory: ToolUseOptions[] = [];

  /**
   * Set the default response content.
   */
  setDefaultResponse(content: string): void {
    this.defaultContent = content;
  }

  /**
   * Add a response handler that can customize responses based on messages.
   */
  addResponseHandler(handler: ResponseHandler): void {
    this.responseHandlers.push(handler);
  }

  /**
   * Set a simple response for when any message contains a specific string.
   */
  onPromptContaining(substring: string, responseContent: string): void {
    this.addResponseHandler((messages) => {
      const hasSubstring = messages.some(m => m.content.includes(substring));
      if (hasSubstring) {
        return responseContent;
      }
      return this.defaultContent;
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    this.completionHistory.push(options);

    let content = this.defaultContent;

    // Try each handler in order
    for (const handler of this.responseHandlers) {
      const result = await handler(options.messages);
      if (result !== this.defaultContent) {
        content = result;
        break;
      }
    }

    const result: CompletionResult = {
      content,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      model: 'mock',
      truncated: false,
    };

    this._stats.totalInputTokens += result.inputTokens;
    this._stats.totalOutputTokens += result.outputTokens;
    this._stats.totalCostUsd += result.costUsd;
    this._stats.requestCount++;

    return result;
  }

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    this.toolUseHistory.push(options);

    let content = this.defaultContent;
    const toolCalls: ToolUseResult['toolCalls'] = [];

    // Try each handler in order
    for (const handler of this.responseHandlers) {
      const result = await handler(options.messages);
      if (result !== this.defaultContent) {
        content = result;
        break;
      }
    }

    const result: ToolUseResult = {
      content,
      inputTokens: 150,
      outputTokens: 100,
      costUsd: 0.002,
      model: 'mock',
      truncated: false,
      toolCalls,
      toolRounds: 0,
    };

    this._stats.totalInputTokens += result.inputTokens;
    this._stats.totalOutputTokens += result.outputTokens;
    this._stats.totalCostUsd += result.costUsd;
    this._stats.requestCount++;

    return result;
  }

  getUsageStats(): UsageStats {
    return { ...this._stats };
  }

  resetUsageStats(): void {
    this._stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
    };
  }

  isRateLimited(): boolean {
    return false;
  }

  getModel(): string {
    return 'mock';
  }

  /**
   * Clear all recorded history.
   */
  clearHistory(): void {
    this.completionHistory = [];
    this.toolUseHistory = [];
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this.responseHandlers = [];
    this.defaultContent = 'Default mock response';
    this.clearHistory();
    this.resetUsageStats();
  }
}

/**
 * Create a mock LLM pre-configured for code-change agent responses.
 */
export function createCodeChangeMockLLM(): MockLLMService {
  const llm = new MockLLMService();

  llm.setDefaultResponse(`PAGE_TITLE:
Test Feature Implementation

SUMMARY:
The test feature provides functionality for handling test cases.
It integrates with the existing test infrastructure and follows
established patterns in the codebase.

FINDINGS:
- [CODE_PATTERN] [IMPORTANCE:medium] Found consistent test pattern [src/test.ts]

WIKI_UPDATES:
- [commits/abc12345] [create] Initial implementation of test feature

CONFIDENCE: 0.75`);

  return llm;
}

/**
 * Create a mock LLM for link agent testing.
 */
export function createLinkAgentMockLLM(): MockLLMService {
  const llm = new MockLLMService();

  llm.setDefaultResponse(`LINK_SUGGESTIONS:
- [commits/abc123] -> [security/auth-review] | [STRENGTH:strong] | Both discuss authentication
- [commits/abc123] -> [architecture/api-design] | [STRENGTH:medium] | Related API design

CONFIDENCE: 0.85`);

  return llm;
}

/**
 * Create a mock LLM for quality agent testing.
 */
export function createQualityAgentMockLLM(): MockLLMService {
  const llm = new MockLLMService();

  llm.setDefaultResponse(`ISSUES:
- [SEVERITY:medium] | [guides/testing] | Could use more examples

IMPROVEMENTS:
- [guides/testing] | Add code snippets

CONFIDENCE: 0.8`);

  return llm;
}
