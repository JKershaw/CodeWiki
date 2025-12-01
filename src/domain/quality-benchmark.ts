/**
 * Domain types for the Wiki Quality Benchmark system.
 *
 * The quality benchmark measures wiki quality by evaluating sampled pages
 * across 8 quality dimensions, running evaluations in parallel.
 */

// ============================================================================
// Quality Dimensions
// ============================================================================

/**
 * The 8 quality dimensions we evaluate.
 */
export type QualityDimension =
  | 'contextual_richness'
  | 'coherence_consistency'
  | 'completeness_coverage'
  | 'actionability'
  | 'structural_quality'
  | 'confidence_calibration'
  | 'machine_readability'
  | 'information_density';

/**
 * All quality dimensions in order.
 */
export const QUALITY_DIMENSIONS: QualityDimension[] = [
  'contextual_richness',
  'coherence_consistency',
  'completeness_coverage',
  'actionability',
  'structural_quality',
  'confidence_calibration',
  'machine_readability',
  'information_density',
];

/**
 * Human-readable names for each dimension.
 */
export const DIMENSION_NAMES: Record<QualityDimension, string> = {
  contextual_richness: 'Contextual Richness',
  coherence_consistency: 'Coherence & Consistency',
  completeness_coverage: 'Completeness Coverage',
  actionability: 'Actionability',
  structural_quality: 'Structural Quality',
  confidence_calibration: 'Confidence Calibration',
  machine_readability: 'Machine Readability',
  information_density: 'Information Density',
};

/**
 * Descriptions for each dimension (used in prompts and UI).
 */
export const DIMENSION_DESCRIPTIONS: Record<QualityDimension, string> = {
  contextual_richness:
    'Does the wiki explain the "why" behind the code? Are architectural choices explained with trade-offs? Are rejected alternatives mentioned? Is historical context documented?',
  coherence_consistency:
    'Does the wiki tell a unified story? Same concepts use same terms? Related entries link appropriately? No contradictions?',
  completeness_coverage:
    'Are important things documented? Does it explicitly state scope and boundaries (what it does AND does not do)? Are assumptions and preconditions clear? Are failure modes, errors, and edge cases documented?',
  actionability:
    'Can someone actually use this documentation? Concrete examples with clear inputs, outputs, and expected behavior? How-to guidance? Troubleshooting info for common errors?',
  structural_quality:
    'Is the wiki well-organized? Does it follow layered depth (summary/purpose first, then progressive detail)? Logical hierarchy? Appropriate granularity? Easy to navigate?',
  confidence_calibration:
    'Are confidence scores meaningful? Good distribution? Uncertainty acknowledged appropriately?',
  machine_readability:
    'Can AI agents parse this effectively? Consistent formatting? Explicit relationship markers (deprecation notes, prerequisites, "see also" references)? Clear code-to-wiki mapping?',
  information_density:
    'Signal vs noise ratio. Concise? Relevant? No boilerplate? Provides insight beyond reading code?',
};

// ============================================================================
// Page Quality Result
// ============================================================================

/**
 * Quality evaluation result for a single page.
 */
export interface PageQualityResult {
  /** Reference to the page */
  pageId: string;
  /** Page path for display */
  pagePath: string;
  /** Page title */
  pageTitle: string;
  /** Scores for each dimension (0-100) */
  scores: Record<QualityDimension, number>;
  /** Overall reasoning for the scores */
  reasoning: string;
  /** Specific findings/issues discovered */
  findings: string[];
  /** Time taken to evaluate this page */
  durationMs: number;
  /** LLM cost for this evaluation */
  costUsd: number;
}

// ============================================================================
// Quality Benchmark Summary
// ============================================================================

/**
 * Summary statistics for a quality benchmark run.
 */
export interface QualityBenchmarkSummary {
  /** Number of pages evaluated */
  pagesEvaluated: number;
  /** Overall quality score (0-100, weighted average) */
  overallScore: number;
  /** Average score per dimension */
  byDimension: Record<QualityDimension, number>;
  /** Top performing dimensions (score >= 70) */
  strengths: QualityDimension[];
  /** Weakest dimensions (score < 50) */
  weaknesses: QualityDimension[];
}

// ============================================================================
// Quality Benchmark Run
// ============================================================================

