/**
 * Integration tests for TechnicalDebtAgent.
 * Tests the agent that identifies technical debt in commits.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { TechnicalDebtAgent } from '../../src/agents/analysis/technical-debt-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';

describe('TechnicalDebtAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    ctx.llm.reset();
  });

  describe('run', () => {
    it('identifies TODO/FIXME comments', async () => {
      const repoId = 'debt-todo-comments';

      await createTestRepo(ctx, repoId, {
        'src/utils.ts': `
export function processData(data: any) {
  return data.map((item: any) => item.value);
}
`,
      });

      // Add a commit with TODO/FIXME comments
      const commitSha = await addCommit(ctx, repoId, {
        'src/service.ts': `
export class DataService {
  // HACK: Temporary workaround for API rate limiting
  private cache: Map<string, any> = new Map();

  async fetchData(id: string) {
    // TODO: Implement proper caching strategy
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    // FIXME: Error handling is incomplete
    const data = await fetch(\`/api/data/\${id}\`);
    return data.json();
  }
}
`,
      }, 'Add data service with TODOs');

      // Store commit in repository
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add data service with TODOs',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 15,
          linesDeleted: 0,
          affectedFiles: ['src/service.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM response with TODO findings
      ctx.llm.setDefaultResponse(`SUMMARY:
This commit introduces a data service with several technical debt indicators including TODO, FIXME, and HACK comments that need attention.

DEBT_TREND:
adding_debt

FINDINGS:
- [HACK_COMMENT] [SEVERITY:medium] Temporary workaround for API rate limiting that should be properly implemented [src/service.ts]
- [INCOMPLETE_IMPLEMENTATION] [SEVERITY:medium] Caching strategy marked as TODO [src/service.ts]
- [ERROR_HANDLING] [SEVERITY:high] Error handling is incomplete as noted by FIXME [src/service.ts]

TODO_ITEMS:
- [src/service.ts:9] [TODO] Implement proper caching strategy
- [src/service.ts:3] [HACK] Temporary workaround for API rate limiting
- [src/service.ts:14] [FIXME] Error handling is incomplete

SOLID_VIOLATIONS:

REMEDIATION:
- [Priority:high] Add proper error handling with try/catch and specific error types
- [Priority:medium] Implement a proper caching strategy using a cache library or service
- [Priority:medium] Replace the rate limiting hack with a proper throttling mechanism

HOTSPOTS:
- [src/service.ts] Contains multiple TODO/FIXME comments indicating incomplete implementation

WIKI_UPDATES:
- [technical-debt/todos] [update] Track new TODO/FIXME items from data service

CONFIDENCE: 0.85`);

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify the debt trend
      assert.ok(result.result.summary.includes('debt'), 'Summary should mention debt');

      // Should have findings
      assert.ok(result.result.findings.length > 0, 'Should have findings about technical debt');

      // Should have at least one high-importance finding
      const highImportance = result.result.findings.filter(f => f.importance === 'high');
      assert.ok(highImportance.length > 0, 'Should identify high-importance issues');

      // Should create wiki updates
      assert.ok(result.updates.length > 0, 'Should create wiki updates');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('detects SOLID principle violations', async () => {
      const repoId = 'debt-solid-violations';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      // Add a commit with a "God class"
      const commitSha = await addCommit(ctx, repoId, {
        'src/god-class.ts': `
// This class does everything
export class ApplicationManager {
  private db: any;
  private cache: any;
  private users: any[] = [];
  private orders: any[] = [];

  constructor() {
    this.db = this.initDatabase();
    this.cache = this.initCache();
  }

  // Database operations
  initDatabase() { /* ... */ }
  query(sql: string) { /* ... */ }

  // Cache operations
  initCache() { /* ... */ }
  getFromCache(key: string) { /* ... */ }

  // User management
  createUser(data: any) { /* ... */ }
  getUser(id: string) { /* ... */ }

  // Order management
  createOrder(userId: string, items: any[]) { /* ... */ }
  getOrder(id: string) { /* ... */ }

  // Email operations
  sendEmail(to: string, subject: string, body: string) { /* ... */ }
}
`,
      }, 'Add application manager class');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add application manager class',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 35,
          linesDeleted: 0,
          affectedFiles: ['src/god-class.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM response with SOLID violations
      ctx.llm.setDefaultResponse(`SUMMARY:
