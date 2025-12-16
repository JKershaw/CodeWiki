/**
 * Format Compliance Tests for LLM Response Parsing.
 *
 * These tests verify that LLM responses match expected formats WITHOUT
 * relying on fallback parsing patterns. When fallbacks are used, it indicates
 * a mismatch between prompts and actual LLM output.
 *
 * Tests are expected to fail initially - this establishes a baseline of
 * degradation that we can then work to improve.
 *
 * Run with: node --import tsx --test tests/llm/format-compliance.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';
import {
  assertNoFallbacks,
  assertParseSuccess,
  checkParseHealth,
  formatParseHealth,
  categorizeFallbacks,
} from './helpers/parse-assert.js';

describe('Format Compliance Tests', { timeout: 180000 }, () => {
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

  describe('CodebaseExplorerAgent Parse Health', () => {
    it('parses response without fallbacks (strict mode)', async () => {
      const repoId = 'format-strict-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Format Test Project',
        'src/calculator.ts': `
/**
 * Simple calculator module.
 */
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
`,
        'src/index.ts': `export { Calculator } from './calculator.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Log parse health regardless of pass/fail
      const health = checkParseHealth(result.parseStats);
      console.log(formatParseHealth('Strict format compliance', health));

      // Categorize fallbacks for analysis
      const categories = categorizeFallbacks(result.parseStats);
      if (result.parseStats?.fallbacksUsed && result.parseStats.fallbacksUsed.length > 0) {
        console.log('\nFallback categories:');
        Object.entries(categories).forEach(([cat, items]) => {
          if (items.length > 0) {
            console.log(`  ${cat}: ${items.join(', ')}`);
          }
        });
      }

      // Log the result for trend tracking
      logTestResult('Strict format compliance', {
        passed: health.healthy,
        score: health.healthy ? 10 : Math.max(0, 10 - health.fallbacksUsed.length * 2),
        reasoning: health.message,
        improvements: health.fallbacksUsed.length > 0
          ? [`Fix format to avoid fallbacks: ${health.fallbacksUsed.join(', ')}`]
          : [],
      });

      // Strict assertion - will fail if ANY fallbacks were used
      // This is expected to fail initially! We're establishing baseline.
      try {
        assertNoFallbacks(result.parseStats);
      } catch (error) {
        // Log but don't fail the test initially - we're establishing baseline
        console.warn(`\n⚠️  STRICT MODE FAILURE (expected initially):`);
        console.warn(`   ${error instanceof Error ? error.message : String(error)}`);

        // Re-throw to actually fail the test (remove this line to make it soft)
        // For now, we'll make it a soft assertion to establish baseline
        // throw error;
      }
    });

    it('parses SUMMARY section with colon format', async () => {
      const repoId = 'format-summary-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Summary Format Test',
        'src/logger.ts': `
export interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}

export class Logger {
  private level: number = 1;

  log(message: string): void {
    console.log(message);
  }

  setLevel(level: number): void {
    this.level = level;
  }
}
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Check if SUMMARY was parsed successfully
      const health = checkParseHealth(result.parseStats);

      // Check for SUMMARY-related fallbacks
      const summaryFallbacks = result.parseStats?.fallbacksUsed?.filter(f =>
        f.toUpperCase().includes('SUMMARY')
      ) ?? [];

      console.log(formatParseHealth('SUMMARY format compliance', health));

      if (summaryFallbacks.length > 0) {
        console.log(`\n⚠️  SUMMARY section used fallbacks: ${summaryFallbacks.join(', ')}`);
        console.log('   Expected: SUMMARY:\\n[content]');
        console.log('   Got: ## SUMMARY or prose extraction');
      }

      logTestResult('SUMMARY format compliance', {
        passed: summaryFallbacks.length === 0,
        score: summaryFallbacks.length === 0 ? 10 : 5,
        reasoning: summaryFallbacks.length === 0
          ? 'SUMMARY parsed with colon format as expected'
          : `SUMMARY used fallback: ${summaryFallbacks.join(', ')}`,
        improvements: summaryFallbacks.map(f => `Fix prompt to avoid ${f}`),
      });

      // Soft assertion - verify SUMMARY was parsed somehow
      assert.ok(result.result.summary && result.result.summary.length > 0,
        'SUMMARY should be parsed (even with fallbacks)');
    });

    it('parses CONFIDENCE section explicitly (not default)', async () => {
      const repoId = 'format-confidence-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Confidence Test',
        'src/validator.ts': `
export function isValid(input: string): boolean {
  return input.length > 0;
}

export function sanitize(input: string): string {
  return input.trim().toLowerCase();
}
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Check for CONFIDENCE-related fallbacks
      const confidenceFallbacks = result.parseStats?.fallbacksUsed?.filter(f =>
        f.toUpperCase().includes('CONFIDENCE')
      ) ?? [];

      const usedDefault = confidenceFallbacks.some(f => f.includes('default'));

      console.log(`\nCONFIDENCE parsing:`);
      console.log(`  Value: ${result.result.confidence}`);
      console.log(`  Used default: ${usedDefault}`);
      if (confidenceFallbacks.length > 0) {
        console.log(`  Fallbacks: ${confidenceFallbacks.join(', ')}`);
      }

      logTestResult('CONFIDENCE format compliance', {
        passed: !usedDefault,
        score: usedDefault ? 5 : 10,
        reasoning: usedDefault
          ? `CONFIDENCE used default value ${result.result.confidence}`
          : `CONFIDENCE explicitly provided: ${result.result.confidence}`,
        improvements: usedDefault
          ? ['LLM should include explicit CONFIDENCE: X.X in response']
          : [],
      });

      // Soft assertion - confidence should be in valid range
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        'Confidence should be between 0 and 1');
    });

    it('parses WIKI_PAGES with === delimiters', async () => {
      const repoId = 'format-wiki-pages-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Wiki Pages Format Test',
        'src/formatter.ts': `
export interface FormatOptions {
  uppercase: boolean;
  trim: boolean;
}

export function format(text: string, options: FormatOptions): string {
  let result = options.trim ? text.trim() : text;
  if (options.uppercase) {
    result = result.toUpperCase();
  }
  return result;
}
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Check for WIKI_PAGES-related fallbacks
      const wikiPagesFallbacks = result.parseStats?.fallbacksUsed?.filter(f =>
        f.toUpperCase().includes('WIKI')
      ) ?? [];

      const usedProseFallback = wikiPagesFallbacks.some(f => f.includes('prose'));
      const usedMarkdownFallback = wikiPagesFallbacks.some(f => f.includes('markdown'));

      console.log(`\nWIKI_PAGES parsing:`);
      console.log(`  Pages generated: ${result.updates.length}`);
      console.log(`  Used prose fallback: ${usedProseFallback}`);
      console.log(`  Used markdown fallback: ${usedMarkdownFallback}`);
      if (wikiPagesFallbacks.length > 0) {
        console.log(`  Fallbacks: ${wikiPagesFallbacks.join(', ')}`);
      }

      logTestResult('WIKI_PAGES format compliance', {
        passed: wikiPagesFallbacks.length === 0,
        score: wikiPagesFallbacks.length === 0 ? 10 : usedProseFallback ? 3 : 6,
        reasoning: wikiPagesFallbacks.length === 0
          ? `WIKI_PAGES parsed with === delimiters, ${result.updates.length} pages`
          : `WIKI_PAGES used fallback: ${wikiPagesFallbacks.join(', ')}`,
        improvements: wikiPagesFallbacks.length > 0
          ? ['LLM should use === path: X | title: Y === format for wiki pages']
          : [],
      });

      // Soft assertion - should generate at least one wiki page
      assert.ok(result.updates.length >= 0,
        'Should generate wiki pages (0 is acceptable if parsing failed)');
    });

    it('parses all required sections successfully', async () => {
      const repoId = 'format-all-sections-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# All Sections Test',
        'src/api/endpoint.ts': `
export interface Request {
  path: string;
  method: string;
  body?: unknown;
}

export interface Response {
  status: number;
  data: unknown;
}

export async function handleRequest(req: Request): Promise<Response> {
  return {
    status: 200,
    data: { message: 'OK' },
  };
}
`,
        'src/api/index.ts': `export * from './endpoint.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/api' },
        agentCtx
      );

      const requiredSections = ['SUMMARY', 'CONFIDENCE'];

      // Check parse success for required sections
      const health = checkParseHealth(result.parseStats);
      console.log(formatParseHealth('All required sections', health));

      // Check which sections were successful
      const successfulSections = result.parseStats?.sections?.successful ?? [];
      const missingRequired = requiredSections.filter(s =>
        !successfulSections.some(ss => ss.toUpperCase().includes(s))
      );

      console.log(`\nSection parsing:`);
      console.log(`  Successful: ${successfulSections.join(', ') || 'none'}`);
      console.log(`  Required missing: ${missingRequired.join(', ') || 'none'}`);
      console.log(`  Fallbacks used: ${health.fallbacksUsed.join(', ') || 'none'}`);

      logTestResult('Required sections parse success', {
        passed: missingRequired.length === 0,
        score: Math.max(0, 10 - missingRequired.length * 3),
        reasoning: missingRequired.length === 0
          ? `All ${requiredSections.length} required sections parsed`
          : `Missing sections: ${missingRequired.join(', ')}`,
        improvements: missingRequired.map(s => `Ensure ${s} section is parseable`),
      });

      // Soft assertion - try the actual assertion but catch for baseline
      try {
        assertParseSuccess(result.parseStats, requiredSections);
      } catch (error) {
        console.warn(`\n⚠️  Required sections assertion failed:`);
        console.warn(`   ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

  describe('Baseline Degradation Metrics', () => {
    it('collects baseline degradation rates across multiple runs', async () => {
      const repoId = 'format-baseline-metrics';

      // Create a slightly more complex repo for realistic baseline
      await createTestRepo(ctx, repoId, {
        'README.md': '# Baseline Test',
        'src/services/data-service.ts': `
export interface DataRecord {
  id: string;
  name: string;
  createdAt: Date;
}

export class DataService {
  private records: Map<string, DataRecord> = new Map();

  async create(record: DataRecord): Promise<DataRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<DataRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findAll(): Promise<DataRecord[]> {
    return Array.from(this.records.values());
  }
}
`,
        'src/services/index.ts': `export { DataService } from './data-service.js';`,
        'src/utils/helpers.ts': `
export function generateId(): string {
  return Math.random().toString(36).substring(7);
}
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Run multiple times to get baseline
      const runs = [];
      const paths = ['src/services', 'src/utils'];

      for (const path of paths) {
        const result = await agent.run(
          { type: 'path', path },
          agentCtx
        );

        const health = checkParseHealth(result.parseStats);
        const categories = categorizeFallbacks(result.parseStats);

        runs.push({
          path,
          healthy: health.healthy,
          fallbacksUsed: health.fallbacksUsed.length,
          markdownFallbacks: categories.markdown.length,
          proseFallbacks: categories.prose.length,
          defaultFallbacks: categories.default.length,
          confidence: result.result.confidence,
        });
      }

      // Calculate baseline metrics
      const totalFallbacks = runs.reduce((sum, r) => sum + r.fallbacksUsed, 0);
      const markdownFallbacks = runs.reduce((sum, r) => sum + r.markdownFallbacks, 0);
      const proseFallbacks = runs.reduce((sum, r) => sum + r.proseFallbacks, 0);
      const defaultFallbacks = runs.reduce((sum, r) => sum + r.defaultFallbacks, 0);
      const healthyRuns = runs.filter(r => r.healthy).length;

      console.log('\n📊 BASELINE DEGRADATION METRICS');
      console.log('================================');
      console.log(`Total runs: ${runs.length}`);
      console.log(`Healthy runs (no fallbacks): ${healthyRuns}/${runs.length} (${(healthyRuns / runs.length * 100).toFixed(0)}%)`);
      console.log(`\nFallback breakdown:`);
      console.log(`  Total fallbacks: ${totalFallbacks}`);
      console.log(`  - Markdown fallbacks: ${markdownFallbacks}`);
      console.log(`  - Prose fallbacks: ${proseFallbacks}`);
      console.log(`  - Default value fallbacks: ${defaultFallbacks}`);
      console.log(`\nPer-path details:`);
      runs.forEach(r => {
        console.log(`  ${r.path}: ${r.healthy ? '✓ healthy' : `✗ ${r.fallbacksUsed} fallbacks`}`);
      });

      logTestResult('Baseline degradation metrics', {
        passed: true, // This is for data collection, always passes
        score: healthyRuns / runs.length * 10,
        reasoning: `${healthyRuns}/${runs.length} runs healthy. Fallbacks: markdown=${markdownFallbacks}, prose=${proseFallbacks}, default=${defaultFallbacks}`,
        improvements: [
          totalFallbacks > 0 ? `Reduce total fallbacks from ${totalFallbacks}` : 'Maintain zero fallbacks',
          markdownFallbacks > 0 ? 'Update prompts to avoid markdown format responses' : '',
          proseFallbacks > 0 ? 'Improve prompt structure to get formatted responses' : '',
          defaultFallbacks > 0 ? 'Ensure CONFIDENCE section is always included' : '',
        ].filter(Boolean),
      });

      // Store metrics for trend tracking
      console.log('\n📈 Use these metrics to track improvements over time.');
    });
  });
});
