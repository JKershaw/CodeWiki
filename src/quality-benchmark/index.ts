/**
 * Quality Benchmark module for CodeWiki.
 *
 * Evaluates wiki quality across 8 dimensions:
 * 1. Contextual Richness - explains "why", decisions, trade-offs
 * 2. Coherence & Consistency - unified terminology, no contradictions
 * 3. Completeness Coverage - important systems documented
 * 4. Actionability - examples, how-to guides, troubleshooting
 * 5. Structural Quality - logical hierarchy, navigable
 * 6. Confidence Calibration - meaningful confidence scores
 * 7. Machine Readability - parseable by AI agents
 * 8. Information Density - signal vs noise ratio
 */

export * from './quality-benchmark-runner.js';
export * from './page-selector.js';
export * from './page-evaluator.js';
