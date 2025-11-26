import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
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
        ...(options.system ? { system: options.system } : {}),
        messages,
        ...(options.stopSequences ? { stop_sequences: options.stopSequences } : {}),
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

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    await this.waitForRateLimit();

    const tools = options.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    let messages: MessageParam[] = options.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const maxRounds = options.maxToolRounds ?? 5;
    const allToolCalls: ToolUseResult['toolCalls'] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolRounds = 0;
    let finalContent = '';

    try {
      while (toolRounds < maxRounds) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens ?? 4000,
          ...(options.system ? { system: options.system } : {}),
          messages,
          tools,
        });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        // Extract text content
        const textContent = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('');

        // Check for tool use
        const toolUseBlocks = response.content.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use'
        );

        // If no tool calls, we're done
        if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
          finalContent = textContent;
          break;
        }

        // Execute all tool calls
        const toolCalls = toolUseBlocks.map(block => ({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }));

        const toolResults = await options.executeTools(toolCalls);

        // Record tool calls
        for (let i = 0; i < toolCalls.length; i++) {
          allToolCalls.push({
            name: toolCalls[i]!.name,
            input: toolCalls[i]!.input,
            result: toolResults[i]!.result,
          });
        }

        // Add assistant message with tool use and user message with results
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        const toolResultContent: ToolResultBlockParam[] = toolResults.map(r => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: r.result,
        }));

        messages.push({
          role: 'user',
          content: toolResultContent,
        });

        toolRounds++;
      }

      // If we exhausted tool rounds without getting final content, make one more call WITHOUT tools
      // This forces the model to produce text output instead of requesting more tools
      if (finalContent === '' && messages.length > 0) {
        // Add a message to tell the model to stop using tools and write the output
        messages.push({
          role: 'user',
          content: 'You have gathered enough information. Now write the complete markdown output based on what you learned. Do not use any more tools.',
        });

        const finalResponse = await this.client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens ?? 4000,
          ...(options.system ? { system: options.system } : {}),
          messages,
          // Omit tools to force text output
        });

        totalInputTokens += finalResponse.usage.input_tokens;
        totalOutputTokens += finalResponse.usage.output_tokens;

        finalContent = finalResponse.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('');
      }

      const result: ToolUseResult = {
        content: finalContent,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: calculateCost(this.model, totalInputTokens, totalOutputTokens),
        model: this.model,
        truncated: false,
        toolCalls: allToolCalls,
        toolRounds,
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
