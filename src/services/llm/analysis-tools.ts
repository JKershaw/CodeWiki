/**
 * Analysis tools for the Self-Improvement Agent.
 *
 * These tools allow the agent to explore benchmark history, iteration data,
 * wiki pages, agent prompts, and source code to produce improvement recommendations.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fg from 'fast-glob';
import type { Repositories } from '../../repositories/index.js';
import type { BenchmarkRun, BenchmarkResult } from '../../domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../domain/quality-benchmark.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import type { Iteration } from '../../domain/iteration.js';
import type {
  BenchmarkTrendSummary,
  QuestionTrend,
  AgentActivitySummary,
} from '../../domain/self-improvement.js';
import { loadIgnorePatterns } from '../cwignore.js';

// ============================================================================
// Tool Context
// ============================================================================

/**
 * Context provided to analysis tools when they execute.
 */
export interface AnalysisToolContext {
  /** Repository access for data queries */
  repos: Repositories;
  /** Repository ID being analyzed */
  repoId: string;
  /** Wiki ID being analyzed */
  wikiId: string;
  /** Path to the source code repository (optional - if available enables codebase tools) */
  repoPath?: string;
  /** Benchmark runs included in analysis */
  benchmarkRuns: BenchmarkRun[];
  /** Quality benchmark runs included in analysis */
  qualityBenchmarkRuns: QualityBenchmarkRun[];
  /** All wiki pages */
  wikiPages: WikiPage[];
}

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Definition of an analysis tool.
 */
export interface AnalysisToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Execute the tool with given input */
  execute: (input: Record<string, unknown>, context: AnalysisToolContext) => Promise<string>;
}

// ============================================================================
// Tool: Get Benchmark Summary
// ============================================================================

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

// ============================================================================
// Tool: Get Question Trends
// ============================================================================

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

// ============================================================================
// Tool: Get Question History
// ============================================================================

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

// ============================================================================
// Tool: Get Iterations Between
// ============================================================================

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

// ============================================================================
// Tool: Get Quality Trends
// ============================================================================

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

// ============================================================================
// Tool: Get Page Content
// ============================================================================

/**
 * Tool to read a wiki page.
 */
export const getPageContentTool: AnalysisToolDefinition = {
  name: 'get_page_content',
  description:
    'Read the content of a wiki page. Use this to understand what the wiki actually says about a topic.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path of the wiki page to read',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    const path = (input['path'] as string).toLowerCase();
    const { wikiPages } = context;

    // Find the page
    let page = wikiPages.find(p => p.path.toLowerCase() === path);

    if (!page) {
      // Try partial match
      page = wikiPages.find(p => p.path.toLowerCase().includes(path));
    }

    if (!page) {
      const suggestions = wikiPages
        .filter(p => {
          const pathParts = path.split('/');
          return pathParts.some(part => p.path.toLowerCase().includes(part));
        })
        .slice(0, 5);

      if (suggestions.length > 0) {
        return `Page "${path}" not found. Did you mean one of these?\n${suggestions.map(p => `- ${p.path}`).join('\n')}`;
      }
      return `Page "${path}" not found.`;
    }

    const maxLength = 4000;
    let content = page.content;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n... (truncated)';
    }

    return [
      `# ${page.title}`,
      `Path: ${page.path}`,
      `Confidence: ${(page.confidence * 100).toFixed(0)}%`,
      '',
      '---',
      '',
      content,
    ].join('\n');
  },
};

// ============================================================================
// Tool: List Wiki Pages
// ============================================================================

/**
 * Tool to list wiki pages.
 */
export const listWikiPagesTool: AnalysisToolDefinition = {
  name: 'list_wiki_pages',
  description:
    'List all wiki pages grouped by category. Use this to understand wiki structure and find relevant pages.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Optional category to filter by',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const category = input['category'] as string | undefined;
    let { wikiPages } = context;

    if (category) {
      const lowerCategory = category.toLowerCase();
      wikiPages = wikiPages.filter(p =>
        p.path.toLowerCase().startsWith(lowerCategory) ||
        p.path.toLowerCase().includes('/' + lowerCategory)
      );
    }

    if (wikiPages.length === 0) {
      return category
        ? `No pages found in category "${category}".`
        : 'The wiki has no pages.';
    }

    // Group by top-level category
    const grouped: Record<string, typeof wikiPages> = {};
    for (const page of wikiPages) {
      const parts = page.path.split('/');
      const topLevel = parts.length > 1 ? parts[0]! : '(root)';
      if (!grouped[topLevel]) grouped[topLevel] = [];
      grouped[topLevel]!.push(page);
    }

    const sections: string[] = [];
    sections.push(`## Wiki Pages (${wikiPages.length} total)`);
    sections.push('');

    for (const [cat, pages] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
      sections.push(`### ${cat}/`);
      for (const page of pages.sort((a, b) => a.title.localeCompare(b.title))) {
        const confidenceIcon = page.confidence >= 0.7 ? '✓' : page.confidence >= 0.4 ? '○' : '?';
        sections.push(`- ${confidenceIcon} ${page.title} (${page.path})`);
      }
      sections.push('');
    }

    return sections.join('\n');
  },
};

