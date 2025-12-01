/**
 * Unit tests for Analysis Tools used by the Self-Improvement Agent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  analysisTools,
  getBenchmarkSummaryTool,
  getQuestionTrendsTool,
  getQuestionHistoryTool,
  getQualityTrendsTool,
  getPageContentTool,
  listWikiPagesTool,
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
  type AnalysisToolContext,
} from '../../src/services/llm/analysis-tools.js';
import type { BenchmarkRun } from '../../src/domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../src/domain/quality-benchmark.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';

// Helper to create mock context
function createMockContext(overrides: Partial<AnalysisToolContext> = {}): AnalysisToolContext {
  return {
    repos: {} as Repositories,
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    benchmarkRuns: [],
    qualityBenchmarkRuns: [],
    wikiPages: [],
    ...overrides,
  };
}

// Helper to create a mock benchmark run
function createMockBenchmarkRun(
  id: string,
  iterationCount: number,
  score: number,
  results: Array<{ questionId: string; grade: string; confidence: number; wikiAnswer: string; reasoning: string }>
): BenchmarkRun {
  return {
    id,
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    iterationCount,
    pageCount: iterationCount * 2,
    results: results.map(r => ({
      ...r,
      codeReferences: [],
      durationMs: 1000,
      costUsd: 0.01,
    })),
    summary: {
      totalQuestions: results.length,
      accurate: results.filter(r => r.grade === 'accurate').length,
      partial: results.filter(r => r.grade === 'partial').length,
      inaccurate: results.filter(r => r.grade === 'inaccurate').length,
      noAnswer: results.filter(r => r.grade === 'no_answer').length,
      score,
      byCategory: {},
      byDifficulty: {
        easy: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        medium: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        hard: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
      },
    },
    totalCostUsd: 0.05,
    error: null,
  };
}

// Helper to create a mock quality benchmark run
function createMockQualityRun(
  id: string,
  iterationCount: number,
  overallScore: number,
  byDimension: Record<string, number>
): QualityBenchmarkRun {
  return {
    id,
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    iterationCount,
    pageCount: iterationCount * 2,
    results: [],
    summary: {
      pagesEvaluated: 10,
      overallScore,
      byDimension,
      strengths: overallScore > 60 ? ['Good overall'] : [],
      weaknesses: overallScore < 50 ? ['Needs work'] : [],
    },
    totalCostUsd: 0.1,
    error: null,
  };
}

// Helper to create a mock wiki page
function createMockPage(path: string, title: string, content: string, confidence: number = 0.7): WikiPage {
  return {
    id: `page-${path}`,
    wikiId: 'test-wiki',
    path,
    title,
    content,
    confidence,
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceCommitIds: [],
    sourceAgentRunIds: [],
  };
}

describe('Analysis Tools', () => {
  describe('analysisTools export', () => {
    it('exports all expected tools', () => {
      const toolNames = analysisTools.map(t => t.name);
      assert.ok(toolNames.includes('get_benchmark_summary'));
      assert.ok(toolNames.includes('get_question_trends'));
      assert.ok(toolNames.includes('get_question_history'));
      assert.ok(toolNames.includes('get_iterations_between'));
      assert.ok(toolNames.includes('get_quality_trends'));
      assert.ok(toolNames.includes('get_page_content'));
      assert.ok(toolNames.includes('list_wiki_pages'));
      assert.ok(toolNames.includes('get_agent_prompt'));
      // Codebase tools
      assert.ok(toolNames.includes('read_source_file'));
      assert.ok(toolNames.includes('search_source_files'));
      assert.ok(toolNames.includes('list_source_directory'));
    });

    it('all tools have required properties', () => {
      for (const tool of analysisTools) {
        assert.ok(tool.name, `Tool should have a name`);
        assert.ok(tool.description, `Tool ${tool.name} should have a description`);
        assert.ok(tool.inputSchema, `Tool ${tool.name} should have an inputSchema`);
        assert.ok(typeof tool.execute === 'function', `Tool ${tool.name} should have an execute function`);
      }
    });
  });

  describe('get_benchmark_summary', () => {
    it('returns message when no benchmarks available', async () => {
      const context = createMockContext();
      const result = await getBenchmarkSummaryTool.execute({}, context);
      assert.ok(result.includes('No benchmark runs available'));
    });

    it('returns formatted summary with accuracy benchmarks', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 40, [
            { questionId: 'q1', grade: 'partial', confidence: 0.7, wikiAnswer: 'A', reasoning: 'R' },
          ]),
          createMockBenchmarkRun('run-2', 50, 75, [
            { questionId: 'q1', grade: 'accurate', confidence: 0.9, wikiAnswer: 'A', reasoning: 'R' },
          ]),
        ],
      });

      const result = await getBenchmarkSummaryTool.execute({}, context);

      assert.ok(result.includes('Accuracy Benchmarks'));
      assert.ok(result.includes('Total runs: 2'));
      assert.ok(result.includes('10 to 50'));
      assert.ok(result.includes('40.0%'));
      assert.ok(result.includes('75.0%'));
    });

    it('returns formatted summary with quality benchmarks', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 20, 50, { contextual_richness: 45, actionability: 55 }),
          createMockQualityRun('qr-2', 80, 70, { contextual_richness: 65, actionability: 75 }),
        ],
      });

      const result = await getBenchmarkSummaryTool.execute({}, context);

      assert.ok(result.includes('Quality Benchmarks'));
      assert.ok(result.includes('Total runs: 2'));
      assert.ok(result.includes('50.0'));
      assert.ok(result.includes('70.0'));
    });
  });

  describe('get_question_trends', () => {
    it('returns message when no completed runs', async () => {
      const context = createMockContext();
      const result = await getQuestionTrendsTool.execute({}, context);
      assert.ok(result.includes('No completed benchmark runs'));
    });

    it('identifies improving questions', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 40, [
            { questionId: 'q1', grade: 'no_answer', confidence: 0.5, wikiAnswer: '', reasoning: 'Not found' },
          ]),
          createMockBenchmarkRun('run-2', 50, 75, [
            { questionId: 'q1', grade: 'accurate', confidence: 0.9, wikiAnswer: 'Good', reasoning: 'Correct' },
          ]),
        ],
      });

      const result = await getQuestionTrendsTool.execute({}, context);

      assert.ok(result.includes('Improving: 1'));
      assert.ok(result.includes('Improving Questions'));
      assert.ok(result.includes('q1'));
      assert.ok(result.includes('no_answer → accurate'));
    });

    it('identifies stuck questions', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 40, [
            { questionId: 'q1', grade: 'partial', confidence: 0.6, wikiAnswer: 'A', reasoning: 'R' },
          ]),
          createMockBenchmarkRun('run-2', 50, 45, [
            { questionId: 'q1', grade: 'partial', confidence: 0.6, wikiAnswer: 'A', reasoning: 'R' },
          ]),
          createMockBenchmarkRun('run-3', 100, 50, [
            { questionId: 'q1', grade: 'partial', confidence: 0.6, wikiAnswer: 'A', reasoning: 'R' },
          ]),
        ],
      });

      const result = await getQuestionTrendsTool.execute({}, context);

      assert.ok(result.includes('Stuck'));
      assert.ok(result.includes('stuck at partial'));
    });

    it('identifies declining questions', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 80, [
            { questionId: 'q1', grade: 'accurate', confidence: 0.9, wikiAnswer: 'A', reasoning: 'R' },
          ]),
          createMockBenchmarkRun('run-2', 50, 50, [
            { questionId: 'q1', grade: 'partial', confidence: 0.6, wikiAnswer: 'A', reasoning: 'R' },
          ]),
        ],
      });

      const result = await getQuestionTrendsTool.execute({}, context);

      assert.ok(result.includes('Declining: 1'));
      assert.ok(result.includes('accurate → partial'));
    });
  });

  describe('get_question_history', () => {
    it('returns message when question not found', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 50, [
            { questionId: 'q1', grade: 'partial', confidence: 0.6, wikiAnswer: 'A', reasoning: 'R' },
          ]),
        ],
      });

      const result = await getQuestionHistoryTool.execute({ question_id: 'unknown' }, context);
      assert.ok(result.includes('No history found'));
    });

    it('returns detailed history for a question', async () => {
      const context = createMockContext({
        benchmarkRuns: [
          createMockBenchmarkRun('run-1', 10, 40, [
            { questionId: 'q1', grade: 'no_answer', confidence: 0.5, wikiAnswer: 'Not found', reasoning: 'No content' },
          ]),
          createMockBenchmarkRun('run-2', 50, 75, [
            { questionId: 'q1', grade: 'accurate', confidence: 0.9, wikiAnswer: 'The answer is X because Y', reasoning: 'Correct explanation' },
          ]),
        ],
      });

      const result = await getQuestionHistoryTool.execute({ question_id: 'q1' }, context);

      assert.ok(result.includes('History for: q1'));
      assert.ok(result.includes('Iteration 10'));
      assert.ok(result.includes('no_answer'));
      assert.ok(result.includes('Iteration 50'));
      assert.ok(result.includes('accurate'));
      assert.ok(result.includes('The answer is X'));
      assert.ok(result.includes('Grader Reasoning'));
    });
  });

  describe('get_quality_trends', () => {
    it('returns message when no quality runs', async () => {
      const context = createMockContext();
      const result = await getQualityTrendsTool.execute({}, context);
      assert.ok(result.includes('No completed quality benchmark'));
    });

    it('shows dimension trends', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 20, 50, {
            contextual_richness: 40,
            actionability: 45,
          }),
          createMockQualityRun('qr-2', 80, 70, {
            contextual_richness: 65,
            actionability: 50,
          }),
        ],
      });

      const result = await getQualityTrendsTool.execute({}, context);

      assert.ok(result.includes('Quality Dimension Trends'));
      assert.ok(result.includes('contextual richness'));
      assert.ok(result.includes('actionability'));
      assert.ok(result.includes('40.0'));
      assert.ok(result.includes('65.0'));
    });
  });

  describe('get_page_content', () => {
    it('returns error for non-existent page', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('architecture/overview', 'Overview', 'Content'),
        ],
      });

      const result = await getPageContentTool.execute({ path: 'unknown/page' }, context);
      assert.ok(result.includes('not found'));
    });

    it('suggests similar pages when not found', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('architecture/overview', 'Overview', 'Content'),
          createMockPage('architecture/patterns', 'Patterns', 'Content'),
        ],
      });

      const result = await getPageContentTool.execute({ path: 'architecture/unknown' }, context);
      assert.ok(result.includes('Did you mean'));
      assert.ok(result.includes('architecture/overview'));
    });

    it('returns page content', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('architecture/overview', 'Architecture Overview', 'This is the architecture content.', 0.85),
        ],
      });

      const result = await getPageContentTool.execute({ path: 'architecture/overview' }, context);

      assert.ok(result.includes('Architecture Overview'));
      assert.ok(result.includes('architecture/overview'));
      assert.ok(result.includes('85%'));
      assert.ok(result.includes('This is the architecture content'));
    });

    it('truncates long content', async () => {
      const longContent = 'A'.repeat(5000);
      const context = createMockContext({
        wikiPages: [
          createMockPage('test/page', 'Test', longContent),
        ],
      });

      const result = await getPageContentTool.execute({ path: 'test/page' }, context);

      assert.ok(result.includes('truncated'));
      assert.ok(result.length < 5000);
    });
  });

  describe('list_wiki_pages', () => {
    it('returns message for empty wiki', async () => {
      const context = createMockContext();
      const result = await listWikiPagesTool.execute({}, context);
      assert.ok(result.includes('no pages'));
    });

    it('groups pages by category', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('architecture/overview', 'Overview', 'Content', 0.8),
          createMockPage('architecture/patterns', 'Patterns', 'Content', 0.6),
          createMockPage('api/endpoints', 'Endpoints', 'Content', 0.3),
        ],
      });

      const result = await listWikiPagesTool.execute({}, context);

      assert.ok(result.includes('3 total'));
      assert.ok(result.includes('### architecture/'));
      assert.ok(result.includes('### api/'));
      assert.ok(result.includes('Overview'));
      assert.ok(result.includes('Patterns'));
      assert.ok(result.includes('Endpoints'));
    });

    it('filters by category', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('architecture/overview', 'Overview', 'Content'),
          createMockPage('api/endpoints', 'Endpoints', 'Content'),
        ],
      });

      const result = await listWikiPagesTool.execute({ category: 'architecture' }, context);

      assert.ok(result.includes('Overview'));
      assert.ok(!result.includes('Endpoints'));
    });

    it('shows confidence icons', async () => {
      const context = createMockContext({
        wikiPages: [
          createMockPage('high', 'High', 'Content', 0.9),
          createMockPage('medium', 'Medium', 'Content', 0.5),
          createMockPage('low', 'Low', 'Content', 0.2),
        ],
      });

      const result = await listWikiPagesTool.execute({}, context);

      // High confidence gets checkmark, low gets question mark
      assert.ok(result.includes('✓ High'));
      assert.ok(result.includes('○ Medium'));
      assert.ok(result.includes('? Low'));
    });
  });

  describe('read_source_file', () => {
    it('returns message when repoPath not available', async () => {
      const context = createMockContext();
      const result = await readSourceFileTool.execute({ path: 'README.md' }, context);
      assert.ok(result.includes('not available'));
    });

    it('reads file content when repoPath is available', async () => {
      const context = createMockContext({
        repoPath: process.cwd(), // Use current directory as test repo
      });

      const result = await readSourceFileTool.execute({ path: 'package.json' }, context);
      assert.ok(result.includes('package.json'));
      assert.ok(result.includes('codewiki'));
    });

    it('returns error for non-existent file', async () => {
      const context = createMockContext({
        repoPath: process.cwd(),
      });

      const result = await readSourceFileTool.execute({ path: 'nonexistent-file.xyz' }, context);
      assert.ok(result.includes('Error'));
    });
  });

  describe('search_source_files', () => {
    it('returns message when repoPath not available', async () => {
      const context = createMockContext();
      const result = await searchSourceFilesTool.execute({ pattern: '**/*.ts' }, context);
      assert.ok(result.includes('not available'));
    });

    it('finds files matching pattern when repoPath is available', async () => {
      const context = createMockContext({
        repoPath: process.cwd(),
      });

      const result = await searchSourceFilesTool.execute({ pattern: 'package.json' }, context);
      assert.ok(result.includes('package.json'));
    });

    it('returns message when no files match', async () => {
      const context = createMockContext({
        repoPath: process.cwd(),
      });

      const result = await searchSourceFilesTool.execute({ pattern: '**/*.nonexistent' }, context);
      assert.ok(result.includes('No files found'));
    });
  });

  describe('list_source_directory', () => {
    it('returns message when repoPath not available', async () => {
      const context = createMockContext();
      const result = await listSourceDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('not available'));
    });

    it('lists directory contents when repoPath is available', async () => {
      const context = createMockContext({
        repoPath: process.cwd(),
      });

      const result = await listSourceDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('Directory:'));
      assert.ok(result.includes('src/') || result.includes('Directories'));
    });

    it('returns error for non-existent directory', async () => {
      const context = createMockContext({
        repoPath: process.cwd(),
      });

      const result = await listSourceDirectoryTool.execute({ path: 'nonexistent-dir' }, context);
      assert.ok(result.includes('Error'));
    });
  });
});
