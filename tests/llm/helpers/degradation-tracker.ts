/**
 * Degradation Tracker for LLM Test Suite.
 *
 * Tracks degradation metrics over time to enable trend analysis.
 * Even when allowing degraded operation, this helps identify regressions
 * and measure improvements.
 *
 * Metrics tracked:
 * - Fallback usage rate per section type
 * - Path removal rate
 * - Prose extraction usage rate
 * - Default confidence usage rate
 */

import type { ParseStats } from '../../../src/agents/parsing/response-parser.js';

/**
 * Degradation metrics for a single agent run.
 */
export interface DegradationMetrics {
  /** Number of fallbacks used by section type */
  fallbacksByType: {
    summary: number;
    findings: number;
    wikiPages: number;
    confidence: number;
    other: number;
  };
  /** Total fallbacks across all sections */
  totalFallbacks: number;
  /** Number of paths removed during validation */
  pathsRemoved: number;
  /** Whether prose extraction was used */
  proseExtractionsUsed: number;
  /** Whether default confidence was used */
  defaultConfidenceUsed: boolean;
  /** Number of failed sections */
  failedSections: number;
  /** Overall degradation score (0-100, lower is better) */
  degradationScore: number;
}

/**
 * Aggregate degradation metrics across multiple runs.
 */
export interface AggregateDegradationMetrics {
  /** Total runs tracked */
  totalRuns: number;
  /** Runs with no degradation */
  cleanRuns: number;
  /** Clean run percentage */
  cleanRunRate: number;
  /** Average degradation score */
  avgDegradationScore: number;
  /** Total fallbacks across all runs */
  totalFallbacks: number;
  /** Fallback breakdown by type */
  fallbacksByType: {
    summary: number;
    findings: number;
    wikiPages: number;
    confidence: number;
    other: number;
  };
  /** Total paths removed across all runs */
  totalPathsRemoved: number;
  /** Runs with prose extraction */
  runsWithProseExtraction: number;
  /** Runs with default confidence */
  runsWithDefaultConfidence: number;
}

/**
 * Calculate degradation metrics from parse stats and removed paths.
 *
 * @param parseStats - Parse statistics from an agent result
 * @param removedPaths - Paths removed during validation
 * @returns Degradation metrics for this run
 */
export function calculateDegradationMetrics(
  parseStats: ParseStats | undefined,
  removedPaths: string[] = []
): DegradationMetrics {
  if (!parseStats) {
    return {
      fallbacksByType: { summary: 0, findings: 0, wikiPages: 0, confidence: 0, other: 0 },
      totalFallbacks: 0,
      pathsRemoved: removedPaths.length,
      proseExtractionsUsed: 0,
      defaultConfidenceUsed: false,
      failedSections: 0,
      degradationScore: 0,
    };
  }

  // Categorize fallbacks
  const fallbacksByType = {
    summary: 0,
    findings: 0,
    wikiPages: 0,
    confidence: 0,
    other: 0,
  };

  let proseExtractionsUsed = 0;
  let defaultConfidenceUsed = false;

  for (const fallback of parseStats.fallbacksUsed) {
    const upper = fallback.toUpperCase();

    if (upper.includes('SUMMARY')) {
      fallbacksByType.summary++;
      if (upper.includes('PROSE')) {
        proseExtractionsUsed++;
      }
    } else if (upper.includes('FINDING')) {
      fallbacksByType.findings++;
    } else if (upper.includes('WIKI') || upper.includes('PAGE')) {
      fallbacksByType.wikiPages++;
      if (upper.includes('PROSE')) {
        proseExtractionsUsed++;
      }
    } else if (upper.includes('CONFIDENCE')) {
      fallbacksByType.confidence++;
      if (upper.includes('DEFAULT')) {
        defaultConfidenceUsed = true;
      }
    } else {
      fallbacksByType.other++;
    }
  }

  const totalFallbacks = parseStats.fallbacksUsed.length;

  // Calculate degradation score (0-100, lower is better)
  // Weights: fallbacks=3, pathsRemoved=2, prose=5, defaultConfidence=1
  const degradationScore = Math.min(100,
    totalFallbacks * 3 +
    removedPaths.length * 2 +
    proseExtractionsUsed * 5 +
    (defaultConfidenceUsed ? 1 : 0)
  );

  return {
    fallbacksByType,
    totalFallbacks,
    pathsRemoved: removedPaths.length,
    proseExtractionsUsed,
    defaultConfidenceUsed,
    failedSections: parseStats.failedSections,
    degradationScore,
  };
}

/**
 * Tracker for accumulating degradation metrics across multiple runs.
 */
export class DegradationTracker {
  private runs: DegradationMetrics[] = [];

  /**
   * Add a run's metrics to the tracker.
   */
  addRun(parseStats: ParseStats | undefined, removedPaths: string[] = []): DegradationMetrics {
    const metrics = calculateDegradationMetrics(parseStats, removedPaths);
    this.runs.push(metrics);
    return metrics;
  }

