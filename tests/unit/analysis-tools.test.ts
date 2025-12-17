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
  getQualityDimensionDetailTool,
  getPageContentTool,
  listWikiPagesTool,
  readSourceFileTool,
  searchSourceFilesTool,
  listSourceDirectoryTool,
  getAgentPromptTool,
  type AnalysisToolContext,
} from '../../src/services/llm/analysis-tools.js';
import type { BenchmarkRun } from '../../src/domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../src/domain/quality-benchmark.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { FileEntry } from '../../src/services/repository/repository-service.js';
import type { UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { minimatch } from 'minimatch';

// Helper to create a mock UnifiedRepoAccess
function createMockRepoAccess(overrides: Partial<UnifiedRepoAccess> = {}): UnifiedRepoAccess {
  return {
    getFileContent: async () => 'mock file content',
    listDirectory: async () => [] as FileEntry[],
    getFileTree: async () => [],
    fileExists: async () => false,
    getCommitDiff: async () => '',
    isLocal: () => false,
    getLocalPath: () => undefined,
    ...overrides,
  };
}

// Helper to create a real filesystem-backed UnifiedRepoAccess for a local path
function createFilesystemRepoAccess(basePath: string): UnifiedRepoAccess {
  return {
    async getFileContent(path: string): Promise<string> {
      const fullPath = join(basePath, path);
      return await readFile(fullPath, 'utf-8');
    },
    async listDirectory(path: string): Promise<FileEntry[]> {
      const fullPath = join(basePath, path);
      const entries = await readdir(fullPath);
      const result: FileEntry[] = [];
      for (const name of entries) {
        const entryPath = join(fullPath, name);
        const stats = await stat(entryPath);
        result.push({
          name,
          type: stats.isDirectory() ? 'dir' : 'file',
        });
      }
      return result;
    },
    async getFileTree(): Promise<string[]> {
      const files: string[] = [];
      const walk = async (dir: string, prefix: string) => {
        const entries = await readdir(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            if (!entry.startsWith('.') && entry !== 'node_modules') {
              await walk(fullPath, prefix ? `${prefix}/${entry}` : entry);
            }
          } else {
            files.push(prefix ? `${prefix}/${entry}` : entry);
          }
        }
      };
      await walk(basePath, '');
      return files;
    },
    async fileExists(path: string): Promise<boolean> {
      try {
        await stat(join(basePath, path));
        return true;
      } catch {
        return false;
      }
    },
    async getCommitDiff(): Promise<string> {
      return '';
    },
    isLocal(): boolean {
      return true;
    },
    getLocalPath(): string | undefined {
      return basePath;
    },
  };
}

