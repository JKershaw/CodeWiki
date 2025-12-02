/**
 * Model Cache - Fetches and caches model pricing from OpenRouter API.
 *
 * Provides dynamic model pricing lookup instead of hardcoded values.
 * Falls back to static MODEL_COSTS when API is unavailable.
 */

import { MODEL_COSTS } from './llm-service.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Cached model costs (null = not yet fetched) */
let modelCache: Map<string, { input: number; output: number }> | null = null;

/** Whether we've attempted to fetch (to avoid retrying on failure) */
let fetchAttempted = false;

/**
 * Response structure from OpenRouter /api/v1/models endpoint.
 */
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    pricing?: {
      prompt?: string;
      completion?: string;
    };
  }>;
}

/**
 * Convert per-token price string to per-million-token number.
 * OpenRouter returns prices as strings like "0.000003" (per token).
 * We store prices as numbers like 3 (per million tokens).
 */
function convertPriceToPerMillion(priceStr: string | undefined): number {
  if (!priceStr) return 0;
  const perToken = parseFloat(priceStr);
  if (isNaN(perToken)) return 0;
  return perToken * 1_000_000;
}

/**
 * Fetch all models from OpenRouter API and populate the cache.
 * Returns true if successful, false if failed.
 */
export async function fetchModelsFromAPI(): Promise<boolean> {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[ModelCache] Failed to fetch models: ${response.status}`);
      return false;
    }

    const data = (await response.json()) as OpenRouterModelsResponse;

    if (!data.data || !Array.isArray(data.data)) {
      console.warn('[ModelCache] Invalid response structure from API');
      return false;
    }

    modelCache = new Map();

    for (const model of data.data) {
      if (model.id && model.pricing) {
        modelCache.set(model.id, {
          input: convertPriceToPerMillion(model.pricing.prompt),
          output: convertPriceToPerMillion(model.pricing.completion),
        });
      }
    }

    console.log(`[ModelCache] Cached pricing for ${modelCache.size} models`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ModelCache] Error fetching models: ${message}`);
    return false;
  }
}

/**
 * Get cost information for a model.
 * Fetches from API on first call, then uses cache.
 * Falls back to MODEL_COSTS if API unavailable.
 */
export async function getModelCost(
  model: string
): Promise<{ input: number; output: number }> {
  // Try to fetch from API if we haven't yet
  if (!modelCache && !fetchAttempted) {
    fetchAttempted = true;
    await fetchModelsFromAPI();
  }

  // Check dynamic cache first
  if (modelCache) {
    const cached = modelCache.get(model);
    if (cached) {
      return cached;
    }
  }

  // Fall back to static MODEL_COSTS
  const staticCost = MODEL_COSTS[model];
  if (staticCost) {
    return staticCost;
  }

  // Ultimate fallback to GPT-4 pricing
  return MODEL_COSTS['openai/gpt-4']!;
}

/**
 * Clear the model cache. Useful for testing.
 */
export function clearModelCache(): void {
  modelCache = null;
  fetchAttempted = false;
}

/**
 * Check if the cache has been populated.
 * Useful for testing.
 */
export function isCachePopulated(): boolean {
  return modelCache !== null;
}
