import {
  BaseLLMService,
  CompletionOptions,
  CompletionResult,
  ToolUseOptions,
  ToolUseResult,
  RateLimitConfig,
  calculateCost,
} from './llm-service.js';

/**
 * Mock LLM service for testing and development.
 *
 * Returns predefined responses based on the input,
 * useful for testing the system without API costs.
 */
export class MockLLMService extends BaseLLMService {
  private responses: Map<string, string> = new Map();
  private defaultResponse: string = 'This is a mock response.';

  constructor(rateLimit?: Partial<RateLimitConfig>) {
    super('mock', {
      maxRequestsPerMinute: rateLimit?.maxRequestsPerMinute ?? 100,
      maxCostPerHour: rateLimit?.maxCostPerHour ?? 10,
    });
  }

  /**
   * Set a mock response for a specific prompt pattern.
   */
  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  /**
   * Set the default response when no pattern matches.
   */
  setDefaultResponse(response: string): void {
    this.defaultResponse = response;
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    await this.waitForRateLimit();

    // Find the user's last message
    const userMessage = options.messages
      .filter(m => m.role === 'user')
      .pop()?.content ?? '';

    // Find a matching response
    let content = this.defaultResponse;
    for (const [pattern, response] of this.responses) {
      if (userMessage.includes(pattern)) {
        content = response;
        break;
      }
    }

    // Estimate tokens (rough approximation: 4 chars per token)
    const inputTokens = Math.ceil(
      (options.system?.length ?? 0) / 4 +
      options.messages.reduce((sum, m) => sum + m.content.length / 4, 0)
    );
    const outputTokens = Math.ceil(content.length / 4);

    const result: CompletionResult = {
      content,
      inputTokens,
      outputTokens,
      costUsd: await calculateCost('mock', inputTokens, outputTokens),
      model: 'mock',
      truncated: false,
    };

    this.trackUsage(result);
    return result;
  }

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    // For mock, just return a simple completion without actually using tools
    const baseResult = await this.complete(options);
    return {
      ...baseResult,
      toolCalls: [],
      toolRounds: 0,
    };
  }
}

/**
 * Create a mock LLM service configured for code analysis.
 */
export function createMockLLMForCodeAnalysis(): MockLLMService {
  const service = new MockLLMService();

  // Set up some useful default responses for code analysis
  service.setDefaultResponse(`
## Summary

This commit makes changes to the codebase.

## Key Changes

- Modified files as indicated in the diff
- Implementation details visible in the code changes

## Impact

- These changes affect the functionality described in the commit message
- Testing should verify the expected behavior

## Confidence

Medium - This is an automated analysis based on the diff content.
`.trim());

  return service;
}
