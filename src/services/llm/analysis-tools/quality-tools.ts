/**
 * Quality benchmark analysis tools for the Self-Improvement Agent.
 *
 * These tools analyze quality benchmark runs to identify dimension trends,
 * per-page issues, and areas needing improvement.
 */

import type { AnalysisToolDefinition } from './types.js';

/**
 * Tool to get quality dimension trends over time.
 */
export const getQualityTrendsTool: AnalysisToolDefinition = {
  name: 'get_quality_trends',
  description:
    'Get quality dimension scores over time from quality benchmarks. ' +
    'Shows which dimensions are improving or declining.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_input, context) => {
    const { qualityBenchmarkRuns } = context;

    const completedRuns = qualityBenchmarkRuns
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.iterationCount - b.iterationCount);

    if (completedRuns.length === 0) {
      return 'No completed quality benchmark runs available.';
    }

    // Get all dimensions from first run
    const firstRun = completedRuns[0]!;
    const lastRun = completedRuns[completedRuns.length - 1]!;

    const dimensions = Object.keys(firstRun.summary.byDimension);

    const sections: string[] = [];
    sections.push('## Quality Dimension Trends');
    sections.push('');
    sections.push('| Dimension | First | Last | Change | Trend |');
    sections.push('|-----------|-------|------|--------|-------|');

    for (const dim of dimensions) {
      const firstScore = (firstRun.summary.byDimension as Record<string, number>)[dim] ?? 0;
      const lastScore = (lastRun.summary.byDimension as Record<string, number>)[dim] ?? 0;
      const change = lastScore - firstScore;
      const trend = change > 5 ? '📈 improving' : change < -5 ? '📉 declining' : '➡️ stable';

      sections.push(`| ${dim.replace(/_/g, ' ')} | ${firstScore.toFixed(1)} | ${lastScore.toFixed(1)} | ${change >= 0 ? '+' : ''}${change.toFixed(1)} | ${trend} |`);
    }

    // Identify strengths and weaknesses
    sections.push('');
    sections.push('### Latest Strengths');
    for (const strength of lastRun.summary.strengths || []) {
      sections.push(`- ${strength}`);
    }

    sections.push('');
    sections.push('### Latest Weaknesses');
    for (const weakness of lastRun.summary.weaknesses || []) {
      sections.push(`- ${weakness}`);
    }

    return sections.join('\n');
  },
};

/**
 * Get the description for a quality dimension.
 */
function getDimensionDescription(dimension: string): string {
  const descriptions: Record<string, string> = {
    contextual_richness:
      'Does the wiki explain the "why" behind the code? Are architectural choices explained with trade-offs?',
    coherence_consistency:
      'Does the wiki tell a unified story? Same concepts use same terms? Related entries link appropriately?',
    completeness_coverage:
      'Are important things documented? Does it explicitly state scope and boundaries? Are failure modes documented?',
    actionability:
      'Can someone actually use this documentation? Concrete examples? How-to guidance? Troubleshooting info?',
    structural_quality:
      'Is the wiki well-organized? Layered depth? Logical hierarchy? Easy to navigate?',
    confidence_calibration:
      'Are confidence scores meaningful? Good distribution? Uncertainty acknowledged appropriately?',
    machine_readability:
      'Can AI agents parse this effectively? Consistent formatting? Explicit relationship markers?',
    information_density:
      'Signal vs noise ratio. Concise? Relevant? No boilerplate? Provides insight beyond reading code?',
  };
  return descriptions[dimension] || 'Unknown dimension';
}

/**
 * Tool to get detailed per-page scores for a quality dimension.
 */
