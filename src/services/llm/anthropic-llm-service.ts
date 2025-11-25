import Anthropic from '@anthropic-ai/sdk';
import {
  BaseLLMService,
  CompletionOptions,
  CompletionResult,
  RateLimitConfig,
  calculateCost,
} from './llm-service.js';

/**
 * Anthropic Claude LLM service implementation.
 */
export class AnthropicLLMService extends BaseLLMService {
  private client: Anthropic;

  constructor(
    apiKey: string,
    model = 'claude-sonnet-4-5-20250929',
    rateLimit?: Partial<RateLimitConfig>
  ) {
    super(model, {
      maxRequestsPerMinute: rateLimit?.maxRequestsPerMinute ?? 50,
      maxCostPerHour: rateLimit?.maxCostPerHour ?? 5,
    });

    this.client = new Anthropic({ apiKey });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    await this.waitForRateLimit();

    const messages = options.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: options.maxTokens ?? 2000,
        system: options.system,
        messages,
        stop_sequences: options.stopSequences,
      });

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;

      const result: CompletionResult = {
        content,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(this.model, inputTokens, outputTokens),
        model: this.model,
        truncated: response.stop_reason === 'max_tokens',
      };

      this.trackUsage(result);
      return result;
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }
}

/**
 * Create an Anthropic LLM service from environment variable.
 */
export function createAnthropicLLM(options?: {
  apiKey?: string;
  model?: string;
  rateLimit?: Partial<RateLimitConfig>;
}): AnthropicLLMService {
  const apiKey = options?.apiKey ?? process.env['ANTHROPIC_API_KEY'];

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  return new AnthropicLLMService(
    apiKey,
    options?.model ?? 'claude-sonnet-4-5-20250929',
    options?.rateLimit
  );
}