// ============================================================================
// Tool: Get Agent Prompt
// ============================================================================

/**
 * Tool to read an agent's system prompt.
 */
export const getAgentPromptTool: AnalysisToolDefinition = {
  name: 'get_agent_prompt',
  description:
    'Read the system prompt for a specific agent type. Use this to understand how an agent is instructed ' +
    'and identify potential improvements to its prompts.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'The agent type (e.g., "code-change", "pattern", "security", "project-overview")',
      },
    },
    required: ['agent_type'],
  },
  execute: async (input, _context) => {
    const agentType = input['agent_type'] as string;

    // Map agent types to their file locations
    const agentFiles: Record<string, string> = {
      'code-change': 'analysis/code-change-agent.ts',
      'narrative': 'analysis/narrative-agent.ts',
      'security': 'analysis/security-agent.ts',
      'technical-debt': 'analysis/technical-debt-agent.ts',
      'pattern': 'analysis/pattern-agent.ts',
      'dependency': 'analysis/dependency-agent.ts',
      'bootstrap': 'bootstrap/bootstrap-agent.ts',
      'wiki-editor': 'editor/wiki-editor-agent.ts',
      'link': 'meta/link-agent.ts',
      'structure': 'meta/structure-agent.ts',
      'quality': 'meta/quality-agent.ts',
      'consistency': 'meta/consistency-agent.ts',
      'consolidation': 'consolidation/consolidation-agent.ts',
      'project-overview': 'synthesis/project-overview-agent.ts',
      'getting-started': 'synthesis/getting-started-agent.ts',
      'testing-guide': 'synthesis/testing-guide-agent.ts',
      'extension-guide': 'synthesis/extension-guide-agent.ts',
      'overview': 'synthesis/overview-agent.ts',
      'writer': 'synthesis/writer-agent.ts',
      'wiki-index': 'synthesis/wiki-index-agent.ts',
      'toc': 'synthesis/toc-agent.ts',
    };

    const filePath = agentFiles[agentType];
    if (!filePath) {
      return `Unknown agent type "${agentType}". Available types: ${Object.keys(agentFiles).join(', ')}`;
    }

    try {
      // Get the directory of this file to navigate to agents
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const fullPath = join(__dirname, '..', '..', 'agents', filePath);

      const content = await readFile(fullPath, 'utf-8');

      // Extract SYSTEM_PROMPT from the file
      const promptMatch = content.match(/(?:const|let)\s+(?:SYSTEM_PROMPT|systemPrompt)\s*=\s*`([\s\S]*?)`;/);

      if (promptMatch) {
        return [
          `## System Prompt for: ${agentType}`,
          `File: src/agents/${filePath}`,
          '',
          '---',
          '',
          promptMatch[1]!.trim(),
        ].join('\n');
      }

      // Try to find a different pattern
      const altMatch = content.match(/system:\s*`([\s\S]*?)`,/);
      if (altMatch) {
        return [
          `## System Prompt for: ${agentType}`,
          `File: src/agents/${filePath}`,
          '',
          '---',
          '',
          altMatch[1]!.trim(),
        ].join('\n');
      }

      return `Could not extract system prompt from ${agentType} agent. The prompt may be defined differently.`;
    } catch (error) {
      return `Error reading agent file: ${error}`;
    }
  },
};

// ============================================================================
// Tool: Read Source File
// ============================================================================

const DEFAULT_MAX_FILE_SIZE = 100_000; // 100KB

/**
 * Validate that a path is within the repository root.
 */
function validateSourcePath(requestedPath: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, requestedPath);
  const repoResolved = resolve(repoRoot);

  if (!resolved.startsWith(repoResolved)) {
    throw new Error(`Path "${requestedPath}" is outside repository`);
  }
  return resolved;
}

