/**
 * LLM Service - Abstracted interface for language model calls.
 *
 * The specific provider can change (OpenAI, Anthropic, etc.)
 * Rate limiting and cost tracking are built in from the start.
 */

/**
 * A message in a conversation.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for an LLM completion request.
 */
export interface CompletionOptions {
  /** System prompt */
  system?: string;
  /** Messages in the conversation */
  messages: Message[];
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Stop sequences */
  stopSequences?: string[];
}

/**
 * Result of an LLM completion.
 */
export interface CompletionResult {
  /** The generated text */
  content: string;
  /** Number of input tokens used */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Estimated cost in USD */
  costUsd: number;
  /** Model used */
  model: string;
  /** Whether the response was truncated */
  truncated: boolean;
}

/**
 * Usage statistics for tracking costs.
 */
export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

/**
 * Options for tool-using completions.
 */
export interface ToolUseOptions extends CompletionOptions {
  /** Tool definitions available to the LLM */
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  /** Maximum number of tool call rounds (default: 5) */
  maxToolRounds?: number;
  /**
   * Force the model to use tools for the first N rounds.
   * Uses tool_choice: "required" until this many rounds have completed.
   * Helps ensure the model engages with tools before producing final output.
   */
  forceToolUseRounds?: number;
  /**
   * Custom prompt to use when forcing final output after exhausting tool rounds.
   * If not provided, uses a generic prompt asking for markdown output.
   */
  finalOutputPrompt?: string;
  /** Function to execute tools */
  executeTools: (
    calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  ) => Promise<Array<{ id: string; result: string }>>;
}

/**
 * Result of a tool-using completion.
 */
export interface ToolUseResult extends CompletionResult {
  /** Tool calls made during the completion */
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result: string;
  }>;
  /** Number of tool rounds used */
  toolRounds: number;
}

/**
 * LLM Service interface.
 */
export interface LLMService {
  /**
   * Generate a completion.
   */
  complete(options: CompletionOptions): Promise<CompletionResult>;

  /**
   * Generate a completion with tool use support.
   */
  completeWithTools(options: ToolUseOptions): Promise<ToolUseResult>;

  /**
   * Get current usage statistics.
   */
  getUsageStats(): UsageStats;

  /**
   * Reset usage statistics.
   */
  resetUsageStats(): void;

  /**
   * Check if rate limited.
   */
  isRateLimited(): boolean;

  /**
   * Get detailed rate limit status for observability.
   */
  getRateLimitStatus(): RateLimitStatus;

  /**
   * Get the model name.
   */
  getModel(): string;
}

/**
 * Rate limiter configuration.
 */
export interface RateLimitConfig {
  /** Maximum requests per minute */
  maxRequestsPerMinute: number;
  /** Maximum cost per hour in USD */
  maxCostPerHour: number;
}

/**
 * Detailed rate limit status for better observability.
 */
export interface RateLimitStatus {
  /** Whether currently rate limited */
  isLimited: boolean;
  /** Reason for rate limiting, if applicable */
  reason: 'requests_per_minute' | 'cost_per_hour' | null;
  /** Estimated seconds until rate limit clears */
  clearsInSeconds: number | null;
  /** Current requests in the last minute */
  currentRequests: number;
  /** Maximum requests per minute */
  maxRequests: number;
  /** Current hourly cost in USD */
  currentHourlyCost: number;
  /** Maximum hourly cost in USD */
  maxHourlyCost: number;
}

/**
 * Base class for LLM services with rate limiting and cost tracking.
 */
