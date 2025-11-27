/**
 * Integration tests for TechnicalDebtAgent.
 * Tests the agent running against real commits with mocked LLM.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { TechnicalDebtAgent } from '../../src/agents/analysis/technical-debt-agent.js';

describe('TechnicalDebtAgent Integration', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    ctx.llm.reset();
  });

  describe('runOnCommit', () => {
    it('analyzes a commit with technical debt and creates wiki pages', async () => {
      const repoId = 'debt-test-repo-1';
      await createTestRepo(ctx, repoId, {
        'src/processor.ts': `
export function processData(data: any) {
  // Very long function with lots of complexity
  if (data.type === 'A') {
    if (data.subtype === 'A1') {
      // deep nesting
      if (data.value > 100) {
        // more nesting
        for (let i = 0; i < data.items.length; i++) {
          // TODO: refactor this
          console.log(data.items[i]);
        }
      }
    }
  }
  // Magic number
  setTimeout(() => {}, 5000);
  return data;
}
`,
      });

      // Add a commit with technical debt
      const sha = await addCommit(ctx, repoId, {
        'src/processor.ts': `
export function processData(data: any) {
  // Even more complex now
  if (data.type === 'A') {
    if (data.subtype === 'A1') {
      if (data.value > 100) {
        for (let i = 0; i < data.items.length; i++) {
          // TODO: refactor this
          // FIXME: potential bug here
          console.log(data.items[i]);
          if (data.items[i].active) {
            // Deeper nesting added
            console.log('active');
          }
        }
      }
    }
  }
  // Magic numbers everywhere
  setTimeout(() => {}, 5000);
  setTimeout(() => {}, 3000);
  return data;
}
`,
      }, 'Add more complexity to processor');

      // Save commit to repository
      const { createCommit } = await import('../../src/domain/commit.js');
      const commit = createCommit({
        id: 'test-commit-debt-1',
        repoId,
        sha,
        message: 'Add more complexity to processor',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 5,
          affectedFiles: ['src/processor.ts'],
        },
      });
      await ctx.repos.commits.save(commit);

      // Configure mock LLM response for technical debt analysis
      ctx.llm.setDefaultResponse(`SUMMARY:
This commit increases technical debt by adding deeper nesting and additional magic numbers to the processor function.

DEBT_LEVEL:
high

ISSUES:
- [Deep Nesting] [SEVERITY:high] Function has 5 levels of nesting, exceeding recommended 4 levels [src/processor.ts]
- [Magic Numbers] [SEVERITY:medium] Multiple hardcoded timeout values (5000, 3000) [src/processor.ts]
- [Technical Shortcut] [SEVERITY:low] TODO and FIXME comments indicate incomplete work [src/processor.ts]

DEBT_ADDED:
- Additional nesting level in processData function
- Second magic number timeout value

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Extract nested logic into separate helper functions
- Define timeout constants in configuration
- Address TODO and FIXME comments

HOTSPOTS:
- src/processor.ts

CONFIDENCE: 0.88`);

      const agent = new TechnicalDebtAgent();
      const result = await agent.runOnCommit('test-commit-debt-1', ctx.agentContext(repoId));

      // Verify findings
      assert.ok(result.result.findings.length >= 2, 'Should find multiple issues');
      assert.ok(result.result.summary.includes('technical debt'), 'Summary should mention technical debt');

      // Verify high-importance findings
      const highImportance = result.result.findings.filter(f => f.importance === 'high');
      assert.ok(highImportance.length >= 1, 'Should have at least one high importance finding');

      // Verify wiki updates were created
      assert.ok(result.updates.length >= 1, 'Should create wiki updates');

      // Check for report page
      const reportPage = result.updates.find(u => u.path.startsWith('technical-debt/report-'));
      assert.ok(reportPage, 'Should create technical debt report page');
      assert.ok(reportPage.content.includes('HIGH'), 'Report should show HIGH debt level');

      // Check for overview update
      const overviewPage = result.updates.find(u => u.path === 'technical-debt/overview');
      assert.ok(overviewPage, 'Should update overview page');
    });

    it('reports no debt for clean commits', async () => {
      const repoId = 'debt-test-repo-2';
      await createTestRepo(ctx, repoId, {
        'src/clean.ts': 'export const VERSION = "1.0.0";',
      });

      const sha = await addCommit(ctx, repoId, {
        'src/clean.ts': `
export const VERSION = "1.0.1";

/**
 * Format a version string for display.
 */