/**
 * A complete quality benchmark run.
 */
export interface QualityBenchmarkRun {
  id: string;
  /** Reference to the repository */
  repoId: string;
  /** Reference to the wiki being benchmarked */
  wikiId: string;
  /** Wiki iteration count when benchmark was run */
  iterationCount: number;
  /** Number of pages in the wiki when benchmark was run */
  pageCount: number;
  /** Current status of the benchmark */
  status: QualityBenchmarkRunStatus;
  /** When the benchmark started */
  startedAt: Date;
  /** When the benchmark completed */
  completedAt: Date | null;
  /** Individual page results */
  results: PageQualityResult[];
  /** Aggregated summary */
  summary: QualityBenchmarkSummary;
  /** Total LLM cost for the benchmark */
  totalCostUsd: number;
  /** Error message if failed */
  error: string | null;
}

export type QualityBenchmarkRunStatus = 'running' | 'completed' | 'failed';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new quality benchmark run in running state.
 */
export function createQualityBenchmarkRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  iterationCount: number;
  pageCount: number;
}): QualityBenchmarkRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    iterationCount: params.iterationCount,
    pageCount: params.pageCount,
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    results: [],
    summary: createEmptyQualitySummary(),
    totalCostUsd: 0,
    error: null,
  };
}

/**
 * Create an empty quality summary.
 */
export function createEmptyQualitySummary(): QualityBenchmarkSummary {
  const byDimension = {} as Record<QualityDimension, number>;
  for (const dim of QUALITY_DIMENSIONS) {
    byDimension[dim] = 0;
  }

  return {
    pagesEvaluated: 0,
    overallScore: 0,
    byDimension,
    strengths: [],
    weaknesses: [],
  };
}

// ============================================================================
// Scoring Utilities
// ============================================================================

/**
 * Weights for each dimension when calculating overall score.
 * All dimensions weighted equally by default.
 */
export const DIMENSION_WEIGHTS: Record<QualityDimension, number> = {
  contextual_richness: 1.0,
  coherence_consistency: 1.0,
  completeness_coverage: 1.0,
  actionability: 1.0,
  structural_quality: 1.0,
  confidence_calibration: 0.5, // Lower weight - meta metric
  machine_readability: 0.5, // Lower weight - technical metric
  information_density: 1.0,
};

/**
 * Calculate the summary from page results.
 */
export function calculateQualitySummary(
  results: PageQualityResult[]
): QualityBenchmarkSummary {
  if (results.length === 0) {
    return createEmptyQualitySummary();
  }

  // Calculate average score per dimension
  const byDimension = {} as Record<QualityDimension, number>;
  for (const dim of QUALITY_DIMENSIONS) {
    const scores = results.map(r => r.scores[dim]);
    byDimension[dim] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Calculate weighted overall score
  let totalWeight = 0;
  let weightedSum = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    const weight = DIMENSION_WEIGHTS[dim];
    totalWeight += weight;
    weightedSum += byDimension[dim] * weight;
  }
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Identify strengths and weaknesses
  const strengths: QualityDimension[] = [];
  const weaknesses: QualityDimension[] = [];
  for (const dim of QUALITY_DIMENSIONS) {
    if (byDimension[dim] >= 70) {
      strengths.push(dim);
    } else if (byDimension[dim] < 50) {
      weaknesses.push(dim);
    }
  }

  // Sort by score (highest first for strengths, lowest first for weaknesses)
  strengths.sort((a, b) => byDimension[b] - byDimension[a]);
  weaknesses.sort((a, b) => byDimension[a] - byDimension[b]);

  return {
    pagesEvaluated: results.length,
    overallScore,
    byDimension,
    strengths,
    weaknesses,
  };
}

/**
 * Create an empty page result (for failures).
 */
export function createEmptyPageResult(
  pageId: string,
  pagePath: string,
  pageTitle: string,
  error: string
): PageQualityResult {
  const scores = {} as Record<QualityDimension, number>;
  for (const dim of QUALITY_DIMENSIONS) {
    scores[dim] = 0;
  }

  return {
    pageId,
    pagePath,
    pageTitle,
    scores,
    reasoning: `Evaluation failed: ${error}`,
    findings: [],
    durationMs: 0,
    costUsd: 0,
  };
}
