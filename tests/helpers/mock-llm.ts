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
} from '../../src/services/llm/llm-service.js';

/**
 * A mock LLM service that returns predictable responses.
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

  /** Record of all completion calls for assertions */
  public calls: CompletionOptions[] = [];

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

    return {
      ...baseResult,
      toolCalls: [],
      toolRounds: 0,
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
    this.resetUsageStats();
  }
}
