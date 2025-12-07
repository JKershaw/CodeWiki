/**
 * LLM-as-Judge assertion helpers for real LLM tests.
 *
 * Uses an LLM to evaluate semantic correctness where exact string matching isn't possible.
 */

import { createOpenRouterLLM } from '../../../src/services/llm/openrouter-llm-service.js';
import type { LLMService } from '../../../src/services/llm/llm-service.js';

/**
 * Result of an LLM evaluation.
 */
export interface EvaluationResult {
  /** Score from 0-10 */
  score: number;
  /** Whether the evaluation passed (score >= threshold) */
  passed: boolean;
  /** Reasoning for the score */
  reasoning: string;
  /** Suggestions for improvement */
  improvements: string[];
}

/**
 * Get the LLM service for evaluations.
 * Uses the configured model from environment variables.
 */
let llmService: LLMService | null = null;

export function getLLMService(): LLMService {
  if (!llmService) {
    llmService = createOpenRouterLLM();
  }
  return llmService;
}

/**
 * Reset the LLM service (useful for testing).
 */
export function resetLLMService(): void {
  llmService = null;
}

/**
 * Evaluate evidence against criteria using an LLM.
 *
 * @param criteria - What the evidence should demonstrate
 * @param evidence - The output to evaluate
 * @param threshold - Minimum score to pass (default: 7)
 * @returns Evaluation result with score, reasoning, and improvements
 */
export async function evaluateLLM(
  criteria: string,
  evidence: string,
  threshold: number = 7
): Promise<EvaluationResult> {
  const llm = getLLMService();

  const response = await llm.complete({
    messages: [{
      role: 'user',
      content: `Evaluate the following output against the given criteria.

Criteria: ${criteria}

Evidence:
${evidence}

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "score": <0-10>,
  "reasoning": "<why you gave this score>",
  "improvements": ["<suggestion 1>", "<suggestion 2>"]
}

Be specific in your reasoning. A score of 7+ means the criteria is met.`
    }]
  });

  try {
    // Try to extract JSON from the response
    const content = response.content.trim();
    // Handle potential markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = jsonMatch[1]?.trim() || content;

    const result = JSON.parse(jsonStr);

    // Validate the result structure
    if (typeof result.score !== 'number' || result.score < 0 || result.score > 10) {
      throw new Error(`Invalid score: ${result.score}`);
    }
    if (typeof result.reasoning !== 'string') {
      result.reasoning = 'No reasoning provided';
    }
    if (!Array.isArray(result.improvements)) {
      result.improvements = [];
    }

    return {
      score: result.score,
      passed: result.score >= threshold,
      reasoning: result.reasoning,
      improvements: result.improvements,
    };
  } catch (error) {
    // If parsing fails, return a failing result
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      score: 0,
      passed: false,
      reasoning: `Failed to parse LLM response: ${errorMessage}. Raw response: ${response.content.substring(0, 200)}`,
      improvements: ['LLM response was not valid JSON'],
    };
  }
}

/**
 * Custom assertion error for LLM assertions.
 */
export class LLMAssertionError extends Error {
  constructor(
    public readonly result: EvaluationResult,
    public readonly criteria: string,
    public readonly threshold: number
  ) {
    super(
      `LLM assertion failed (score: ${result.score}/10, threshold: ${threshold})\n` +
      `Criteria: ${criteria}\n` +
      `Reasoning: ${result.reasoning}\n` +
      `Improvements: ${result.improvements.join(', ')}`
    );
    this.name = 'LLMAssertionError';
  }
}

/**
 * Assert that evidence meets criteria using an LLM evaluation.
 * Throws LLMAssertionError if the score is below threshold.
 *
 * @param criteria - What the evidence should demonstrate
 * @param evidence - The output to evaluate
 * @param threshold - Minimum score to pass (default: 7)
 * @returns The evaluation result (for logging even on success)
 */
export async function assertLLM(
  criteria: string,
  evidence: string,
  threshold: number = 7
): Promise<EvaluationResult> {
  const result = await evaluateLLM(criteria, evidence, threshold);

  if (!result.passed) {
    throw new LLMAssertionError(result, criteria, threshold);
  }

  return result;
}

/**
 * Format an evaluation result for display in test output.
 */
export function formatEvaluationResult(
  testName: string,
  result: EvaluationResult
): string {
  const status = result.passed ? '\u2713' : '\u2717';
  const lines = [
    `${status} ${testName}`,
    `  Score: ${result.score}/10`,
    `  Reasoning: ${result.reasoning}`,
  ];

  if (result.improvements.length > 0) {
    lines.push('  Improvements:');
    for (const improvement of result.improvements) {
      lines.push(`    - ${improvement}`);
    }
  }

  return lines.join('\n');
}