This commit introduces an ApplicationManager class that violates multiple SOLID principles, particularly the Single Responsibility Principle. The class handles database, cache, user management, orders, and email - far too many responsibilities.

DEBT_TREND:
adding_debt

FINDINGS:
- [GOD_CLASS] [SEVERITY:critical] ApplicationManager handles 5+ different concerns [src/god-class.ts]
- [SINGLE_RESPONSIBILITY_VIOLATION] [SEVERITY:critical] Class has multiple reasons to change [src/god-class.ts]
- [TIGHT_COUPLING] [SEVERITY:high] All functionality is tightly coupled in one class [src/god-class.ts]

TODO_ITEMS:

SOLID_VIOLATIONS:
- [Single Responsibility] ApplicationManager class has at least 5 distinct responsibilities [src/god-class.ts]
- [Dependency Inversion] Class creates its own dependencies instead of accepting them via DI [src/god-class.ts]

REMEDIATION:
- [Priority:high] Split ApplicationManager into separate services
- [Priority:high] Implement dependency injection for loose coupling

HOTSPOTS:
- [src/god-class.ts] Massive god class that will be difficult to maintain

WIKI_UPDATES:
- [technical-debt/reports/${commitSha.slice(0, 8)}] [create] Detailed report on SOLID violations

CONFIDENCE: 0.92`);

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify God class
      const godClassFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('god') ||
        f.description.toLowerCase().includes('god class')
      );
      assert.ok(godClassFinding, 'Should identify God class pattern');
      assert.strictEqual(godClassFinding!.importance, 'high', 'God class should be high importance');

      // Should have high confidence for clear violations
      assert.ok(result.result.confidence >= 0.8, 'Should have high confidence for clear violations');

      // Should create wiki pages
      assert.ok(result.updates.length > 0, 'Should create wiki pages for significant findings');
    });

    it('reports neutral when commit has no debt indicators', async () => {
      const repoId = 'debt-clean-commit';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Clean Project',
      });

      // Add a clean commit
      const commitSha = await addCommit(ctx, repoId, {
        'src/clean-code.ts': `
/**
 * A well-documented utility function.
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Another clean utility with proper error handling.
 */
