/**
 * Mock LLM service for integration tests.
 * No external test framework dependencies.
 */

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
 * Mock tool call configuration.
 */
export interface MockToolCall {
  name: string;
  input: Record<string, unknown>;
}

/**
 * A mock LLM service that returns predictable responses.
 *
 * Supports configurable tool calls for testing tool enforcement.
 */
export class MockLLMService implements LLMService {
  private responses: Map<string, string> = new Map();
  private defaultResponse = 'Default mock response';
  private _stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    requestCount: 0,
  };

  /** Mock tool calls to simulate LLM tool usage */
  private mockToolCalls: MockToolCall[] = [];

  /** Whether to auto-execute tools (simulates real LLM behavior) */
  private autoExecuteTools = false;

  /** Record of all completion calls for assertions */
  public calls: CompletionOptions[] = [];

  /** Record of all tool calls for assertions */
  public toolCallHistory: Array<{ name: string; input: Record<string, unknown>; result: string }> = [];

  /**
   * Set the default response for all completions.
   */
  setDefaultResponse(content: string): void {
    this.defaultResponse = content;
  }

  /**
   * Set a response for when any message contains a specific substring.
   */
  onPromptContaining(substring: string, response: string): void {
    this.responses.set(substring, response);
  }

  /**
   * Configure tool calls that the mock will simulate making.
   * These will be executed via executeTools and included in the result.
   *
   * @param calls - Array of tool calls to simulate
   * @param autoExecute - If true, executes the tools via the provided executor
   */
  setMockToolCalls(calls: MockToolCall[], autoExecute = true): void {
    this.mockToolCalls = calls;
    this.autoExecuteTools = autoExecute;
  }

  /**
   * Convenience method to simulate a read_file tool call.
   */
  simulateReadFile(path: string): void {
    this.mockToolCalls.push({ name: 'read_file', input: { path } });
    this.autoExecuteTools = true;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    this.calls.push(options);

    let content = this.defaultResponse;

    // Check for matching responses
    for (const [substring, response] of this.responses) {
      const hasMatch = options.messages.some(m => m.content.includes(substring));
      if (hasMatch) {
        content = response;
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

    this._stats.requestCount++;
    this._stats.totalCostUsd += result.costUsd;

    return result;
  }

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    const baseResult = await this.complete(options);

    const toolCalls: ToolUseResult['toolCalls'] = [];

    // Execute mock tool calls if configured
    if (this.mockToolCalls.length > 0 && this.autoExecuteTools) {
      const callsToExecute = this.mockToolCalls.map((tc, i) => ({
        id: `mock-tool-call-${i}`,
        name: tc.name,
        input: tc.input,
      }));

      const results = await options.executeTools(callsToExecute);

      for (let i = 0; i < this.mockToolCalls.length; i++) {
        const tc = this.mockToolCalls[i]!;
        const result = results[i]?.result ?? 'No result';
        toolCalls.push({
          name: tc.name,
          input: tc.input,
          result,
        });
        this.toolCallHistory.push({
          name: tc.name,
          input: tc.input,
          result,
        });
      }
    } else if (this.mockToolCalls.length > 0) {
      // Just record the tool calls without executing
      for (const tc of this.mockToolCalls) {
        toolCalls.push({
          name: tc.name,
          input: tc.input,
          result: 'mock result',
        });
      }
    }

    return {
      ...baseResult,
      toolCalls,
      toolRounds: toolCalls.length > 0 ? 1 : 0,
    };
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

  getRateLimitStatus(): RateLimitStatus {
    return {
      isLimited: false,
      reason: null,
      clearsInSeconds: null,
      currentRequests: 0,
      maxRequests: 60,
      currentHourlyCost: 0,
      maxHourlyCost: 5,
    };
  }

  getModel(): string {
    return 'mock';
  }

  /**
   * Reset all state for a fresh test.
   */
  reset(): void {
    this.responses.clear();
    this.defaultResponse = 'Default mock response';
    this.calls = [];
    this.mockToolCalls = [];
    this.autoExecuteTools = false;
    this.toolCallHistory = [];
    this.resetUsageStats();
  }
}