// Helper to create mock context
function createMockContext(overrides: Partial<AnalysisToolContext> = {}): AnalysisToolContext {
  return {
    repos: {} as unknown as Repositories,
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
  byDimension: Record<string, number>,
  results: Array<{
    pageId: string;
    pagePath: string;
    pageTitle: string;
    scores: Record<string, number>;
    reasoning: string;
    findings: string[];
  }> = []
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
    results: results.map(r => ({
      ...r,
      durationMs: 1000,
      costUsd: 0.01,
    })),
    summary: {
      pagesEvaluated: results.length || 10,
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
    sourceCommits: [],
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
      assert.ok(toolNames.includes('get_quality_dimension_detail'));
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

  describe('get_quality_dimension_detail', () => {
    it('returns error for invalid dimension', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 50, 70, { contextual_richness: 65 }),
        ],
      });

      const result = await getQualityDimensionDetailTool.execute({ dimension: 'invalid' }, context);
      assert.ok(result.includes('Invalid dimension'));
      assert.ok(result.includes('contextual_richness'));
    });

    it('returns message when no quality runs', async () => {
      const context = createMockContext();
      const result = await getQualityDimensionDetailTool.execute({ dimension: 'actionability' }, context);
      assert.ok(result.includes('No completed quality benchmark'));
    });

    it('returns message when no page results', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 50, 70, { actionability: 65 }),
        ],
      });

      const result = await getQualityDimensionDetailTool.execute({ dimension: 'actionability' }, context);
      assert.ok(result.includes('No page quality results'));
    });

    it('shows per-page breakdown sorted by score', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 50, 60, { actionability: 50 }, [
            {
              pageId: 'p1',
              pagePath: 'architecture/overview',
              pageTitle: 'Architecture Overview',
              scores: { actionability: 80, contextual_richness: 70 },
              reasoning: 'Good examples provided',
              findings: ['Clear code samples'],
            },
            {
              pageId: 'p2',
              pagePath: 'api/endpoints',
              pageTitle: 'API Endpoints',
              scores: { actionability: 30, contextual_richness: 60 },
              reasoning: 'Lacks concrete examples',
              findings: ['Missing example requests', 'No error handling shown'],
            },
            {
              pageId: 'p3',
              pagePath: 'security/auth',
              pageTitle: 'Authentication',
              scores: { actionability: 55, contextual_richness: 75 },
              reasoning: 'Partial examples',
              findings: ['Some examples present'],
            },
          ]),
        ],
      });

      const result = await getQualityDimensionDetailTool.execute({ dimension: 'actionability' }, context);

      // Should include dimension info
      assert.ok(result.includes('Quality Dimension: actionability'));
      assert.ok(result.includes('What this measures'));
      assert.ok(result.includes('Average score:'));

      // Should show lowest-scoring page first
      assert.ok(result.includes('API Endpoints'));
      assert.ok(result.includes('30.0'));
      assert.ok(result.includes('Missing example requests'));
      assert.ok(result.includes('Lacks concrete examples'));

      // Should include score distribution
      assert.ok(result.includes('Score Distribution'));
      assert.ok(result.includes('Min:'));
      assert.ok(result.includes('Max:'));
    });

    it('respects limit parameter', async () => {
      const context = createMockContext({
        qualityBenchmarkRuns: [
          createMockQualityRun('qr-1', 50, 60, { actionability: 50 }, [
            {
              pageId: 'p1',
              pagePath: 'page1',
              pageTitle: 'Page 1',
              scores: { actionability: 30 },
              reasoning: 'Low',
              findings: [],
            },
            {
              pageId: 'p2',
              pagePath: 'page2',
              pageTitle: 'Page 2',
              scores: { actionability: 50 },
              reasoning: 'Medium',
              findings: [],
            },
            {
              pageId: 'p3',
              pagePath: 'page3',
              pageTitle: 'Page 3',
              scores: { actionability: 70 },
              reasoning: 'High',
              findings: [],
            },
          ]),
        ],
      });

      const result = await getQualityDimensionDetailTool.execute({ dimension: 'actionability', limit: 1 }, context);

      // Should only show 1 page (the lowest scoring one)
      assert.ok(result.includes('Page 1'));
      assert.ok(result.includes('showing 1 of 3'));
      assert.ok(!result.includes('Page 2'));
      assert.ok(!result.includes('Page 3'));
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
    it('returns message when repoAccess not available', async () => {
      const context = createMockContext();
      const result = await readSourceFileTool.execute({ path: 'README.md' }, context);
      assert.ok(result.includes('not available'));
    });

    it('reads file content when repoAccess is available', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await readSourceFileTool.execute({ path: 'package.json' }, context);
      assert.ok(result.includes('package.json'));
      assert.ok(result.includes('codewiki'));
    });

    it('returns error for non-existent file', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await readSourceFileTool.execute({ path: 'nonexistent-file.xyz' }, context);
      assert.ok(result.includes('Error'));
    });
  });

  describe('search_source_files', () => {
    it('returns message when repoAccess not available', async () => {
      const context = createMockContext();
      const result = await searchSourceFilesTool.execute({ pattern: '**/*.ts' }, context);
      assert.ok(result.includes('not available'));
    });

    it('finds files matching pattern when repoAccess is available', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await searchSourceFilesTool.execute({ pattern: 'package.json' }, context);
      assert.ok(result.includes('package.json'));
    });

    it('returns message when no files match', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await searchSourceFilesTool.execute({ pattern: '**/*.nonexistent' }, context);
      assert.ok(result.includes('No files found'));
    });
  });

  describe('list_source_directory', () => {
    it('returns message when repoAccess not available', async () => {
      const context = createMockContext();
      const result = await listSourceDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('not available'));
    });

    it('lists directory contents when repoAccess is available', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await listSourceDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('Directory:'));
      assert.ok(result.includes('src/') || result.includes('Directories'));
    });

    it('returns error for non-existent directory', async () => {
      const context = createMockContext({
        repoAccess: createFilesystemRepoAccess(process.cwd()),
      });

      const result = await listSourceDirectoryTool.execute({ path: 'nonexistent-dir' }, context);
      assert.ok(result.includes('Error'));
    });
  });

  // Tests for source tools using mock repoAccess (API-based access)
  describe('read_source_file with mock repoAccess', () => {
    it('reads file via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          getFileContent: async (path) => {
            if (path === 'README.md') {
              return '# Test Project\n\nThis is a test readme.';
            }
            throw new Error('File not found');
          },
        }),
      });

      const result = await readSourceFileTool.execute({ path: 'README.md' }, context);
      assert.ok(result.includes('README.md'), 'Should include file path');
      assert.ok(result.includes('Test Project'), 'Should include file content');
    });

    it('returns error when file not found via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          getFileContent: async () => {
            throw new Error('Not Found');
          },
        }),
      });

      const result = await readSourceFileTool.execute({ path: 'nonexistent.txt' }, context);
      assert.ok(result.includes('Error'), 'Should return error message');
    });
  });

  describe('search_source_files with mock repoAccess', () => {
    it('searches files via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          getFileTree: async () => [
            'src/index.ts',
            'src/services/llm.ts',
            'src/utils/helpers.ts',
            'README.md',
            'package.json',
          ],
        }),
      });

      const result = await searchSourceFilesTool.execute({ pattern: 'src/**/*.ts' }, context);
      assert.ok(result.includes('src/index.ts'), 'Should find matching files');
      assert.ok(result.includes('src/services/llm.ts'), 'Should find nested files');
    });

    it('returns message when no files match via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          getFileTree: async () => ['src/index.ts', 'README.md'],
        }),
      });

      const result = await searchSourceFilesTool.execute({ pattern: '**/*.xyz' }, context);
      assert.ok(result.includes('No files found'), 'Should indicate no matches');
    });
  });

  describe('list_source_directory with mock repoAccess', () => {
    it('lists directory via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          listDirectory: async (path) => {
            if (path === 'src') {
              return [
                { name: 'index.ts', type: 'file' as const },
                { name: 'services', type: 'dir' as const },
                { name: 'utils', type: 'dir' as const },
              ];
            }
            throw new Error('Directory not found');
          },
        }),
      });

      const result = await listSourceDirectoryTool.execute({ path: 'src' }, context);
      assert.ok(result.includes('Directory:'), 'Should show directory header');
      assert.ok(result.includes('index.ts'), 'Should list files');
      assert.ok(result.includes('services/'), 'Should list directories with trailing slash');
    });

    it('returns error when directory not found via repoAccess', async () => {
      const context = createMockContext({
        repoAccess: createMockRepoAccess({
          listDirectory: async () => {
            throw new Error('Not Found');
          },
        }),
      });

      const result = await listSourceDirectoryTool.execute({ path: 'nonexistent' }, context);
      assert.ok(result.includes('Error'), 'Should return error message');
    });
  });

  describe('getAgentPromptTool', () => {
    it('should return prompt for agents with LLM', async () => {
      const context = createMockContext();
      const result = await getAgentPromptTool.execute({ agent_type: 'code-change' }, context);

      assert.ok(result.includes('System Prompt for: code-change'));
      assert.ok(result.includes('technical writer'), 'Should contain prompt content');
    });

    it('should return message for agents without LLM prompt', async () => {
      const context = createMockContext();
      const result = await getAgentPromptTool.execute({ agent_type: 'toc' }, context);

      assert.ok(result.includes('does not use an LLM'), 'Should indicate no prompt');
    });

    it('should return error message for unknown agent type', async () => {
      const context = createMockContext();
      const result = await getAgentPromptTool.execute({ agent_type: 'unknown-agent' }, context);

      assert.ok(result.includes('Unknown agent type'), 'Should mention unknown type');
      assert.ok(result.includes('Available types'), 'Should list available types');
    });

    it('should return orchestrator prompt', async () => {
      const context = createMockContext();
      const result = await getAgentPromptTool.execute({ agent_type: 'orchestrator' }, context);

      assert.ok(result.includes('System Prompt for: orchestrator'));
      // The orchestrator prompt should contain work generation instructions
      assert.ok(result.length > 500, 'Should have substantial prompt content');
    });

    it('should list all available agent types on error', async () => {
      const context = createMockContext();
      const result = await getAgentPromptTool.execute({ agent_type: 'invalid' }, context);

      // Should list key agent types
      assert.ok(result.includes('code-change'));
      assert.ok(result.includes('security'));
      assert.ok(result.includes('orchestrator'));
    });
  });

  // Wiki Page History Tools
  describe('get_page_edit_history', () => {
    it('returns message when page not found', async () => {
      const context = createMockContext({
        wikiPages: [],
      });

      const { getPageEditHistoryTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getPageEditHistoryTool.execute({ page_path: 'nonexistent' }, context);
      assert.ok(result.includes('not found'));
    });

    it('returns message when no history found', async () => {
      const context = createMockContext({
        wikiPages: [createMockPage('docs/api', 'API', 'Content')],
        repos: {
          wikiPageHistory: {
            findByPage: async () => [],
          },
        } as unknown as Repositories,
      });

      const { getPageEditHistoryTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getPageEditHistoryTool.execute({ page_path: 'docs/api' }, context);
      assert.ok(result.includes('No edit history found'));
    });

    it('returns formatted edit history', async () => {
      const mockHistory = [
        {
          id: 'hist-1',
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/api',
          operation: 'update' as const,
          timestamp: new Date('2024-01-15'),
          contentBefore: 'Old content',
          contentAfter: 'New content',
          agentType: 'unknown' as const,
          agentRunId: 'run-1',
        },
        {
          id: 'hist-2',
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/api',
          operation: 'create' as const,
          timestamp: new Date('2024-01-10'),
          contentBefore: null,
          contentAfter: 'Initial content',
          agentType: 'bootstrap' as const,
        },
      ];

      const context = createMockContext({
        wikiPages: [{ ...createMockPage('docs/api', 'API Docs', 'Content'), id: 'page-1' }],
        repos: {
          wikiPageHistory: {
            findByPage: async () => mockHistory,
          },
        } as unknown as Repositories,
      });

      const { getPageEditHistoryTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getPageEditHistoryTool.execute({ page_path: 'docs/api' }, context);

      assert.ok(result.includes('Edit History'));
      assert.ok(result.includes('Total changes: 2'));
      assert.ok(result.includes('UPDATE'));
      assert.ok(result.includes('CREATE'));
      assert.ok(result.includes('unknown'));
      assert.ok(result.includes('bootstrap'));
    });
  });

  describe('get_agent_run_changes', () => {
    it('returns message when no changes found', async () => {
      const context = createMockContext({
        repos: {
          wikiPageHistory: {
            findByAgentRun: async () => [],
          },
        } as unknown as Repositories,
      });

      const { getAgentRunChangesTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getAgentRunChangesTool.execute({ agent_run_id: 'run-1' }, context);
      assert.ok(result.includes('No wiki changes found'));
    });

    it('returns formatted agent changes', async () => {
      const mockHistory = [
        {
          id: 'hist-1',
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/api',
          operation: 'update' as const,
          timestamp: new Date('2024-01-15'),
          contentBefore: 'Old',
          contentAfter: 'New content here',
          agentType: 'unknown' as const,
          agentRunId: 'run-1',
        },
        {
          id: 'hist-2',
          wikiId: 'wiki-1',
          pageId: 'page-2',
          pagePath: 'docs/guide',
          operation: 'create' as const,
          timestamp: new Date('2024-01-15'),
          contentBefore: null,
          contentAfter: 'New page',
          agentType: 'unknown' as const,
          agentRunId: 'run-1',
        },
      ];

      const context = createMockContext({
        repos: {
          wikiPageHistory: {
            findByAgentRun: async () => mockHistory,
          },
        } as unknown as Repositories,
      });

      const { getAgentRunChangesTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getAgentRunChangesTool.execute({ agent_run_id: 'run-1' }, context);

      assert.ok(result.includes('Changes by Agent Run: run-1'));
      assert.ok(result.includes('Total changes: 2'));
      assert.ok(result.includes('docs/api'));
      assert.ok(result.includes('docs/guide'));
    });
  });

  describe('get_edit_details', () => {
    it('returns message when page not found', async () => {
      const context = createMockContext({
        wikiPages: [],
      });

      const { getEditDetailsTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getEditDetailsTool.execute({ page_path: 'nonexistent', edit_index: '0' }, context);
      assert.ok(result.includes('not found'));
    });

    it('returns message when edit index out of range', async () => {
      const context = createMockContext({
        wikiPages: [{ ...createMockPage('docs/api', 'API', 'Content'), id: 'page-1' }],
        repos: {
          wikiPageHistory: {
            findByPage: async () => [{ id: 'hist-1', operation: 'create' }],
          },
        } as unknown as Repositories,
      });

      const { getEditDetailsTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getEditDetailsTool.execute({ page_path: 'docs/api', edit_index: '5' }, context);
      assert.ok(result.includes('out of range'));
    });

    it('returns full edit details with content', async () => {
      const mockHistory = [
        {
          id: 'hist-1',
          wikiId: 'wiki-1',
          pageId: 'page-1',
          pagePath: 'docs/api',
          operation: 'update' as const,
          timestamp: new Date('2024-01-15'),
          contentBefore: '# Old Content\n\nOld text here.',
          contentAfter: '# New Content\n\nNew text here with more details.',
          agentType: 'unknown' as const,
          agentRunId: 'run-1',
        },
      ];

      const context = createMockContext({
        wikiPages: [{ ...createMockPage('docs/api', 'API', 'Content'), id: 'page-1' }],
        repos: {
          wikiPageHistory: {
            findByPage: async () => mockHistory,
          },
        } as unknown as Repositories,
      });

      const { getEditDetailsTool } = await import('../../src/services/llm/analysis-tools.js');
      const result = await getEditDetailsTool.execute({ page_path: 'docs/api', edit_index: '0' }, context);

      assert.ok(result.includes('Edit Details'));
      assert.ok(result.includes('Content Before'));
      assert.ok(result.includes('Old Content'));
      assert.ok(result.includes('Content After'));
      assert.ok(result.includes('New Content'));
    });
  });
});
