/**
 * Integration tests for file coverage calculation using tracked fields.
 * Tests that getWorkSummary correctly calculates coverage using:
 * - filesAccessed: Files read by agents
 * - filesReferenced: Files mentioned in content
 * - targetPaths: Work item targets (files or directories)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { DefaultOrchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('File Coverage Calculation with Tracked Fields', () => {
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

  describe('getWorkSummary coverage calculation', () => {
    it('getWorkSummary uses tracked fields for coverage calculation', async () => {
      const repoId = 'executor-coverage-tracked';
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const main = () => {}',
        'src/utils.ts': 'export const helper = () => {}',
        'src/config.ts': 'export const config = {}',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create wiki pages with file tracking fields
      const page1: WikiPage = {
        id: uuid(),
        wikiId: wiki.id,
        path: 'index-docs',
        title: 'Index Documentation',
        content: '# Index\n\nDocuments src/index.ts',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesAccessed: ['src/index.ts'],
        filesReferenced: ['src/index.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page1);

      const page2: WikiPage = {
        id: uuid(),
        wikiId: wiki.id,
        path: 'utils-docs',
        title: 'Utils Documentation',
        content: '# Utils\n\nDocuments src/utils.ts',
        confidence: 0.75,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesReferenced: ['src/utils.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page2);

      // Create orchestrator with repoAccessFactory for file coverage
      const orchestrator = new DefaultOrchestrator(
        ctx.repos,
        ctx.llm,
        { useLLM: false },
        ctx.repoAccessFactory
      );

      // Get work summary which includes file coverage
      const summary = await orchestrator.getWorkSummary(repoId, wiki.id);

      // Two of three source files are tracked
      // src/index.ts - via filesAccessed and filesReferenced
      // src/utils.ts - via filesReferenced
      // src/config.ts - not tracked
      assert.ok(summary.totalSourceFiles >= 3, 'Should have at least 3 source files');
      assert.ok(summary.documentedFiles >= 2, 'Should have at least 2 documented files');

      // Coverage should be approximately 66.67% (2/3 files)
      const expectedCoverage = (2 / 3) * 100;
      assert.ok(
        Math.abs(summary.fileDocCoverage - expectedCoverage) < 1,
        `Coverage should be ~${expectedCoverage.toFixed(1)}%, got ${summary.fileDocCoverage.toFixed(1)}%`
      );
    });

    it('directory targetPaths do NOT expand to cover all files (prevents coverage spike)', async () => {
      const repoId = 'executor-dir-coverage';
      await createTestRepo(ctx, repoId, {
        'src/services/auth.ts': 'export const login = () => {}',
        'src/services/api.ts': 'export const fetch = () => {}',
        'src/other.ts': 'export const other = () => {}',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page that targets a directory
      // This simulates what happens when codebase-explorer explores a directory
      const page: WikiPage = {
        id: uuid(),
        wikiId: wiki.id,
        path: 'services-docs',
        title: 'Services Documentation',
        content: '# Services\n\nDocuments the services directory',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        targetPaths: ['src/services/'],  // Directory path - should NOT expand
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);

      const orchestrator = new DefaultOrchestrator(
        ctx.repos,
        ctx.llm,
        { useLLM: false },
        ctx.repoAccessFactory
      );

      const summary = await orchestrator.getWorkSummary(repoId, wiki.id);

      // Directory targetPaths should NOT automatically cover all files within
      // This prevents coverage from spiking to 100% when broad directories are explored
      // Coverage should only reflect filesAccessed + filesReferenced (actual documentation)
      assert.ok(summary.totalSourceFiles >= 3, 'Should have at least 3 source files');
      assert.strictEqual(summary.documentedFiles, 0, 'Directory targetPath alone should NOT cover files');
      assert.strictEqual(summary.fileDocCoverage, 0, 'Coverage should be 0% without actual file documentation');
    });

    it('coverage requires filesAccessed or filesReferenced, not just targetPaths', async () => {
      const repoId = 'executor-dir-no-slash';
      await createTestRepo(ctx, repoId, {
        'src/services/auth.ts': 'export const login = () => {}',
        'src/services/api.ts': 'export const fetch = () => {}',
        'src/other.ts': 'export const other = () => {}',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page with targetPath AND actual file tracking
      const page: WikiPage = {
        id: uuid(),
        wikiId: wiki.id,
        path: 'services-docs',
        title: 'Services Documentation',
        content: '# Services\n\nDocuments the services directory',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        targetPaths: ['src/services'],  // Work target (informational only)
        filesAccessed: ['src/services/auth.ts'],  // Actually read this file
        filesReferenced: ['src/services/api.ts'],  // Documented this file
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);

      const orchestrator = new DefaultOrchestrator(
        ctx.repos,
        ctx.llm,
        { useLLM: false },
        ctx.repoAccessFactory
      );

      const summary = await orchestrator.getWorkSummary(repoId, wiki.id);

      // Coverage should be based on actual filesAccessed + filesReferenced
      // NOT on directory expansion of targetPaths
      assert.ok(summary.totalSourceFiles >= 3, 'Should have at least 3 source files');
      assert.strictEqual(summary.documentedFiles, 2, 'Should count filesAccessed + filesReferenced');

      // Coverage should be approximately 66.67% (2/3 files)
      const expectedCoverage = (2 / 3) * 100;
      assert.ok(
        Math.abs(summary.fileDocCoverage - expectedCoverage) < 1,
        `Coverage should be ~${expectedCoverage.toFixed(1)}%, got ${summary.fileDocCoverage.toFixed(1)}%`
      );
    });
  });
});