export const getQualityDimensionDetailTool: AnalysisToolDefinition = {
  name: 'get_quality_dimension_detail',
  description:
    'Get detailed per-page breakdown for a specific quality dimension. ' +
    'Shows which pages score lowest on the dimension and why, with findings and reasoning. ' +
    'Available dimensions: contextual_richness, coherence_consistency, completeness_coverage, ' +
    'actionability, structural_quality, confidence_calibration, machine_readability, information_density.',
  inputSchema: {
    type: 'object',
    properties: {
      dimension: {
        type: 'string',
        description:
          'The quality dimension to analyze. One of: contextual_richness, coherence_consistency, ' +
          'completeness_coverage, actionability, structural_quality, confidence_calibration, ' +
          'machine_readability, information_density',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of pages to show (default: 10, showing lowest-scoring first)',
      },
    },
    required: ['dimension'],
  },
  execute: async (input, context) => {
    const { qualityBenchmarkRuns } = context;
    const dimension = input.dimension as string;
    const limit = (input.limit as number) || 10;

    const validDimensions = [
      'contextual_richness',
      'coherence_consistency',
      'completeness_coverage',
      'actionability',
      'structural_quality',
      'confidence_calibration',
      'machine_readability',
      'information_density',
    ];

    if (!validDimensions.includes(dimension)) {
      return `Invalid dimension "${dimension}". Valid dimensions are: ${validDimensions.join(', ')}`;
    }

    const completedRuns = qualityBenchmarkRuns
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.iterationCount - a.iterationCount);

    if (completedRuns.length === 0) {
      return 'No completed quality benchmark runs available.';
    }

    // Use the most recent run for per-page detail
    const latestRun = completedRuns[0]!;
    const results = latestRun.results;

    if (results.length === 0) {
      return 'No page quality results available in the latest benchmark run.';
    }

    // Sort pages by this dimension score (lowest first to highlight problem areas)
    const sortedResults = [...results].sort((a, b) => {
      const scoreA = a.scores[dimension as keyof typeof a.scores] ?? 0;
      const scoreB = b.scores[dimension as keyof typeof b.scores] ?? 0;
      return scoreA - scoreB;
    });

    const sections: string[] = [];
    const dimDescription = getDimensionDescription(dimension);

    sections.push(`## Quality Dimension: ${dimension.replace(/_/g, ' ')}`);
    sections.push('');
    sections.push(`**What this measures:** ${dimDescription}`);
    sections.push('');
    sections.push(`**Average score:** ${(latestRun.summary.byDimension[dimension as keyof typeof latestRun.summary.byDimension] ?? 0).toFixed(1)}/100`);
    sections.push(`**Benchmark iteration:** ${latestRun.iterationCount}`);
    sections.push('');
    sections.push(`### Lowest-Scoring Pages (showing ${Math.min(limit, sortedResults.length)} of ${sortedResults.length})`);
    sections.push('');

    // Show lowest-scoring pages with details
    const pagesToShow = sortedResults.slice(0, limit);
    for (const result of pagesToShow) {
      const score = result.scores[dimension as keyof typeof result.scores] ?? 0;
      sections.push(`#### ${result.pageTitle} (${result.pagePath})`);
      sections.push(`**Score:** ${score.toFixed(1)}/100`);
      sections.push('');

      // Show findings if available
      if (result.findings && result.findings.length > 0) {
        sections.push('**Findings:**');
        for (const finding of result.findings) {
          sections.push(`- ${finding}`);
        }
        sections.push('');
      }

      // Show reasoning excerpt if available
      if (result.reasoning) {
        // Truncate reasoning to keep output manageable
        const maxReasoningLength = 300;
        const reasoning =
          result.reasoning.length > maxReasoningLength
            ? result.reasoning.substring(0, maxReasoningLength) + '...'
            : result.reasoning;
        sections.push(`**Reasoning:** ${reasoning}`);
        sections.push('');
      }
    }

    // Also show distribution info
    sections.push('### Score Distribution');
    const scores = results.map(r => r.scores[dimension as keyof typeof r.scores] ?? 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const belowAvg = scores.filter(s => s < avg).length;

    sections.push(`- **Min:** ${min.toFixed(1)}`);
    sections.push(`- **Max:** ${max.toFixed(1)}`);
    sections.push(`- **Average:** ${avg.toFixed(1)}`);
    sections.push(`- **Pages below average:** ${belowAvg} of ${scores.length}`);

    return sections.join('\n');
  },
};

/**
 * All quality benchmark analysis tools.
 */
export const qualityTools: AnalysisToolDefinition[] = [
  getQualityTrendsTool,
  getQualityDimensionDetailTool,
];
