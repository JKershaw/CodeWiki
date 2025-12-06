import {
  BaseLLMService,
  CompletionOptions,
  CompletionResult,
  ToolUseOptions,
  ToolUseResult,
  RateLimitConfig,
  calculateCost,
} from './llm-service.js';
import type { RequestInit as UndiciRequestInit } from 'undici';

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
 * Safely parse JSON tool arguments, returning empty object on failure.
 * Exported for testing.
 */
export function safeParseToolArguments(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) {
    return {};
  }
  if (typeof args !== 'string') {
    console.warn('[LLM] Tool arguments is not a string:', typeof args);
    return {};
  }
  if (args.trim() === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(args);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    console.warn('[LLM] Parsed tool arguments is not an object:', typeof parsed);
    return {};
  } catch (error) {
    console.error('[LLM] Failed to parse tool arguments:', args, error);
    return {};
  }
}

/**
 * Check if a tool call has the expected structure.
 * Exported for testing.
 */
export function isValidToolCall(tc: unknown): tc is { id: string; function: { name: string; arguments: string } } {
  if (typeof tc !== 'object' || tc === null) return false;
  const obj = tc as Record<string, unknown>;
  if (typeof obj['id'] !== 'string') return false;
  if (typeof obj['function'] !== 'object' || obj['function'] === null) return false;
  const fn = obj['function'] as Record<string, unknown>;
  if (typeof fn['name'] !== 'string') return false;
  // arguments can be undefined/null for some models, we'll handle that in safeParseToolArguments
  return true;
}

/**
 * Attempt to extract a tool call from text content.
 * Some models output tool calls as JSON text instead of using the tool_calls API.
 * Returns the parsed tool call or null if not found.
 * Exported for testing.
 */
