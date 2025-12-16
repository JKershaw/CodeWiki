/**
 * Parse statistics assertion helpers for LLM tests.
 *
 * These helpers enable tests to verify that LLM responses are properly parsed
 * without relying on silent fallbacks. They expose parsing health metrics
 * that would otherwise be hidden by graceful degradation.
 */

import type { ParseStats } from '../../../src/agents/parsing/response-parser.js';

/**
 * Result of a parsing health check.
 */
export interface ParseHealthResult {
  /** Whether the parsing was considered healthy */
  healthy: boolean;
  /** List of fallbacks used during parsing */
  fallbacksUsed: string[];
  /** List of sections that failed to parse */
  failedSections: string[];
  /** Summary message */
  message: string;
}

/**
 * Custom assertion error for parsing assertions.
 */
export class ParseAssertionError extends Error {
  constructor(
    public readonly result: ParseHealthResult,
    public readonly parseStats: ParseStats
  ) {
    super(
      `Parsing assertion failed: ${result.message}\n` +
      `Fallbacks used: ${result.fallbacksUsed.join(', ') || 'none'}\n` +
      `Failed sections: ${result.failedSections.join(', ') || 'none'}\n` +
      `Successful sections: ${parseStats.sections.successful.join(', ') || 'none'}`
    );
    this.name = 'ParseAssertionError';
  }
}

/**
 * Assert that no fallbacks were used during parsing.
 *
 * Use this to verify that LLM output matches expected format without relying
 * on fallback patterns (markdown headers, prose extraction, default values).
 *
 * @param parseStats - The parse statistics from an agent result
 * @throws ParseAssertionError if any fallbacks were used
 */
export function assertNoFallbacks(parseStats: ParseStats | undefined): ParseHealthResult {
  if (!parseStats) {
    const result: ParseHealthResult = {
      healthy: false,
      fallbacksUsed: [],
      failedSections: [],
      message: 'parseStats not provided - agent may not expose parse statistics',
    };
    throw new ParseAssertionError(result, {
      agentType: 'unknown',
      successfulSections: 0,
      failedSections: 0,
      requiredFailures: 0,
      optionalFailures: 0,
      fallbacksUsed: [],
      sections: { successful: [], failed: [] },
    });
  }

  const result: ParseHealthResult = {
    healthy: parseStats.fallbacksUsed.length === 0,
    fallbacksUsed: parseStats.fallbacksUsed,
    failedSections: parseStats.sections.failed,
    message: parseStats.fallbacksUsed.length === 0
      ? 'No fallbacks used - parsing matched expected format'
      : `${parseStats.fallbacksUsed.length} fallback(s) used: ${parseStats.fallbacksUsed.join(', ')}`,
  };

  if (!result.healthy) {
    throw new ParseAssertionError(result, parseStats);
  }

  return result;
}

/**
 * Assert that required sections were successfully parsed.
 *
 * @param parseStats - The parse statistics from an agent result
 * @param requiredSections - List of section names that must be present
 * @throws ParseAssertionError if any required sections are missing
 */
export function assertParseSuccess(
  parseStats: ParseStats | undefined,
  requiredSections: string[]
): ParseHealthResult {
  if (!parseStats) {
    const result: ParseHealthResult = {
      healthy: false,
      fallbacksUsed: [],
      failedSections: [],
      message: 'parseStats not provided - agent may not expose parse statistics',
    };
    throw new ParseAssertionError(result, {
      agentType: 'unknown',
      successfulSections: 0,
      failedSections: 0,
      requiredFailures: 0,
      optionalFailures: 0,
      fallbacksUsed: [],
      sections: { successful: [], failed: [] },
    });
  }

  const successfulSet = new Set(parseStats.sections.successful.map(s => s.toUpperCase()));
  const missingSections = requiredSections.filter(s => !successfulSet.has(s.toUpperCase()));

  const result: ParseHealthResult = {
    healthy: missingSections.length === 0,
    fallbacksUsed: parseStats.fallbacksUsed,
    failedSections: missingSections,
    message: missingSections.length === 0
      ? `All ${requiredSections.length} required sections parsed successfully`
      : `Missing required sections: ${missingSections.join(', ')}`,
  };

  if (!result.healthy) {
    throw new ParseAssertionError(result, parseStats);
  }

  return result;
}

/**
 * Check parsing health without throwing errors.
 *
 * Use this for soft assertions where you want to log degradation metrics
 * without failing the test.
 *
 * @param parseStats - The parse statistics from an agent result
 * @returns Parse health result with metrics
 */
export function checkParseHealth(parseStats: ParseStats | undefined): ParseHealthResult {
  if (!parseStats) {
    return {
      healthy: false,
      fallbacksUsed: [],
      failedSections: [],
      message: 'parseStats not provided',
    };
  }

  const hasFallbacks = parseStats.fallbacksUsed.length > 0;
  const hasFailures = parseStats.failedSections > 0;

  return {
    healthy: !hasFallbacks && !hasFailures,
    fallbacksUsed: parseStats.fallbacksUsed,
    failedSections: parseStats.sections.failed,
    message: hasFallbacks || hasFailures
      ? `Degraded: ${parseStats.fallbacksUsed.length} fallbacks, ${parseStats.failedSections} failures`
      : 'Healthy: no fallbacks or failures',
  };
}

/**
 * Format parse health result for display in test output.
 */
export function formatParseHealth(
  testName: string,
  result: ParseHealthResult
): string {
  const status = result.healthy ? '\u2713' : '\u2717';
  const lines = [
    `${status} ${testName} - Parse Health`,
    `  Status: ${result.message}`,
  ];

  if (result.fallbacksUsed.length > 0) {
    lines.push('  Fallbacks used:');
    for (const fallback of result.fallbacksUsed) {
      lines.push(`    - ${fallback}`);
    }
  }

  if (result.failedSections.length > 0) {
    lines.push('  Failed sections:');
    for (const section of result.failedSections) {
      lines.push(`    - ${section}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get a summary of fallback usage by category.
 *
 * Useful for trend analysis to understand which sections most commonly
 * need fallbacks.
 */
export function categorizeFallbacks(
  parseStats: ParseStats | undefined
): Record<string, string[]> {
  if (!parseStats) {
    return {};
  }

  const categories: Record<string, string[]> = {
    markdown: [],
    prose: [],
    default: [],
    other: [],
  };

  for (const fallback of parseStats.fallbacksUsed) {
    if (fallback.includes('markdown')) {
      categories.markdown.push(fallback);
    } else if (fallback.includes('prose')) {
      categories.prose.push(fallback);
    } else if (fallback.includes('default')) {
      categories.default.push(fallback);
    } else {
      categories.other.push(fallback);
    }
  }

  return categories;
}