/**
 * Tool to read a source file from the repository.
 */
export const readSourceFileTool: AnalysisToolDefinition = {
  name: 'read_source_file',
  description:
    'Read the contents of a source file from the repository. Use this to understand what the source code ' +
    'actually contains, to identify what information wiki-building agents should be extracting.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from repository root (e.g., "README.md", "src/index.ts")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const path = input['path'] as string;
    try {
      const fullPath = validateSourcePath(path, context.repoPath);
      const stats = await stat(fullPath);

      if (stats.size > DEFAULT_MAX_FILE_SIZE) {
        return `Error: File "${path}" is too large (${stats.size} bytes, limit is ${DEFAULT_MAX_FILE_SIZE})`;
      }

      const content = await readFile(fullPath, 'utf-8');
      return `## File: ${path}\n\n\`\`\`\n${content}\n\`\`\``;
    } catch (error) {
      if (error instanceof Error) {
        return `Error reading "${path}": ${error.message}`;
      }
      return `Error reading "${path}"`;
    }
  },
};

// ============================================================================
// Tool: Search Source Files
// ============================================================================

/**
 * Tool to search for source files matching a glob pattern.
 */
export const searchSourceFilesTool: AnalysisToolDefinition = {
  name: 'search_source_files',
  description:
    'Find source files matching a glob pattern. Use this to discover what files exist in the repository ' +
    'and understand the project structure that wiki-building agents are working with.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "**/*.md", "src/**/*.ts")',
      },
    },
    required: ['pattern'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const pattern = input['pattern'] as string;
    try {
      const ignorePatterns = await loadIgnorePatterns(context.repoPath);
      const files = await fg(pattern, {
        cwd: context.repoPath,
        onlyFiles: true,
        ignore: ignorePatterns,
      });

      if (files.length === 0) {
        return `No files found matching "${pattern}"`;
      }

      // Limit results
      const maxResults = 50;
      const truncated = files.length > maxResults;
      const displayFiles = files.slice(0, maxResults);

      let result = `## Files matching: ${pattern}\n\nFound ${files.length} files:\n\n`;
      result += displayFiles.join('\n');
      if (truncated) {
        result += `\n\n... and ${files.length - maxResults} more files`;
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        return `Error searching for "${pattern}": ${error.message}`;
      }
      return `Error searching for "${pattern}"`;
    }
  },
};

// ============================================================================
// Tool: List Source Directory
// ============================================================================

/**
 * Tool to list contents of a source directory.
 */
export const listSourceDirectoryTool: AnalysisToolDefinition = {
  name: 'list_source_directory',
  description:
    'List contents of a source directory to understand project structure. Use this to explore ' +
    'what code exists that wiki-building agents should be documenting.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to repo root (e.g., "src", ".")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    if (!context.repoPath) {
      return 'Source code access is not available for this repository.';
    }

    const path = input['path'] as string;
    try {
      const fullPath = validateSourcePath(path, context.repoPath);
      const entries = await readdir(fullPath, { withFileTypes: true });
      const ignorePatterns = await loadIgnorePatterns(context.repoPath);

      // Filter out ignored entries
      const filteredEntries = entries.filter(entry => {
        const entryPath = path === '.' ? entry.name : join(path, entry.name);
        // Simple ignore check
        return !ignorePatterns.some(p => entryPath.includes(p.replace('/**', '').replace('*', '')));
      });

      const dirs = filteredEntries.filter(e => e.isDirectory()).map(e => e.name + '/');
      const files = filteredEntries.filter(e => !e.isDirectory()).map(e => e.name);

      let result = `## Directory: ${path}\n\n`;

      if (dirs.length > 0) {
        result += '**Directories:**\n' + dirs.sort().join('\n') + '\n\n';
      }
      if (files.length > 0) {
        result += '**Files:**\n' + files.sort().join('\n');
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        return `Error listing "${path}": ${error.message}`;
      }
      return `Error listing "${path}"`;
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

/**
 * All available analysis tools.
 */
export const analysisTools: AnalysisToolDefinition[] = [
  getBenchmarkSummaryTool,
  getQuestionTrendsTool,
  getQuestionHistoryTool,
  getIterationsBetweenTool,
  getQualityTrendsTool,
  getPageContentTool,
  listWikiPagesTool,
  getAgentPromptTool,
  // Codebase exploration tools
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
];