  /**
   * Get aggregate metrics across all tracked runs.
   */
  getAggregate(): AggregateDegradationMetrics {
    if (this.runs.length === 0) {
      return {
        totalRuns: 0,
        cleanRuns: 0,
        cleanRunRate: 1,
        avgDegradationScore: 0,
        totalFallbacks: 0,
        fallbacksByType: { summary: 0, findings: 0, wikiPages: 0, confidence: 0, other: 0 },
        totalPathsRemoved: 0,
        runsWithProseExtraction: 0,
        runsWithDefaultConfidence: 0,
      };
    }

    const cleanRuns = this.runs.filter(r => r.degradationScore === 0).length;
    const avgScore = this.runs.reduce((sum, r) => sum + r.degradationScore, 0) / this.runs.length;
    const totalFallbacks = this.runs.reduce((sum, r) => sum + r.totalFallbacks, 0);
    const totalPathsRemoved = this.runs.reduce((sum, r) => sum + r.pathsRemoved, 0);
    const runsWithProse = this.runs.filter(r => r.proseExtractionsUsed > 0).length;
    const runsWithDefault = this.runs.filter(r => r.defaultConfidenceUsed).length;

    const fallbacksByType = {
      summary: this.runs.reduce((sum, r) => sum + r.fallbacksByType.summary, 0),
      findings: this.runs.reduce((sum, r) => sum + r.fallbacksByType.findings, 0),
      wikiPages: this.runs.reduce((sum, r) => sum + r.fallbacksByType.wikiPages, 0),
      confidence: this.runs.reduce((sum, r) => sum + r.fallbacksByType.confidence, 0),
      other: this.runs.reduce((sum, r) => sum + r.fallbacksByType.other, 0),
    };

    return {
      totalRuns: this.runs.length,
      cleanRuns,
      cleanRunRate: cleanRuns / this.runs.length,
      avgDegradationScore: avgScore,
      totalFallbacks,
      fallbacksByType,
      totalPathsRemoved,
      runsWithProseExtraction: runsWithProse,
      runsWithDefaultConfidence: runsWithDefault,
    };
  }

  /**
   * Reset the tracker.
   */
  reset(): void {
    this.runs = [];
  }

  /**
   * Get all individual run metrics.
   */
  getRuns(): DegradationMetrics[] {
    return [...this.runs];
  }
}

/**
 * Format degradation metrics for console output.
 */
export function formatDegradationMetrics(
  testName: string,
  metrics: DegradationMetrics
): string {
  const status = metrics.degradationScore === 0 ? '\u2713' : '\u2717';
  const lines = [
    `${status} ${testName} - Degradation Score: ${metrics.degradationScore}`,
  ];

  if (metrics.totalFallbacks > 0) {
    lines.push(`  Fallbacks: ${metrics.totalFallbacks}`);
    const types = metrics.fallbacksByType;
    const breakdown = [
      types.summary > 0 ? `summary=${types.summary}` : '',
      types.findings > 0 ? `findings=${types.findings}` : '',
      types.wikiPages > 0 ? `wiki=${types.wikiPages}` : '',
      types.confidence > 0 ? `confidence=${types.confidence}` : '',
      types.other > 0 ? `other=${types.other}` : '',
    ].filter(Boolean).join(', ');
    if (breakdown) {
      lines.push(`    [${breakdown}]`);
    }
  }

  if (metrics.pathsRemoved > 0) {
    lines.push(`  Paths removed: ${metrics.pathsRemoved}`);
  }

  if (metrics.proseExtractionsUsed > 0) {
    lines.push(`  Prose extractions: ${metrics.proseExtractionsUsed}`);
  }

  if (metrics.defaultConfidenceUsed) {
    lines.push(`  Default confidence used: yes`);
  }

  return lines.join('\n');
}

/**
 * Format aggregate metrics for console output.
 */
export function formatAggregateDegradation(
  metrics: AggregateDegradationMetrics
): string {
  const lines = [
    '\n=====================================',
    '    AGGREGATE DEGRADATION METRICS',
    '=====================================',
    `Total runs: ${metrics.totalRuns}`,
    `Clean runs: ${metrics.cleanRuns}/${metrics.totalRuns} (${(metrics.cleanRunRate * 100).toFixed(1)}%)`,
    `Avg degradation score: ${metrics.avgDegradationScore.toFixed(1)}`,
    '',
    'Fallback breakdown:',
    `  Summary: ${metrics.fallbacksByType.summary}`,
    `  Findings: ${metrics.fallbacksByType.findings}`,
    `  Wiki Pages: ${metrics.fallbacksByType.wikiPages}`,
    `  Confidence: ${metrics.fallbacksByType.confidence}`,
    `  Other: ${metrics.fallbacksByType.other}`,
    `  TOTAL: ${metrics.totalFallbacks}`,
    '',
    `Paths removed: ${metrics.totalPathsRemoved}`,
    `Runs with prose extraction: ${metrics.runsWithProseExtraction}`,
    `Runs with default confidence: ${metrics.runsWithDefaultConfidence}`,
    '=====================================',
  ];

  return lines.join('\n');
}

/**
 * Create a JSON-serializable degradation report.
 */
export function createDegradationReport(
  aggregate: AggregateDegradationMetrics,
  runs: DegradationMetrics[]
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalRuns: aggregate.totalRuns,
      cleanRunRate: aggregate.cleanRunRate,
      avgDegradationScore: aggregate.avgDegradationScore,
    },
    totals: {
      fallbacks: aggregate.totalFallbacks,
      pathsRemoved: aggregate.totalPathsRemoved,
      proseExtractions: aggregate.runsWithProseExtraction,
      defaultConfidence: aggregate.runsWithDefaultConfidence,
    },
    fallbackBreakdown: aggregate.fallbacksByType,
    runs: runs.map((r, i) => ({
      runIndex: i,
      degradationScore: r.degradationScore,
      fallbacks: r.totalFallbacks,
      pathsRemoved: r.pathsRemoved,
    })),
  };
}