export function parseNumber(value: string): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(\`Invalid number: \${value}\`);
  }
  return parsed;
}
`,
      }, 'Add clean utility functions');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add clean utility functions',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 20,
          linesDeleted: 0,
          affectedFiles: ['src/clean-code.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM response for clean code
      ctx.llm.setDefaultResponse(`SUMMARY:
This commit adds well-structured utility functions with proper documentation and error handling. No significant technical debt indicators found.

DEBT_TREND:
neutral

FINDINGS:

TODO_ITEMS:

SOLID_VIOLATIONS:

REMEDIATION:

HOTSPOTS:

WIKI_UPDATES:

CONFIDENCE: 0.9`);

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should report neutral debt trend
      assert.ok(
        result.result.summary.toLowerCase().includes('no') ||
        result.result.summary.toLowerCase().includes('neutral') ||
        result.result.summary.toLowerCase().includes('clean'),
        'Summary should indicate no significant debt'
      );

      // Should have minimal or no findings
      assert.ok(result.result.findings.length <= 1, 'Should have minimal findings for clean code');

      // Should not create wiki pages for neutral commits
      assert.strictEqual(result.updates.length, 0, 'Should not create wiki pages for neutral commits');
    });

    it('detects debt reduction when refactoring', async () => {
      const repoId = 'debt-reduction';

      await createTestRepo(ctx, repoId, {
        'src/legacy.ts': `
// TODO: Refactor this mess
export function doEverything(x: any) {
  // HACK: Quick fix
  if (x === null) return null;
  if (typeof x === 'string') return x.toUpperCase();
  return x;
}
`,
      });

      // Add a refactoring commit
      const commitSha = await addCommit(ctx, repoId, {
        'src/legacy.ts': `
/**
 * Processes a string value by converting to uppercase.
 */
export function processString(value: string): string {
  return value.toUpperCase();
}

/**
 * Processes a number value by doubling it.
 */
export function processNumber(value: number): number {
  return value * 2;
}
`,
      }, 'Refactor legacy code into typed functions');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Refactor legacy code into typed functions',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 15,
          linesDeleted: 8,
          affectedFiles: ['src/legacy.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM response for refactoring
      ctx.llm.setDefaultResponse(`SUMMARY:
This commit significantly reduces technical debt by refactoring the problematic doEverything function into well-typed, single-purpose functions. Removes TODO and HACK comments.

DEBT_TREND:
reducing_debt

FINDINGS:
- [REFACTORING] [SEVERITY:low] Legacy catch-all function replaced with typed functions [src/legacy.ts]
- [DEBT_PAYDOWN] [SEVERITY:low] Removed TODO and HACK comments [src/legacy.ts]

TODO_ITEMS:

SOLID_VIOLATIONS:

REMEDIATION:

HOTSPOTS:

WIKI_UPDATES:
- [technical-debt/overview] [update] Note debt reduction from refactoring

CONFIDENCE: 0.88`);

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify debt reduction
      assert.ok(
        result.result.summary.toLowerCase().includes('reduc') ||
        result.result.summary.toLowerCase().includes('refactor'),
        'Summary should indicate debt reduction or refactoring'
      );

      // Findings should be low importance (positive changes)
      const lowImportance = result.result.findings.filter(f => f.importance === 'low');
      assert.ok(lowImportance.length > 0 || result.result.findings.length === 0,
        'Findings should be low importance for debt reduction');
    });

    it('creates appropriate wiki pages for significant findings', async () => {
      const repoId = 'debt-wiki-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/problematic.ts': `
// TODO: Critical - fix before release
// FIXME: Memory leak here
// HACK: Don't look at this
export class ProblematicClass {
  process() { /* messy code */ }
}
`,
      }, 'Add problematic code');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add problematic code',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 8,
          linesDeleted: 0,
          affectedFiles: ['src/problematic.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(`SUMMARY:
This commit introduces significant technical debt with multiple TODO, FIXME, and HACK comments indicating critical issues.

DEBT_TREND:
adding_debt

FINDINGS:
- [CRITICAL_TODO] [SEVERITY:critical] TODO marked as critical - fix before release [src/problematic.ts]
- [MEMORY_LEAK] [SEVERITY:critical] FIXME indicates memory leak [src/problematic.ts]
- [HACK_CODE] [SEVERITY:high] HACK comment indicates workaround [src/problematic.ts]

TODO_ITEMS:
- [src/problematic.ts:1] [TODO] Critical - fix before release
- [src/problematic.ts:2] [FIXME] Memory leak here
- [src/problematic.ts:3] [HACK] Don't look at this

SOLID_VIOLATIONS:

REMEDIATION:
- [Priority:high] Address the memory leak immediately
- [Priority:high] Fix critical TODO before release

HOTSPOTS:
- [src/problematic.ts] Multiple critical issues in single file

WIKI_UPDATES:
- [technical-debt/reports/${commitSha.slice(0, 8)}] [create] Detailed debt report
- [technical-debt/overview] [update] Update overview with new findings
- [technical-debt/todos] [update] Track new TODO items
- [technical-debt/hotspots] [update] Add problematic.ts as hotspot

CONFIDENCE: 0.95`);

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should create multiple wiki pages
      assert.ok(result.updates.length >= 2, 'Should create multiple wiki pages for significant findings');

      // Should create a report page
      const reportPage = result.updates.find(u => u.path.includes('reports/'));
      assert.ok(reportPage, 'Should create a detailed report page');
      assert.strictEqual(reportPage!.type, 'create', 'Report should be created');

      // Should update TODO tracking page
      const todoPage = result.updates.find(u => u.path === 'technical-debt/todos');
      assert.ok(todoPage, 'Should update TODO tracking page');

      // Should have appropriate confidence deltas
      for (const update of result.updates) {
        assert.ok(update.confidenceDelta > 0, `Update ${update.path} should have positive confidence delta`);
      }
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'debt-nonexistent';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await assert.rejects(
        async () => agent.run(createCommitTarget('nonexistent-commit-id'), agentCtx),
        /not found/i,
        'Should throw error for non-existent commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new TechnicalDebtAgent();
      assert.strictEqual(agent.type, 'technical-debt', 'Agent type should be technical-debt');
    });
  });
});