export function extractToolCallFromText(content: string, toolNames: string[]): {
  name: string;
  input: Record<string, unknown>;
  remainingContent: string;
} | null {
  if (!content || toolNames.length === 0) return null;

  // Try to find JSON object in the content that looks like a tool call
  // Pattern: {"type": "function", "name": "tool_name", "parameters": {...}}
  // Or simpler: {"name": "tool_name", "parameters": {...}}
  const jsonPattern = /\{[^{}]*"(?:type"\s*:\s*"function"\s*,\s*)?"name"\s*:\s*"([^"]+)"[^{}]*"parameters"\s*:\s*(\{[^{}]*\})[^{}]*\}/;
  const match = content.match(jsonPattern);

  if (match) {
    const toolName = match[1];
    const paramsJson = match[2];

    // Verify this is a known tool
    if (toolName && toolNames.includes(toolName)) {
      try {
        const params = JSON.parse(paramsJson);
        const remainingContent = content.replace(match[0], '').trim();
        console.log(`[LLM] Extracted text-based tool call: ${toolName}`);
        return {
          name: toolName,
          input: typeof params === 'object' && params !== null ? params : {},
          remainingContent,
        };
      } catch {
        // JSON parse failed, ignore
      }
    }
  }

  return null;
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
    // Cast to undici's RequestInit which includes the dispatcher property
    const options = { ...init, dispatcher } as UndiciRequestInit;
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
  private provider: string | undefined;
  private allowFallbacks: boolean;
  private fetchFn: typeof fetch | null = null;

  constructor(
    apiKey: string,
    model = 'anthropic/claude-sonnet-4.5',
    rateLimit?: Partial<RateLimitConfig>,
    provider?: string,
    allowFallbacks = true
  ) {
    super(model, {
      maxRequestsPerMinute: rateLimit?.maxRequestsPerMinute ?? 50,
      maxCostPerHour: rateLimit?.maxCostPerHour ?? 5,
    });
    this.apiKey = apiKey;
    this.provider = provider;
    this.allowFallbacks = allowFallbacks;
    if (provider) {
      console.log(`[LLM] Preferred provider configured: ${provider} (fallbacks: ${allowFallbacks})`);
    }
  }

  private async getFetch(): Promise<typeof fetch> {
    if (!this.fetchFn) {
      this.fetchFn = await getProxyFetch();
    }
    return this.fetchFn;
  }

  /**
   * Build the provider configuration object for OpenRouter requests.
   * Returns undefined if no provider is configured.
   */
  private getProviderConfig(): { order: string[]; allow_fallbacks: boolean } | undefined {
    if (!this.provider) {
      return undefined;
    }
    return {
      order: [this.provider],
      allow_fallbacks: this.allowFallbacks,
    };
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
      const providerConfig = this.getProviderConfig();
      const response = await this.callAPI({
        model: this.model,
        max_tokens: options.maxTokens ?? 2000,
        messages,
        ...(options.stopSequences ? { stop: options.stopSequences } : {}),
        ...(providerConfig ? { provider: providerConfig } : {}),
      });

      const content = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      const result: CompletionResult = {
        content,
        inputTokens,
        outputTokens,
        costUsd: await calculateCost(this.model, inputTokens, outputTokens),
        model: this.model,
        truncated: response.choices[0]?.finish_reason === 'length',
      };

      this.trackUsage(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[LLM] Completion failed:', errorMessage);
      throw new Error(`OpenRouter API error: ${errorMessage}`);
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
      const providerConfig = this.getProviderConfig();
      while (toolRounds < maxRounds) {
        const response = await this.callAPI({
          model: this.model,
          max_tokens: options.maxTokens ?? 4000,
          messages,
          tools,
          tool_choice: 'auto',
          ...(providerConfig ? { provider: providerConfig } : {}),
        });

        totalInputTokens += response.usage?.prompt_tokens ?? 0;
        totalOutputTokens += response.usage?.completion_tokens ?? 0;

        const choice = response.choices[0];
        const assistantMessage = choice?.message;
        const textContent = assistantMessage?.content ?? '';
        const toolCallsInResponse = assistantMessage?.tool_calls ?? [];

        // If no tool calls, check if model output a tool call as text (some models do this)
        // Note: Only check for absence of tool calls - some models incorrectly set
        // finish_reason='stop' even when they have tool_calls that need executing.
        // When tool_calls are present, we should always execute them.
        if (toolCallsInResponse.length === 0) {
          // Check for text-based tool calls (models that don't support function calling properly)
          const toolNames = options.tools.map(t => t.name);
          const textToolCall = extractToolCallFromText(textContent, toolNames);

          if (textToolCall) {
            // Execute the text-based tool call
            const syntheticId = `text-tool-${Date.now()}`;
            const toolResults = await options.executeTools([{
              id: syntheticId,
              name: textToolCall.name,
              input: textToolCall.input,
            }]);

            // Record the tool call
            allToolCalls.push({
              name: textToolCall.name,
              input: textToolCall.input,
              result: toolResults[0]!.result,
            });

            // Add assistant message (just the preamble text, not the JSON)
            messages.push({
              role: 'assistant',
              content: textToolCall.remainingContent || `Calling ${textToolCall.name}...`,
              tool_calls: [{
                id: syntheticId,
                type: 'function',
                function: {
                  name: textToolCall.name,
                  arguments: JSON.stringify(textToolCall.input),
                },
              }],
            });

            // Add tool result
            messages.push({
              role: 'tool',
              content: toolResults[0]!.result,
              tool_call_id: syntheticId,
            });

            toolRounds++;
            continue; // Continue the loop to get the model's response to the tool result
          }

          finalContent = textContent;
          break;
        }

        // Warn if response was truncated - tool call arguments may be incomplete
        if (choice?.finish_reason === 'length' && toolCallsInResponse.length > 0) {
          console.warn('[LLM] Response truncated (finish_reason=length) with pending tool calls - arguments may be incomplete. Consider increasing maxTokens.');
        }

        // Validate and filter tool calls, logging any malformed ones
        const validToolCalls = toolCallsInResponse.filter(tc => {
          if (!isValidToolCall(tc)) {
            console.warn('[LLM] Skipping malformed tool call:', JSON.stringify(tc));
            return false;
          }
          return true;
        });

        if (validToolCalls.length === 0) {
          console.warn('[LLM] All tool calls were malformed, ending tool loop');
          finalContent = textContent;
          break;
        }

        // Execute all valid tool calls with safe argument parsing
        const toolCalls = validToolCalls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          input: safeParseToolArguments(tc.function.arguments),
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

        // Add assistant message with tool calls (use validToolCalls to exclude malformed ones)
        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: validToolCalls,
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
          ...(providerConfig ? { provider: providerConfig } : {}),
        });

        totalInputTokens += finalResponse.usage?.prompt_tokens ?? 0;
        totalOutputTokens += finalResponse.usage?.completion_tokens ?? 0;
        finalContent = finalResponse.choices[0]?.message?.content ?? '';
      }

      const result: ToolUseResult = {
        content: finalContent,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: await calculateCost(this.model, totalInputTokens, totalOutputTokens),
        model: this.model,
        truncated: false,
        toolCalls: allToolCalls,
        toolRounds,
      };

      this.trackUsage(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[LLM] Tool completion failed:', errorMessage);
      throw new Error(`OpenRouter API error: ${errorMessage}`);
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
  provider?: string;
  allowFallbacks?: boolean;
}): OpenRouterLLMService {
  const apiKey = options?.apiKey ?? process.env['OPENROUTER_API_KEY'];

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  // Parse allowFallbacks from env var (defaults to true)
  const envAllowFallbacks = process.env['OPENROUTER_PROVIDER_ALLOW_FALLBACKS'];
  const allowFallbacks = options?.allowFallbacks ??
    (envAllowFallbacks !== undefined ? envAllowFallbacks.toLowerCase() === 'true' : true);

  return new OpenRouterLLMService(
    apiKey,
    options?.model ?? process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
    options?.rateLimit,
    options?.provider ?? process.env['OPENROUTER_PROVIDER'],
    allowFallbacks
  );
}
