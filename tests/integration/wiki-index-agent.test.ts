/**
 * Integration tests for WikiIndexAgent.
 * Tests the agent that creates a master navigation index for the wiki.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { WikiIndexAgent } from '../../src/agents/synthesis/wiki-index-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('WikiIndexAgent', () => {
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

  /**
   * Helper to create test wiki pages.
   */
  async function createTestPages(wikiId: string, count: number): Promise<WikiPage[]> {
    const pages: WikiPage[] = [];
    const categories = ['architecture', 'guides', 'commits', 'security'];

    for (let i = 0; i < count; i++) {
      const category = categories[i % categories.length]!;
      const page: WikiPage = {
        id: `page-${i}`,
        wikiId,
        path: `${category}/page-${i}`,
        title: `Test Page ${i}`,
        content: `# Test Page ${i}\n\nThis is test content for page ${i}.\n\n## Section 1\n\nMore content here.`,
        confidence: 0.5 + (i % 5) * 0.1, // Varies between 0.5 and 0.9
        sourceCommits: [`commit-${i}`],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);
      pages.push(page);
    }

    return pages;
  }

  describe('runOnWiki', () => {
    it('creates wiki index when wiki has 10+ pages', async () => {
      const repoId = 'wiki-index-10-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await createTestPages(wiki.id, 12);

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should create the wiki index
      assert.ok(result.updates.length > 0, 'Should create wiki index page');

      const indexUpdate = result.updates.find(u => u.path === 'navigation/wiki-index');
      assert.ok(indexUpdate, 'Should create navigation/wiki-index page');
      assert.strictEqual(indexUpdate.type, 'create');

      // Should include page count
      assert.ok(indexUpdate.content.includes('12'), 'Should mention page count');

      // Should include categories
      assert.ok(indexUpdate.content.includes('Architecture'), 'Should include Architecture category');
      assert.ok(indexUpdate.content.includes('Guides'), 'Should include Guides category');

      // Should have high confidence (no LLM, pure computation)
      assert.ok(result.result.confidence >= 0.8, `Should have high confidence, got ${result.result.confidence}`);

      // Should have no LLM cost
      assert.strictEqual(result.costUsd, 0, 'Should have no LLM cost');
    });

    it('skips when wiki has less than 10 pages', async () => {
      const repoId = 'wiki-index-few-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await createTestPages(wiki.id, 5);

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not create index
      assert.strictEqual(result.updates.length, 0, 'Should not create index for small wiki');
      assert.ok(result.result.summary.includes('need'), 'Summary should indicate more pages needed');
    });

    it('skips when wiki index already exists', async () => {
      const repoId = 'wiki-index-exists';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await createTestPages(wiki.id, 12);

      // Pre-create the index
      await ctx.repos.wikiPages.save({
        id: 'existing-index',
        wikiId: wiki.id,
        path: 'navigation/wiki-index',
        title: 'Wiki Index',
        content: '# Wiki Index\n\n*Page count at generation: 12*',
        confidence: 0.9,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should skip - index is up to date
      assert.strictEqual(result.updates.length, 0, 'Should not update when index is current');
      assert.ok(result.result.summary.includes('up-to-date'), 'Summary should indicate index is up-to-date');
    });

    it('updates index when page count changes significantly', async () => {
      const repoId = 'wiki-index-update';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await createTestPages(wiki.id, 15);

      // Pre-create the index with old page count
      await ctx.repos.wikiPages.save({
        id: 'old-index',
        wikiId: wiki.id,
        path: 'navigation/wiki-index',
        title: 'Wiki Index',
        content: '# Wiki Index\n\n*Page count at generation: 10*',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should update the index (page count changed by 5)
      assert.ok(result.updates.length > 0, 'Should update index when page count changes significantly');

      const indexUpdate = result.updates.find(u => u.path === 'navigation/wiki-index');
      assert.ok(indexUpdate, 'Should update navigation/wiki-index page');
      assert.strictEqual(indexUpdate.type, 'update');
    });

    it('organizes pages by category with proper formatting', async () => {
      const repoId = 'wiki-index-formatting';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages in specific categories
      const testPages = [
        { path: 'guides/getting-started', title: 'Getting Started', confidence: 0.8 },
        { path: 'guides/testing', title: 'Testing Guide', confidence: 0.7 },
        { path: 'architecture/overview', title: 'Architecture Overview', confidence: 0.9 },
        { path: 'architecture/cqrs', title: 'CQRS Pattern', confidence: 0.6 },
        { path: 'commits/abc123', title: 'Initial Commit', confidence: 0.5 },
        { path: 'security/auth', title: 'Authentication', confidence: 0.75 },
      ];

      for (let i = 0; i < testPages.length; i++) {
        const { path, title, confidence } = testPages[i]!;
        await ctx.repos.wikiPages.save({
          id: `custom-page-${i}`,
          wikiId: wiki.id,
          path,
          title,
          content: `# ${title}\n\nContent for ${title}.`,
          confidence,
          sourceCommits: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Add more pages to reach 10
      await createTestPages(wiki.id, 5);

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.ok(result.updates.length > 0, 'Should create index');

      const indexUpdate = result.updates[0]!;
      const content = indexUpdate.content;

      // Should have table of contents
      assert.ok(content.includes('## Table of Contents'), 'Should include Table of Contents');

      // Should have proper category headers
      assert.ok(content.includes('## Guides'), 'Should include Guides section');
      assert.ok(content.includes('## Architecture'), 'Should include Architecture section');

      // Should have confidence indicators
      assert.ok(content.includes('%'), 'Should show confidence percentages');

      // Should have links to pages
      assert.ok(content.includes('[Getting Started]'), 'Should include page links');
    });

    it('includes confidence icons based on score', async () => {
      const repoId = 'wiki-index-confidence';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with varied confidence
      const pages = [
        { confidence: 0.9, title: 'High Confidence' },
        { confidence: 0.7, title: 'Medium Confidence' },
        { confidence: 0.5, title: 'Low Confidence' },
        { confidence: 0.3, title: 'Very Low Confidence' },
      ];

      for (let i = 0; i < pages.length; i++) {
        await ctx.repos.wikiPages.save({
          id: `conf-page-${i}`,
          wikiId: wiki.id,
          path: `test/page-${i}`,
          title: pages[i]!.title,
          content: `# ${pages[i]!.title}\n\nContent.`,
          confidence: pages[i]!.confidence,
          sourceCommits: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Add more pages to reach 10
      await createTestPages(wiki.id, 7);

      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      const content = result.updates[0]!.content;

      // Should have different confidence icons
      assert.ok(content.includes('🟢'), 'Should include green icon for high confidence');
      assert.ok(content.includes('🟡'), 'Should include yellow icon for medium confidence');
      assert.ok(content.includes('🟠') || content.includes('🔴'), 'Should include orange/red icon for low confidence');
    });
  });

  describe('runOnCommit', () => {
    it('throws error when called', async () => {
      const agent = new WikiIndexAgent();
      const agentCtx = await ctx.agentContext('any-repo');

      await assert.rejects(
        async () => agent.runOnCommit('any-commit-id', agentCtx),
        /does not run on commits/,
        'Should throw error explaining agent does not run on commits'
      );
    });
  });
});
