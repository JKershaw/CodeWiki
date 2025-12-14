/**
 * Real LLM tests for Self-Improvement Analysis Agent.
 *
 * Tests that the agent produces useful, accurate analysis when given
 * benchmark data, wiki pages, and source code access.
 *
 * Run with: node --import tsx --test tests/llm/self-improvement-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SelfImprovementAgent } from '../../src/analysis/self-improvement-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { BenchmarkRun, BenchmarkResult } from '../../src/domain/benchmark.js';
import type { QualityBenchmarkRun } from '../../src/domain/quality-benchmark.js';
import { v4 as uuid } from 'uuid';

describe('SelfImprovementAgent with Real LLM', { timeout: 300000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
    ctx = await createLLMTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
    await saveTestRun();
  });

  /**
   * Helper to create wiki pages directly.
   */
  async function createWikiPages(
    wikiId: string,
    pages: Array<{ path: string; title: string; content: string; confidence?: number }>
  ): Promise<void> {
    for (const page of pages) {
      const wikiPage: WikiPage = {
        id: `page-${uuid()}`,
        wikiId,
        path: page.path,
        title: page.title,
        content: page.content,
        confidence: page.confidence ?? 0.7,
        sourceCommits: ['abc123'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(wikiPage);
    }
  }

  /**
   * Helper to create a benchmark run with results.
   */
  async function createBenchmarkRun(
    repoId: string,
    wikiId: string,
    iterationCount: number,
    results: Array<{
      questionId: string;
      grade: 'accurate' | 'partial' | 'inaccurate' | 'no_answer';
      wikiAnswer: string;
      reasoning: string;
    }>
  ): Promise<BenchmarkRun> {
    const benchmarkResults: BenchmarkResult[] = results.map(r => ({
      questionId: r.questionId,
      grade: r.grade,
      confidence: r.grade === 'accurate' ? 0.9 : r.grade === 'partial' ? 0.6 : 0.3,
      wikiAnswer: r.wikiAnswer,
      reasoning: r.reasoning,
      codeReferences: [],
      durationMs: 1000,
      costUsd: 0.01,
    }));

    const summary = {
      totalQuestions: results.length,
      accurate: results.filter(r => r.grade === 'accurate').length,
      partial: results.filter(r => r.grade === 'partial').length,
      inaccurate: results.filter(r => r.grade === 'inaccurate').length,
      noAnswer: results.filter(r => r.grade === 'no_answer').length,
      score: 0,
      byCategory: {},
      byDifficulty: {
        easy: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        medium: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
        hard: { score: 0, total: 0, accurate: 0, partial: 0, inaccurate: 0, noAnswer: 0 },
      },
    };
    // Calculate score: accurate=100, partial=50, inaccurate/no_answer=0
    summary.score =
      ((summary.accurate * 100 + summary.partial * 50) / summary.totalQuestions) || 0;

    const run: BenchmarkRun = {
      id: uuid(),
      repoId,
      wikiId,
      status: 'completed',
      startedAt: new Date(Date.now() - 60000),
      completedAt: new Date(),
      iterationCount,
      pageCount: iterationCount * 2,
      results: benchmarkResults,
      summary,
      totalCostUsd: 0.1,
      error: null,
    };

    await ctx.repos.benchmarks.save(run);
    return run;
  }

  /**
   * Helper to create a quality benchmark run.
   */
  async function createQualityBenchmarkRun(
    repoId: string,
    wikiId: string,
    iterationCount: number,
    overallScore: number,
    byDimension: Record<string, number>
  ): Promise<QualityBenchmarkRun> {
    const run: QualityBenchmarkRun = {
      id: uuid(),
      repoId,
      wikiId,
      status: 'completed',
      startedAt: new Date(Date.now() - 60000),
      completedAt: new Date(),
      iterationCount,
      pageCount: 10,
      results: [],
      summary: {
        pagesEvaluated: 10,
        overallScore,
        byDimension,
        strengths: overallScore > 60 ? ['Good structure'] : [],
        weaknesses: overallScore < 50 ? ['Needs improvement'] : [],
      },
      totalCostUsd: 0.1,
      error: null,
    };

    await ctx.repos.qualityBenchmarks.save(run);
    return run;
  }

  describe('Phase 1: Current Benchmark-Driven Behavior', () => {
    it('identifies improving questions and produces structured report', async () => {
      const repoId = 'llm-self-improvement-improving';

      // Create test repository with source code
      await createTestRepo(ctx, repoId, {
        'README.md': '# Auth Service\n\nAuthentication service for the platform.',
        'src/auth.ts': `
export class AuthService {
  async login(username: string, password: string): Promise<string> {
    // Validate credentials and return JWT token
    return 'jwt-token';
  }

  async logout(token: string): Promise<void> {
    // Invalidate the token
  }
}
`,
        'src/config.ts': `
export const CONFIG = {
  jwtSecret: process.env.JWT_SECRET,
  tokenExpiry: '24h',
};
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki pages
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'overview',
          title: 'Overview',
          content: '# Auth Service Overview\n\nThis service handles authentication.',
        },
        {
          path: 'auth/login',
          title: 'Login',
          content: '# Login\n\nThe login endpoint accepts username and password and returns a JWT token.',
        },
      ]);

      // Create benchmark runs showing improvement
      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        {
          questionId: 'auth-login-flow',
          grade: 'no_answer',
          wikiAnswer: 'No information found about login flow.',
          reasoning: 'The wiki does not contain login documentation.',
        },
        {
          questionId: 'auth-token-format',
          grade: 'no_answer',
          wikiAnswer: 'No information found.',
          reasoning: 'Token format not documented.',
        },
      ]);

      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 50, [
        {
          questionId: 'auth-login-flow',
          grade: 'accurate',
          wikiAnswer: 'Login accepts username/password and returns JWT token.',
          reasoning: 'The wiki correctly documents the login flow.',
        },
        {
          questionId: 'auth-token-format',
          grade: 'partial',
          wikiAnswer: 'The system uses JWT tokens.',
          reasoning: 'Token type mentioned but expiry not documented.',
        },
      ]);

      // Run the self-improvement agent
      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);
      assert.ok(result.report.length > 100, 'Report should have substantial content');

      // LLM-as-judge: Evaluate the report quality
      const evalResult = await evaluateLLM(
        'The analysis report should: ' +
        '1) Identify that auth-login-flow improved from no_answer to accurate. ' +
        '2) Note that auth-token-format improved but is still partial. ' +
        '3) Have a structured format with sections like Executive Summary and Recommendations. ' +
        '4) Provide actionable recommendations for process improvement.',
        result.report,
        6
      );

      logTestResult('Improving questions identification', evalResult);
      console.log(formatEvaluationResult('Improving questions identification', evalResult));
    });

    it('identifies stuck questions and investigates root causes', async () => {
      const repoId = 'llm-self-improvement-stuck';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Service',
        'src/api/endpoints.ts': `
// REST API endpoints
export function setupRoutes(app: Express) {
  app.get('/users', listUsers);
  app.post('/users', createUser);
  app.get('/users/:id', getUser);
}
`,
        'src/api/middleware.ts': `
// Rate limiting middleware
export function rateLimit(limit: number) {
  return (req, res, next) => {
    // Check rate limit
    next();
  };
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki pages with gaps
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'api/overview',
          title: 'API Overview',
          content: '# API Overview\n\nREST API for user management.',
        },
        {
          path: 'api/endpoints',
          title: 'Endpoints',
          content: '# Endpoints\n\n- GET /users\n- POST /users',
          confidence: 0.4,
        },
      ]);

      // Create benchmark runs showing stuck questions
      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        {
          questionId: 'api-rate-limiting',
          grade: 'no_answer',
          wikiAnswer: 'No information about rate limiting.',
          reasoning: 'Rate limiting is not documented in the wiki.',
        },
        {
          questionId: 'api-error-handling',
          grade: 'inaccurate',
          wikiAnswer: 'Errors return 500.',
          reasoning: 'This is incorrect, the system has proper error handling.',
        },
      ]);

      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 30, [
        {
          questionId: 'api-rate-limiting',
          grade: 'no_answer',
          wikiAnswer: 'No information about rate limiting.',
          reasoning: 'Still not documented after more iterations.',
        },
        {
          questionId: 'api-error-handling',
          grade: 'inaccurate',
          wikiAnswer: 'Errors return 500.',
          reasoning: 'Still incorrect.',
        },
      ]);

      const run3 = await createBenchmarkRun(repoId, agentCtx.wikiId, 50, [
        {
          questionId: 'api-rate-limiting',
          grade: 'no_answer',
          wikiAnswer: 'No information about rate limiting.',
          reasoning: 'Rate limiting middleware exists in source but not documented.',
        },
        {
          questionId: 'api-error-handling',
          grade: 'partial',
          wikiAnswer: 'The API handles errors.',
          reasoning: 'Generic statement, lacks specifics.',
        },
      ]);

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id, run3.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);

      // LLM-as-judge: Evaluate stuck question analysis
      const evalResult = await evaluateLLM(
        'The analysis should: ' +
        '1) Identify api-rate-limiting as a stuck question (no_answer across all runs). ' +
        '2) Note that rate limiting exists in source code (middleware.ts) but is not in wiki. ' +
        '3) Recommend process changes to capture middleware documentation. ' +
        '4) Identify api-error-handling showed some improvement (inaccurate to partial).',
        result.report,
        6
      );

      logTestResult('Stuck questions investigation', evalResult);
      console.log(formatEvaluationResult('Stuck questions investigation', evalResult));
    });

    it('uses tools appropriately during analysis', async () => {
      const repoId = 'llm-self-improvement-tools';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => console.log("hello");',
      });

      const agentCtx = await ctx.agentContext(repoId);

      await createWikiPages(agentCtx.wikiId, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nTest project.' },
      ]);

      // Create minimal benchmark runs
      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        { questionId: 'q1', grade: 'partial', wikiAnswer: 'Some info', reasoning: 'Partial' },
      ]);
      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 20, [
        { questionId: 'q1', grade: 'accurate', wikiAnswer: 'Full info', reasoning: 'Complete' },
      ]);

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);
      assert.ok(result.analysisTrace, 'Should have analysis trace');
      assert.ok(result.analysisTrace!.toolCalls.length > 0, 'Should have made tool calls');

      // Check that appropriate tools were used
      const toolNames = result.analysisTrace!.toolCalls.map(tc => tc.name);

      // LLM-as-judge: Evaluate tool usage
      const evalResult = await evaluateLLM(
        'The agent should have used a reasonable set of analysis tools. ' +
        'Expected tools include: get_benchmark_summary, get_question_trends, ' +
        'list_wiki_pages, and possibly get_page_content or source exploration tools. ' +
        'Tool usage should be purposeful, not random.',
        `Tool calls made: ${toolNames.join(', ')}\n\nTotal tool rounds: ${result.analysisTrace!.toolRounds}`,
        6
      );

      logTestResult('Tool usage patterns', evalResult);
      console.log(formatEvaluationResult('Tool usage patterns', evalResult));
    });

    it('correlates quality benchmarks with accuracy benchmarks', async () => {
      const repoId = 'llm-self-improvement-quality';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Quality Test',
        'src/main.ts': 'console.log("main");',
      });

      const agentCtx = await ctx.agentContext(repoId);

      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'overview',
          title: 'Overview',
          content: '# Overview\n\nThis is a project overview with good structure.',
        },
        {
          path: 'guides/setup',
          title: 'Setup Guide',
          content: '# Setup\n\nTODO: Add setup instructions.',
          confidence: 0.3,
        },
      ]);

      // Create accuracy benchmarks
      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        { questionId: 'setup-instructions', grade: 'no_answer', wikiAnswer: 'Not found', reasoning: 'Setup not documented' },
      ]);
      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 30, [
        { questionId: 'setup-instructions', grade: 'no_answer', wikiAnswer: 'TODO placeholder', reasoning: 'Still just a placeholder' },
      ]);

      // Create quality benchmarks
      await createQualityBenchmarkRun(repoId, agentCtx.wikiId, 10, 45, {
        completeness_coverage: 30,
        actionability: 25,
        structural_quality: 70,
      });
      await createQualityBenchmarkRun(repoId, agentCtx.wikiId, 30, 48, {
        completeness_coverage: 35,
        actionability: 28,
        structural_quality: 72,
      });

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);

      // LLM-as-judge: Evaluate quality correlation
      const evalResult = await evaluateLLM(
        'The analysis should correlate accuracy and quality benchmarks: ' +
        '1) Note low actionability scores (25-28) correlate with stuck setup question. ' +
        '2) Identify that completeness_coverage is low (30-35). ' +
        '3) Recommend improvements to address actionability gaps. ' +
        '4) Note that structural_quality is relatively good.',
        result.report,
        5
      );

      logTestResult('Quality benchmark correlation', evalResult);
      console.log(formatEvaluationResult('Quality benchmark correlation', evalResult));
    });
  });

  describe('Phase 3: Wiki-Quality-First Behavior (New)', () => {
    it('assesses wiki quality without requiring benchmark failures as driver', async () => {
      const repoId = 'llm-self-improvement-wiki-first';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Wiki Quality Test',
        'src/services/auth.ts': `
export class AuthService {
  validateToken(token: string): boolean {
    return token.startsWith('Bearer ');
  }
}
`,
        'src/services/database.ts': `
export class DatabaseService {
  async connect(): Promise<void> {
    // Connect to database
  }
}
`,
        'src/utils/helpers.ts': `
export function formatDate(date: Date): string {
  return date.toISOString();
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki with obvious gaps (auth documented, database not)
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'overview',
          title: 'Project Overview',
          content: '# Project Overview\n\nThis project has auth and database services.',
        },
        {
          path: 'services/auth',
          title: 'Auth Service',
          content: '# Auth Service\n\nValidates Bearer tokens for authentication.',
          confidence: 0.8,
        },
        // Note: No database documentation - this is a coverage gap
      ]);

      // Create benchmark runs (minimal - not the focus)
      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        { questionId: 'q1', grade: 'accurate', wikiAnswer: 'Answer', reasoning: 'Good' },
      ]);
      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 20, [
        { questionId: 'q1', grade: 'accurate', wikiAnswer: 'Answer', reasoning: 'Good' },
      ]);

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);

      // LLM-as-judge: Evaluate wiki-quality assessment
      const evalResult = await evaluateLLM(
        'The analysis should assess wiki quality holistically: ' +
        '1) Identify that database service exists in source but not in wiki (coverage gap). ' +
        '2) Note that auth service is well documented. ' +
        '3) Identify helpers/utils might need documentation. ' +
        '4) Recommend adding database service documentation. ' +
        'Focus should be on wiki completeness, not just benchmark scores.',
        result.report,
        5
      );

      logTestResult('Wiki quality assessment', evalResult);
      console.log(formatEvaluationResult('Wiki quality assessment', evalResult));
    });

    it('explores source code to identify documentation gaps', async () => {
      const repoId = 'llm-self-improvement-source-gaps';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Source Gap Test',
        'src/api/routes.ts': `
export function setupRoutes(app) {
  app.get('/health', healthCheck);
  app.get('/users', getUsers);
  app.post('/orders', createOrder);
}
`,
        'src/api/middleware/auth.ts': `
export function authMiddleware(req, res, next) {
  // Check auth header
  next();
}
`,
        'src/api/middleware/logging.ts': `
export function loggingMiddleware(req, res, next) {
  console.log(req.method, req.path);
  next();
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create minimal wiki (doesn't cover middleware)
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'api/routes',
          title: 'API Routes',
          content: '# API Routes\n\n- GET /health\n- GET /users\n- POST /orders',
        },
      ]);

      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        { questionId: 'q1', grade: 'partial', wikiAnswer: 'A', reasoning: 'R' },
      ]);
      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 20, [
        { questionId: 'q1', grade: 'accurate', wikiAnswer: 'A', reasoning: 'R' },
      ]);

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);

      // Check that source tools were used
      const toolNames = result.analysisTrace?.toolCalls.map(tc => tc.name) || [];
      const usedSourceTools = toolNames.some(
        name => name.includes('source') || name.includes('list_source') || name.includes('read_source')
      );

      // LLM-as-judge: Evaluate source exploration
      const evalResult = await evaluateLLM(
        'The analysis should explore source code to find gaps: ' +
        '1) Identify middleware directory exists but is not documented. ' +
        '2) Note auth middleware and logging middleware are undocumented. ' +
        '3) Recommend documenting the middleware layer. ' +
        '4) Compare wiki structure to source structure.',
        result.report + `\n\nSource tools used: ${usedSourceTools}`,
        5
      );

      logTestResult('Source code gap analysis', evalResult);
      console.log(formatEvaluationResult('Source code gap analysis', evalResult));
    });

    it('produces actionable process-focused recommendations', async () => {
      const repoId = 'llm-self-improvement-recommendations';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Recommendations Test',
        'src/index.ts': 'console.log("test");',
      });

      const agentCtx = await ctx.agentContext(repoId);

      await createWikiPages(agentCtx.wikiId, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nTest project.', confidence: 0.5 },
      ]);

      const run1 = await createBenchmarkRun(repoId, agentCtx.wikiId, 10, [
        { questionId: 'q1', grade: 'no_answer', wikiAnswer: 'Not found', reasoning: 'Missing' },
        { questionId: 'q2', grade: 'inaccurate', wikiAnswer: 'Wrong', reasoning: 'Incorrect' },
      ]);
      const run2 = await createBenchmarkRun(repoId, agentCtx.wikiId, 30, [
        { questionId: 'q1', grade: 'partial', wikiAnswer: 'Some', reasoning: 'Partial' },
        { questionId: 'q2', grade: 'inaccurate', wikiAnswer: 'Wrong', reasoning: 'Still incorrect' },
      ]);

      const agent = new SelfImprovementAgent(ctx.repos, ctx.llm, ctx.git, ctx.repoServiceFactory);
      const result = await agent.analyze(repoId, agentCtx.wikiId, [run1.id, run2.id]);

      assert.strictEqual(result.status, 'completed', `Agent failed: ${result.error}`);

      // LLM-as-judge: Evaluate recommendation quality
      const evalResult = await evaluateLLM(
        'The recommendations should be: ' +
        '1) Process-focused (improve generation system, not fix specific content). ' +
        '2) Specific and actionable (e.g., "add X to agent Y prompt" not "improve docs"). ' +
        '3) Address root causes (orchestrator strategy, agent prompts, etc.). ' +
        '4) Include verification criteria (how to measure success). ' +
        'Bad: "Document X better". Good: "Agent Z should extract X when analyzing Y files".',
        result.report,
        5
      );

      logTestResult('Process-focused recommendations', evalResult);
      console.log(formatEvaluationResult('Process-focused recommendations', evalResult));
    });
  });
});
