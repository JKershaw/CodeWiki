import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatResponse,
  Message,
  ToolDefinitionJson,
  AssistantMessage,
  ChatMessageToolCall,
} from '@openrouter/sdk/models';
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
 * OpenRouter LLM service implementation.
 * Uses the OpenRouter SDK to access 300+ models through a unified API.
 */
export class OpenRouterLLMService extends BaseLLMService {
  private client: OpenRouter;

  constructor(
    apiKey: string,
    model = 'anthropic/claude-sonnet-4.5',
    rateLimit?: Partial<RateLimitConfig>
  ) {
    super(model, {
      maxRequestsPerMinute: rateLimit?.maxRequestsPerMinute ?? 50,
      maxCostPerHour: rateLimit?.maxCostPerHour ?? 5,
    });

    this.client = new OpenRouter({
      apiKey,
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    await this.waitForRateLimit();

    const messages: Message[] = [];

    // Add system message if provided
    if (options.system) {
      messages.push({
        role: 'system',
        content: options.system,
      });
    }

    // Add conversation messages
    for (const m of options.messages) {
      if (m.role === 'user') {
        messages.push({
          role: 'user',
          content: m.content,
        });
      } else if (m.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: m.content,
        });
      }
    }

    try {
      const response = await this.client.chat.send({
        model: this.model,
        maxTokens: options.maxTokens ?? 2000,
        messages,
        ...(options.stopSequences ? { stop: options.stopSequences } : {}),
        stream: false,
      }) as ChatResponse;

      const message = response.choices[0]?.message;
      const content = typeof message?.content === 'string' ? message.content : '';
      const inputTokens = response.usage?.promptTokens ?? 0;
      const outputTokens = response.usage?.completionTokens ?? 0;

      const result: CompletionResult = {
        content,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(this.model, inputTokens, outputTokens),
        model: this.model,
        truncated: response.choices[0]?.finishReason === 'length',
      };

      this.trackUsage(result);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenRouter API error: ${error.message}`);
      }
      throw error;
    }
  }

  async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
    await this.waitForRateLimit();

    // Convert tools to OpenRouter format
    const tools: ToolDefinitionJson[] = options.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    // Build initial messages
    const messages: Message[] = [];

    if (options.system) {
      messages.push({
        role: 'system',
        content: options.system,
      });
    }

    for (const m of options.messages) {
      if (m.role === 'user') {
        messages.push({
          role: 'user',
          content: m.content,
        });
      } else if (m.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: m.content,
        });
      }
    }

    const maxRounds = options.maxToolRounds ?? 5;
    const allToolCalls: ToolUseResult['toolCalls'] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolRounds = 0;
    let finalContent = '';

    try {
      while (toolRounds < maxRounds) {
        const response = await this.client.chat.send({
          model: this.model,
          maxTokens: options.maxTokens ?? 4000,
          messages,
          tools,
          toolChoice: 'auto',
          stream: false,
        }) as ChatResponse;

        totalInputTokens += response.usage?.promptTokens ?? 0;
        totalOutputTokens += response.usage?.completionTokens ?? 0;

        const choice = response.choices[0];
        const assistantMessage = choice?.message as AssistantMessage | undefined;

        // Extract text content
        const textContent = typeof assistantMessage?.content === 'string'
          ? assistantMessage.content
          : '';

        // Check for tool calls
        const toolCallsInResponse = assistantMessage?.toolCalls ?? [];

        // If no tool calls, we're done
        if (toolCallsInResponse.length === 0 || choice?.finishReason === 'stop') {
          finalContent = textContent;
          break;
        }

        // Execute all tool calls
        const toolCalls = toolCallsInResponse.map((tc: ChatMessageToolCall) => ({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
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

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: textContent || undefined,
          toolCalls: toolCallsInResponse.map((tc: ChatMessageToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });

        // Add tool results as separate messages
        for (const r of toolResults) {
          messages.push({
            role: 'tool',
            content: r.result,
            toolCallId: r.id,
          });
        }

        toolRounds++;
      }

      // If we exhausted tool rounds without getting final content, make one more call WITHOUT tools
      if (finalContent === '' && messages.length > 0) {
        messages.push({
          role: 'user',
          content: 'You have gathered enough information. Now write the complete markdown output based on what you learned. Do not use any more tools.',
        });

        const finalResponse = await this.client.chat.send({
          model: this.model,
          maxTokens: options.maxTokens ?? 4000,
          messages,
          stream: false,
          // Omit tools to force text output
        }) as ChatResponse;

        totalInputTokens += finalResponse.usage?.promptTokens ?? 0;
        totalOutputTokens += finalResponse.usage?.completionTokens ?? 0;

        const finalMessage = finalResponse.choices[0]?.message;
        finalContent = typeof finalMessage?.content === 'string' ? finalMessage.content : '';
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
      if (error instanceof Error) {
        throw new Error(`OpenRouter API error: ${error.message}`);
      }
      throw error;
    }
  }
}

/**
 * Create an OpenRouter LLM service from environment variables.
 */
export function createOpenRouterLLM(options?: {
  apiKey?: string;
  model?: string;
  rateLimit?: Partial<RateLimitConfig>;
}): OpenRouterLLMService {
  const apiKey = options?.apiKey ?? process.env['OPENROUTER_API_KEY'];

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  return new OpenRouterLLMService(
    apiKey,
    options?.model ?? process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
    options?.rateLimit
  );
}
