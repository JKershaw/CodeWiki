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
 * LLM Service interface.
 */
export interface LLMService {
  /**
   * Generate a completion.
   */
  complete(options: CompletionOptions): Promise<CompletionResult>;

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
    const now = Date.now();

    // Check requests per minute
    const oneMinuteAgo = now - 60_000;
    const recentRequests = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    if (recentRequests.length >= this.rateLimit.maxRequestsPerMinute) {
      return true;
    }

    // Check cost per hour
    const oneHourAgo = now - 3600_000;
    const hourlyTotal = this.hourlySpend
      .filter(s => s.timestamp > oneHourAgo)
      .reduce((sum, s) => sum + s.cost, 0);
    if (hourlyTotal >= this.rateLimit.maxCostPerHour) {
      return true;
    }

    return false;
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
 */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-haiku-4-5-20250929': { input: 1, output: 5 },  // Haiku 4.5 - good for JSON
  'mock': { input: 0, output: 0 },
};

/**
 * Calculate cost for a completion.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model] ?? MODEL_COSTS['gpt-4']!;
  const inputCost = (inputTokens / 1_000_000) * costs.input;
  const outputCost = (outputTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}