export function formatVersion(version: string): string {
  return \`v\${version}\`;
}
`,
      }, 'Add version formatter');

      const { createCommit } = await import('../../src/domain/commit.js');
      const commit = createCommit({
        id: 'test-commit-clean-1',
        repoId,
        sha,
        message: 'Add version formatter',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 8,
          linesDeleted: 1,
          affectedFiles: ['src/clean.ts'],
        },
      });
      await ctx.repos.commits.save(commit);

      ctx.llm.setDefaultResponse(`SUMMARY:
Clean commit that adds a well-structured utility function with proper documentation.

DEBT_LEVEL:
none

ISSUES:
- None identified

DEBT_ADDED:
- None

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- None

HOTSPOTS:
- None

CONFIDENCE: 0.92`);

      const agent = new TechnicalDebtAgent();
      const result = await agent.runOnCommit('test-commit-clean-1', ctx.agentContext(repoId));

      // Should have no significant findings
      assert.strictEqual(result.result.findings.length, 0, 'Should have no findings for clean commit');

      // Should not create wiki pages for debt-free commits
      assert.strictEqual(result.updates.length, 0, 'Should not create wiki updates for clean commit');
    });

    it('detects debt removal in refactoring commits', async () => {
      const repoId = 'debt-test-repo-3';
      await createTestRepo(ctx, repoId, {
        'src/legacy.ts': `
// Old messy code
function doStuff(a,b,c,d,e,f,g) {
  if (a) {
    if (b) {
      if (c) {
        return d + e + f + g;
      }
    }
  }
  return 42; // magic number
}
`,
      });

      const sha = await addCommit(ctx, repoId, {
        'src/legacy.ts': `
interface Options {
  a: boolean;
  b: boolean;
  c: boolean;
  values: { d: number; e: number; f: number; g: number };
}

const DEFAULT_RESULT = 42;

function doStuff(options: Options): number {
  const { a, b, c, values } = options;

  if (!a || !b || !c) {
    return DEFAULT_RESULT;
  }

  return values.d + values.e + values.f + values.g;
}
`,
      }, 'Refactor doStuff to reduce complexity');

      const { createCommit } = await import('../../src/domain/commit.js');
      const commit = createCommit({
        id: 'test-commit-refactor-1',
        repoId,
        sha,
        message: 'Refactor doStuff to reduce complexity',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 15,
          linesDeleted: 10,
          affectedFiles: ['src/legacy.ts'],
        },
      });
      await ctx.repos.commits.save(commit);

      ctx.llm.setDefaultResponse(`SUMMARY:
Excellent refactoring that reduces technical debt by flattening nested conditionals, using an options object instead of many parameters, and naming the magic number.

DEBT_LEVEL:
none

ISSUES:
- None identified

DEBT_ADDED:
- None

DEBT_REMOVED:
- Replaced 7 parameters with structured options object
- Flattened 3 levels of nesting to early return pattern
- Named magic number with DEFAULT_RESULT constant

RECOMMENDATIONS:
- Consider adding JSDoc comments for the Options interface

HOTSPOTS:
- None

CONFIDENCE: 0.95`);

      const agent = new TechnicalDebtAgent();
      const result = await agent.runOnCommit('test-commit-refactor-1', ctx.agentContext(repoId));

      // Summary should indicate debt reduction
      assert.ok(
        result.result.summary.includes('refactor') || result.result.summary.includes('debt'),
        'Summary should mention refactoring or debt reduction'
      );
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'debt-test-repo-error';
      await createTestRepo(ctx, repoId);

      const agent = new TechnicalDebtAgent();

      await assert.rejects(
        () => agent.runOnCommit('non-existent-commit', ctx.agentContext(repoId)),
        /Commit not found/
      );
    });
  });

  describe('confidence levels', () => {
    it('reflects confidence from LLM response', async () => {
      const repoId = 'debt-test-confidence';
      await createTestRepo(ctx, repoId);

      const sha = await addCommit(ctx, repoId, {
        'src/test.ts': 'export const x = 1;',
      }, 'Simple change');

      const { createCommit } = await import('../../src/domain/commit.js');
      const commit = createCommit({
        id: 'test-commit-conf-1',
        repoId,
        sha,
        message: 'Simple change',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 1,
          linesDeleted: 0,
          affectedFiles: ['src/test.ts'],
        },
      });
      await ctx.repos.commits.save(commit);

      ctx.llm.setDefaultResponse(`SUMMARY:
Simple change with uncertain implications.

DEBT_LEVEL:
low

ISSUES:
- None

DEBT_ADDED:
- None

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- None

HOTSPOTS:
- None

CONFIDENCE: 0.45`);

      const agent = new TechnicalDebtAgent();
      const result = await agent.runOnCommit('test-commit-conf-1', ctx.agentContext(repoId));

      assert.strictEqual(result.result.confidence, 0.45, 'Should parse confidence from response');
    });
  });
});
