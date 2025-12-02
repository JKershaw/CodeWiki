/**
 * Benchmark analysis tools for the Self-Improvement Agent.
 *
 * These tools analyze accuracy benchmark runs to identify trends,
 * regressions, and areas needing improvement.
 */

import type { AnalysisToolDefinition, AnalysisToolContext } from './types.js';
import type { BenchmarkResult } from '../../../domain/benchmark.js';
import type { Iteration } from '../../../domain/iteration.js';

/**
 * Tool to get a summary of all benchmark runs.
 */
export const getBenchmarkSummaryTool: AnalysisToolDefinition = {
  name: 'get_benchmark_summary',
  description:
    'Get an overview of all benchmark runs being analyzed, including scores, iteration counts, and trends. ' +
    'Use this first to understand the overall progression.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_input, context) => {
    const { benchmarkRuns, qualityBenchmarkRuns } = context;

    if (benchmarkRuns.length === 0 && qualityBenchmarkRuns.length === 0) {
      return 'No benchmark runs available for analysis.';
    }

    // Sort by iteration count
    const sortedAccuracy = [...benchmarkRuns]
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.iterationCount - b.iterationCount);

    const sortedQuality = [...qualityBenchmarkRuns]
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.iterationCount - b.iterationCount);

    const sections: string[] = [];

    // Accuracy benchmarks
    if (sortedAccuracy.length > 0) {
      const first = sortedAccuracy[0]!;
      const last = sortedAccuracy[sortedAccuracy.length - 1]!;

      sections.push('## Accuracy Benchmarks');
      sections.push(`Total runs: ${sortedAccuracy.length}`);
      sections.push(`Iteration range: ${first.iterationCount} to ${last.iterationCount}`);
      sections.push(`Score progression: ${first.summary.score.toFixed(1)}% → ${last.summary.score.toFixed(1)}% (${(last.summary.score - first.summary.score) >= 0 ? '+' : ''}${(last.summary.score - first.summary.score).toFixed(1)})`);
      sections.push(`Page count: ${first.pageCount ?? 0} → ${last.pageCount ?? 0}`);
      sections.push('');
      sections.push('| Iteration | Score | Accurate | Partial | Inaccurate | No Answer | Pages |');
      sections.push('|-----------|-------|----------|---------|------------|-----------|-------|');
      for (const run of sortedAccuracy) {
        const s = run.summary;
        sections.push(`| ${run.iterationCount} | ${s.score.toFixed(1)}% | ${s.accurate} | ${s.partial} | ${s.inaccurate} | ${s.noAnswer} | ${run.pageCount ?? '-'} |`);
      }
    }

    // Quality benchmarks
    if (sortedQuality.length > 0) {
      const first = sortedQuality[0]!;
      const last = sortedQuality[sortedQuality.length - 1]!;

      sections.push('');
      sections.push('## Quality Benchmarks');
      sections.push(`Total runs: ${sortedQuality.length}`);
      sections.push(`Iteration range: ${first.iterationCount} to ${last.iterationCount}`);
      sections.push(`Score progression: ${first.summary.overallScore.toFixed(1)} → ${last.summary.overallScore.toFixed(1)} (${(last.summary.overallScore - first.summary.overallScore) >= 0 ? '+' : ''}${(last.summary.overallScore - first.summary.overallScore).toFixed(1)})`);
      sections.push('');
      sections.push('| Iteration | Overall | Pages Evaluated |');
      sections.push('|-----------|---------|-----------------|');
      for (const run of sortedQuality) {
        sections.push(`| ${run.iterationCount} | ${run.summary.overallScore.toFixed(1)} | ${run.summary.pagesEvaluated} |`);
      }
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get trends for all benchmark questions across runs.
 */
export const getQuestionTrendsTool: AnalysisToolDefinition = {
  name: 'get_question_trends',
  description:
    'Get the grade progression for each benchmark question across all runs. ' +
    'Shows which questions improved, stayed stuck, or regressed. ' +
    'Use this to identify specific areas needing improvement.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_input, context) => {
    const { benchmarkRuns } = context;

    const completedRuns = benchmarkRuns
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.iterationCount - b.iterationCount);

    if (completedRuns.length === 0) {
      return 'No completed benchmark runs available.';
    }

    // Collect all question IDs
    const questionMap = new Map<string, {
      question: string;
      category: string;
      difficulty: string;
      grades: Array<{ iteration: number; grade: string; confidence: number }>;
    }>();

    for (const run of completedRuns) {
      for (const result of run.results) {
        if (!questionMap.has(result.questionId)) {
          // Try to get question metadata from the result
          questionMap.set(result.questionId, {
            question: result.questionId,
            category: 'unknown',
            difficulty: 'unknown',
            grades: [],
          });
        }
        questionMap.get(result.questionId)!.grades.push({
          iteration: run.iterationCount,
          grade: result.grade,
          confidence: result.confidence,
        });
      }
    }

    // Determine trends
    const trends: Array<{
      id: string;
      trend: string;
      firstGrade: string;
      lastGrade: string;
      grades: string;
    }> = [];

    for (const [id, data] of questionMap) {
      const grades = data.grades;
      const firstGrade = grades[0]?.grade || 'unknown';
      const lastGrade = grades[grades.length - 1]?.grade || 'unknown';

      // Calculate trend
      let trend = 'stable';
      const gradeScore = (g: string) => {
        switch (g) {
          case 'accurate': return 3;
          case 'partial': return 2;
          case 'inaccurate': return 1;
          case 'no_answer': return 0;
          default: return 0;
        }
      };

      const firstScore = gradeScore(firstGrade);
      const lastScore = gradeScore(lastGrade);

      if (lastScore > firstScore) {
        trend = 'improving';
      } else if (lastScore < firstScore) {
        trend = 'declining';
      } else if (lastScore === firstScore && lastScore < 3) {
        // Stuck at non-perfect
        trend = grades.length > 2 ? 'stuck' : 'stable';
      }

      trends.push({
        id,
        trend,
        firstGrade,
        lastGrade,
        grades: grades.map(g => g.grade.charAt(0).toUpperCase()).join(' → '),
      });
    }

    // Group by trend
    const improving = trends.filter(t => t.trend === 'improving');
    const stuck = trends.filter(t => t.trend === 'stuck');
    const declining = trends.filter(t => t.trend === 'declining');
    const stable = trends.filter(t => t.trend === 'stable');

    const sections: string[] = [];

    sections.push('## Question Trends Summary');
    sections.push(`- Improving: ${improving.length}`);
    sections.push(`- Stuck (no improvement): ${stuck.length}`);
    sections.push(`- Declining: ${declining.length}`);
    sections.push(`- Stable: ${stable.length}`);
    sections.push('');

    if (improving.length > 0) {
      sections.push('### Improving Questions');
      for (const t of improving) {
        sections.push(`- **${t.id}**: ${t.firstGrade} → ${t.lastGrade} (${t.grades})`);
      }
      sections.push('');
    }

    if (stuck.length > 0) {
      sections.push('### Stuck Questions (need attention)');
      for (const t of stuck) {
        sections.push(`- **${t.id}**: stuck at ${t.lastGrade} (${t.grades})`);
      }
      sections.push('');
    }

    if (declining.length > 0) {
      sections.push('### Declining Questions (regression)');
      for (const t of declining) {
        sections.push(`- **${t.id}**: ${t.firstGrade} → ${t.lastGrade} (${t.grades})`);
      }
      sections.push('');
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get detailed history for a specific question.
 */
export const getQuestionHistoryTool: AnalysisToolDefinition = {
  name: 'get_question_history',
  description:
    'Get detailed history for a specific benchmark question, including wiki answers and grader reasoning at each point. ' +
    'Use this to understand why a question is failing or what changed when it improved.',
  inputSchema: {
    type: 'object',
    properties: {
      question_id: {
        type: 'string',
        description: 'The ID of the question to get history for',
      },
    },
    required: ['question_id'],
  },
  execute: async (input, context) => {
    const questionId = input['question_id'] as string;
    const { benchmarkRuns } = context;

    const completedRuns = benchmarkRuns
      .filter(r => r.status === 'completed')
      .sort((a, b) => a.iterationCount - b.iterationCount);

    const history: Array<{
      iteration: number;
      result: BenchmarkResult;
    }> = [];

    for (const run of completedRuns) {
      const result = run.results.find(r => r.questionId === questionId);
      if (result) {
        history.push({ iteration: run.iterationCount, result });
      }
    }

    if (history.length === 0) {
      return `No history found for question "${questionId}". Use get_question_trends to see available questions.`;
    }

    const sections: string[] = [];
    sections.push(`## History for: ${questionId}`);
    sections.push('');

    for (const { iteration, result } of history) {
      sections.push(`### Iteration ${iteration}`);
      sections.push(`**Grade:** ${result.grade} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
      sections.push('');
      sections.push('**Wiki Answer:**');
      sections.push(result.wikiAnswer.slice(0, 500) + (result.wikiAnswer.length > 500 ? '...' : ''));
      sections.push('');
      sections.push('**Grader Reasoning:**');
      sections.push(result.reasoning);
      sections.push('');
      if (result.codeReferences.length > 0) {
        sections.push('**Code References:** ' + result.codeReferences.slice(0, 5).join(', '));
      }
      sections.push('---');
      sections.push('');
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get agent activity between two iteration points.
 */
export const getIterationsBetweenTool: AnalysisToolDefinition = {
  name: 'get_iterations_between',
  description:
    'Get a summary of what agents ran and what changes were made between two iteration points. ' +
    'Use this to understand what caused a benchmark score to change.',
  inputSchema: {
    type: 'object',
    properties: {
      from_iteration: {
        type: 'string',
        description: 'Start iteration number (inclusive)',
      },
      to_iteration: {
        type: 'string',
        description: 'End iteration number (inclusive)',
      },
    },
    required: ['from_iteration', 'to_iteration'],
  },
  execute: async (input, context) => {
    const fromIter = parseInt(input['from_iteration'] as string, 10);
    const toIter = parseInt(input['to_iteration'] as string, 10);
    const { repos, repoId } = context;

    if (isNaN(fromIter) || isNaN(toIter)) {
      return 'Invalid iteration numbers. Please provide numeric values.';
    }

    // Get all processing runs for this repo
    const processingRuns = await repos.processingRuns.findByRepo(repoId);

    // Collect all iterations in range
    const iterationsInRange: Iteration[] = [];

    for (const run of processingRuns) {
      const iterations = await repos.iterations.findByProcessingRun(run.id);
      for (const iter of iterations) {
        // Calculate cumulative iteration number
        // This is a simplification - in reality we'd need to track cumulative iteration number
        if (iter.status === 'completed') {
          iterationsInRange.push(iter);
        }
      }
    }

    if (iterationsInRange.length === 0) {
      return `No completed iterations found. The iteration data may not be available.`;
    }

    // Aggregate by agent type
    const agentCounts: Record<string, number> = {};
    let totalPagesCreated = 0;
    let totalPagesUpdated = 0;
    let totalCost = 0;

    for (const iter of iterationsInRange) {
      if (iter.agentType) {
        agentCounts[iter.agentType] = (agentCounts[iter.agentType] || 0) + 1;
      }
      totalPagesCreated += iter.pagesCreated;
      totalPagesUpdated += iter.pagesUpdated;
      totalCost += iter.costUsd;
    }

    const sections: string[] = [];
    sections.push(`## Iterations ${fromIter} to ${toIter}`);
    sections.push(`Total iterations found: ${iterationsInRange.length}`);
    sections.push(`Pages created: ${totalPagesCreated}`);
    sections.push(`Pages updated: ${totalPagesUpdated}`);
    sections.push(`Total cost: $${totalCost.toFixed(4)}`);
    sections.push('');
    sections.push('### Agent Activity');
    sections.push('| Agent | Runs |');
    sections.push('|-------|------|');

    const sortedAgents = Object.entries(agentCounts).sort((a, b) => b[1] - a[1]);
    for (const [agent, count] of sortedAgents) {
      sections.push(`| ${agent} | ${count} |`);
    }

    return sections.join('\n');
  },
};

/**
 * All benchmark analysis tools.
 */
export const benchmarkTools: AnalysisToolDefinition[] = [
  getBenchmarkSummaryTool,
  getQuestionTrendsTool,
  getQuestionHistoryTool,
  getIterationsBetweenTool,
];
