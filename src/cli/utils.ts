/**
 * Shared CLI utilities.
 */

import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createOpenRouterLLM } from '../services/llm/openrouter-llm-service.js';
import type { LLMService } from '../services/llm/llm-service.js';

/**
 * Create the appropriate LLM service based on environment.
 */
export function createLLM(): LLMService {
  const apiKey = process.env['OPENROUTER_API_KEY'];

  if (apiKey) {
    const model = process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5';
    console.log(`Using OpenRouter API (model: ${model})\n`);
    return createOpenRouterLLM({ apiKey, model });
  }

  console.log('Using mock LLM (set OPENROUTER_API_KEY for real analysis)\n');
  return createMockLLMForCodeAnalysis();
}