export abstract class BaseLLMService implements LLMService {
  protected stats: UsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    requestCount: 0,
  };

  protected requestTimestamps: number[] = [];
  protected hourlySpend: { timestamp: number; cost: number }[] = [];

  constructor(
    protected readonly model: string,
    protected readonly rateLimit: RateLimitConfig
  ) {}

  abstract complete(options: CompletionOptions): Promise<CompletionResult>;
  abstract completeWithTools(options: ToolUseOptions): Promise<ToolUseResult>;

  getModel(): string {
    return this.model;
  }

  getUsageStats(): UsageStats {
    return { ...this.stats };
  }

  resetUsageStats(): void {
    this.stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
    };
  }

  isRateLimited(): boolean {
    return this.getRateLimitStatus().isLimited;
  }

  getRateLimitStatus(): RateLimitStatus {
    const now = Date.now();

    // Check requests per minute
    const oneMinuteAgo = now - 60_000;
    const recentRequests = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    const requestLimited = recentRequests.length >= this.rateLimit.maxRequestsPerMinute;

    // Check cost per hour
    const oneHourAgo = now - 3600_000;
    const recentSpend = this.hourlySpend.filter(s => s.timestamp > oneHourAgo);
    const hourlyTotal = recentSpend.reduce((sum, s) => sum + s.cost, 0);
    const costLimited = hourlyTotal >= this.rateLimit.maxCostPerHour;

    // Calculate time until rate limit clears
    let clearsInSeconds: number | null = null;
    let reason: 'requests_per_minute' | 'cost_per_hour' | null = null;

    if (requestLimited && recentRequests.length > 0) {
      // Find oldest request timestamp and calculate when it expires
      const oldestRequest = Math.min(...recentRequests);
      clearsInSeconds = Math.ceil((oldestRequest + 60_000 - now) / 1000);
      reason = 'requests_per_minute';
    } else if (costLimited && recentSpend.length > 0) {
      // Find oldest spend entry and calculate when it expires
      const oldestSpend = Math.min(...recentSpend.map(s => s.timestamp));
      clearsInSeconds = Math.ceil((oldestSpend + 3600_000 - now) / 1000);
      reason = 'cost_per_hour';
    }

    return {
      isLimited: requestLimited || costLimited,
      reason,
      clearsInSeconds,
      currentRequests: recentRequests.length,
      maxRequests: this.rateLimit.maxRequestsPerMinute,
      currentHourlyCost: hourlyTotal,
      maxHourlyCost: this.rateLimit.maxCostPerHour,
    };
  }

  protected trackUsage(result: CompletionResult): void {
    const now = Date.now();

    this.stats.totalInputTokens += result.inputTokens;
    this.stats.totalOutputTokens += result.outputTokens;
    this.stats.totalCostUsd += result.costUsd;
    this.stats.requestCount++;

    this.requestTimestamps.push(now);
    this.hourlySpend.push({ timestamp: now, cost: result.costUsd });

    // Clean up old entries
    const oneHourAgo = now - 3600_000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneHourAgo);
    this.hourlySpend = this.hourlySpend.filter(s => s.timestamp > oneHourAgo);
  }

  protected async waitForRateLimit(): Promise<void> {
    while (this.isRateLimited()) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Cost per 1M tokens for different models.
 * Uses OpenRouter model naming format (provider/model-name).
 */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI models
  'openai/gpt-4': { input: 30, output: 60 },
  'openai/gpt-4-turbo': { input: 10, output: 30 },
  'openai/gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Anthropic models
  'anthropic/claude-3-opus': { input: 15, output: 75 },
  'anthropic/claude-3-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'anthropic/claude-opus-4.5': { input: 5, output: 25 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  'anthropic/claude-3.5-haiku': { input: 0.8, output: 4 },
  // Google models
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  'google/gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'google/gemini-2.0-flash-exp:free': { input: 0, output: 0 },
  // DeepSeek models (very cheap)
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },
  // MiniMax models
  'minimax/minimax-m2': { input: 0.255, output: 1.02 },
  // xAI models
  'x-ai/grok-4.1-fast:free': { input: 0, output: 0 },
  // Meta Llama models
  'meta-llama/llama-4-maverick': { input: 0.136, output: 0.68 },
  // Qwen models
  'qwen/qwen-turbo': { input: 0.05, output: 0.2 },
  // Mock
  'mock': { input: 0, output: 0 },
};

/**
 * Calculate cost for a completion.
 * Fetches pricing from OpenRouter API on first call, falls back to MODEL_COSTS.
 */
export async function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> {
  const { getModelCost } = await import('./model-cache.js');
  const costs = await getModelCost(model);
  const inputCost = (inputTokens / 1_000_000) * costs.input;
  const outputCost = (outputTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}
