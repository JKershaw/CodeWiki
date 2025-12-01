import {
  BaseLLMService,
  CompletionOptions,
  CompletionResult,
  ToolUseOptions,
  ToolUseResult,
  RateLimitConfig,
  calculateCost,
} from './llm-service.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Maximum number of retry attempts for transient failures */
const MAX_RETRIES = 3;

/** Initial backoff delay in milliseconds (doubles each retry) */
const INITIAL_BACKOFF_MS = 1000;

/**
 * Check if an HTTP status code is retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Check if an error is a retryable network error.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('eai_again') ||
    message.includes('certificate') ||
    message.includes('tls') ||
    message.includes('ssl')
  );
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * OpenAI-compatible message format.
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Get a fetch function that works with proxies if configured.
 */
async function getProxyFetch(): Promise<typeof fetch> {
  const proxyUrl = process.env['HTTPS_PROXY'] || process.env['HTTP_PROXY'] ||
                   process.env['https_proxy'] || process.env['http_proxy'];

  if (!proxyUrl) {
    return fetch;
  }

  const { ProxyAgent, fetch: undiciFetch } = await import('undici');
  const dispatcher = new ProxyAgent(proxyUrl);

  return (async (input: string | URL, init?: RequestInit) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = { ...init, dispatcher };
    const response = await undiciFetch(input as string, options);
    return response as unknown as Response;
  }) as typeof fetch;
}

/**
 * OpenRouter LLM service implementation.
 * Uses direct API calls for simplicity and control.
 */
export class OpenRouterLLMService extends BaseLLMService {
  private apiKey: string;
  private fetchFn: typeof fetch | null = null;

  constructor(
    apiKey: string,
    model = 'anthropic/claude-sonnet-4.5',
    rateLimit?: Partial<RateLimitConfig>
  ) {
    super(model, {
      maxRequestsPerMinute: rateLimit?.maxRequestsPerMinute ?? 50,
      maxCostPerHour: rateLimit?.maxCostPerHour ?? 5,
    });
    this.apiKey = apiKey;
  }

  private async getFetch(): Promise<typeof fetch> {
    if (!this.fetchFn) {
      this.fetchFn = await getProxyFetch();
    }
    return this.fetchFn;
  }

  private async callAPI(body: Record<string, unknown>): Promise<ChatResponse> {
    const fetchFn = await this.getFetch();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetchFn(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = new Error(`OpenRouter API error (${response.status}): ${errorText}`);

          // Retry on transient HTTP errors
          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            console.warn(`[LLM] Retry ${attempt}/${MAX_RETRIES} after ${response.status} error, waiting ${backoffMs}ms`);
            await sleep(backoffMs);
            continue;
          }

          console.error(`[LLM] Request failed after ${attempt} attempt(s): ${lastError.message}`);
          throw lastError;
        }

        return response.json() as Promise<ChatResponse>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Retry on network errors
        if (isNetworkError(error) && attempt < MAX_RETRIES) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.warn(`[LLM] Retry ${attempt}/${MAX_RETRIES} after network error, waiting ${backoffMs}ms: ${lastError.message}`);
          await sleep(backoffMs);
          continue;
        }

        console.error(`[LLM] Request failed after ${attempt} attempt(s): ${lastError.message}`);
        throw lastError;
      }
    }

    // Should not reach here, but throw last error if we do
    throw lastError ?? new Error('Unknown error in callAPI');
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    await this.waitForRateLimit();

    const messages: ChatMessage[] = [];

    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }

    for (const m of options.messages) {
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    try {
      const response = await this.callAPI({
        model: this.model,
        max_tokens: options.maxTokens ?? 2000,
        messages,
        ...(options.stopSequences ? { stop: options.stopSequences } : {}),
      });

      const content = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      const result: CompletionResult = {
        content,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(this.model, inputTokens, outputTokens),
        model: this.model,
        truncated: response.choices[0]?.finish_reason === 'length',
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

    const tools: ToolDefinition[] = options.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const messages: ChatMessage[] = [];

    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }

    for (const m of options.messages) {
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    const maxRounds = options.maxToolRounds ?? 5;
    const allToolCalls: ToolUseResult['toolCalls'] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolRounds = 0;
    let finalContent = '';

    try {
      while (toolRounds < maxRounds) {
        const response = await this.callAPI({
          model: this.model,
          max_tokens: options.maxTokens ?? 4000,
          messages,
          tools,
          tool_choice: 'auto',
        });

        totalInputTokens += response.usage?.prompt_tokens ?? 0;
        totalOutputTokens += response.usage?.completion_tokens ?? 0;

        const choice = response.choices[0];
        const assistantMessage = choice?.message;
        const textContent = assistantMessage?.content ?? '';
        const toolCallsInResponse = assistantMessage?.tool_calls ?? [];

        // If no tool calls, we're done
        if (toolCallsInResponse.length === 0 || choice?.finish_reason === 'stop') {
          finalContent = textContent;
          break;
        }

        // Execute all tool calls
        const toolCalls = toolCallsInResponse.map(tc => ({
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
          content: textContent || null,
          tool_calls: toolCallsInResponse,
        });

        // Add tool results
        for (const r of toolResults) {
          messages.push({
            role: 'tool',
            content: r.result,
            tool_call_id: r.id,
          });
        }

        toolRounds++;
      }

      // If we exhausted tool rounds, force a final response
      if (finalContent === '' && messages.length > 0) {
        messages.push({
          role: 'user',
          content: 'You have gathered enough information. Now write the complete markdown output based on what you learned. Do not use any more tools.',
        });

        const finalResponse = await this.callAPI({
          model: this.model,
          max_tokens: options.maxTokens ?? 4000,
          messages,
        });

        totalInputTokens += finalResponse.usage?.prompt_tokens ?? 0;
        totalOutputTokens += finalResponse.usage?.completion_tokens ?? 0;
        finalContent = finalResponse.choices[0]?.message?.content ?? '';
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
