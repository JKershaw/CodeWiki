/**
 * Unit tests for link agent scheduling in orchestrator strategies.
 * Verifies that link agent is scheduled appropriately based on unlinked pages.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { metaAgentsStrategy } from '../../src/agents/orchestrator/strategies.js';
import type { StrategyContext } from '../../src/agents/orchestrator/strategies.js';
import { v4 as uuid } from 'uuid';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';

describe('Link Agent Scheduling', () => {
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
   * Helper to create wiki pages for testing.
   */
  async function createWikiPages(
    wikiId: string,
    pages: Array<{ path: string; title: string; content: string; links?: string[] }>
  ): Promise<void> {
    for (const page of pages) {
      await ctx.repos.wikiPages.save({
        id: `page-${page.path.replace(/\//g, '-')}`,
        wikiId,
        path: page.path,
        title: page.title,
        content: page.content,
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: page.links ?? [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  /**
   * Helper to create a strategy context.
   */
  function createStrategyContext(
    repoId: string,
    wikiId: string,
    existingWorkKeys: Set<string> = new Set()
  ): StrategyContext {
    return {
      repoId,
      wikiId,
      repos: ctx.repos,
      contextGatherer: new ContextGatherer(ctx.repos),
      existingWorkKeys,
      iterationPhase: 'mid',
    };
  }

  describe('metaAgentsStrategy', () => {
    it('schedules link agent when pages have no links', async () => {
      const repoId = 'link-sched-1';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages without links
      await createWikiPages(wiki.id, [
        { path: 'page1', title: 'Page 1', content: '# Page 1', links: [] },
        { path: 'page2', title: 'Page 2', content: '# Page 2', links: [] },
        { path: 'page3', title: 'Page 3', content: '# Page 3', links: [] },
      ]);

      const strategyCtx = createStrategyContext(repoId, wiki.id);
      const result = await metaAgentsStrategy(strategyCtx, 10);

      const linkWorkItem = result.workItems.find(w => w.agentType === 'link');
      assert.ok(linkWorkItem, 'Should schedule link agent when pages have no links');
    });

    it('does not schedule link agent when all pages have links', async () => {
      const repoId = 'link-sched-2';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages WITH links
      await createWikiPages(wiki.id, [
        { path: 'page1', title: 'Page 1', content: '# Page 1', links: ['page2'] },
        { path: 'page2', title: 'Page 2', content: '# Page 2', links: ['page1'] },
      ]);

      const strategyCtx = createStrategyContext(repoId, wiki.id);
      const result = await metaAgentsStrategy(strategyCtx, 10);

      const linkWorkItem = result.workItems.find(w => w.agentType === 'link');
      assert.ok(!linkWorkItem, 'Should not schedule link agent when all pages have links');
    });

    it('schedules link agent regardless of recent runs (no cooldown)', async () => {
      const repoId = 'link-sched-3';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create 10 pages, 2 without links (20% unlinked - above 15% threshold)
      await createWikiPages(wiki.id, [
        { path: 'page1', title: 'Page 1', content: '# Page 1', links: ['page2'] },
        { path: 'page2', title: 'Page 2', content: '# Page 2', links: ['page1'] },
        { path: 'page3', title: 'Page 3', content: '# Page 3', links: ['page1'] },
        { path: 'page4', title: 'Page 4', content: '# Page 4', links: ['page1'] },
        { path: 'page5', title: 'Page 5', content: '# Page 5', links: ['page1'] },
        { path: 'page6', title: 'Page 6', content: '# Page 6', links: ['page1'] },
        { path: 'page7', title: 'Page 7', content: '# Page 7', links: ['page1'] },
        { path: 'page8', title: 'Page 8', content: '# Page 8', links: ['page1'] },
        { path: 'page9', title: 'Page 9', content: '# Page 9', links: [] },  // no links
        { path: 'page10', title: 'Page 10', content: '# Page 10', links: [] },  // no links
      ]);

      // Record a link agent run (would have been in cooldown window before)
      await ctx.repos.agentRuns.save({
        id: uuid(),
        repoId,
        wikiId: wiki.id,
        agentType: 'link',
        status: 'completed',
        startedAt: new Date(Date.now() - 1000),
        completedAt: new Date(),
        durationMs: 1000,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
        toolCalls: [],
      });

      const strategyCtx = createStrategyContext(repoId, wiki.id);
      const result = await metaAgentsStrategy(strategyCtx, 10);

      const linkWorkItem = result.workItems.find(w => w.agentType === 'link');
      // Link agent has no cooldown - should schedule when pages need linking
      assert.ok(linkWorkItem, 'Should schedule link agent even with recent run (no cooldown)');
    });

    it('schedules link agent when high percentage of pages are unlinked', async () => {
      const repoId = 'link-sched-4';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create 10 pages, 8 without links (80% unlinked)
      const pages = [];
      for (let i = 0; i < 10; i++) {
        pages.push({
          path: `page${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}`,
          links: i < 2 ? ['other'] : [], // Only first 2 have links
        });
      }
      await createWikiPages(wiki.id, pages);

      const strategyCtx = createStrategyContext(repoId, wiki.id);
      const result = await metaAgentsStrategy(strategyCtx, 10);

      const linkWorkItem = result.workItems.find(w => w.agentType === 'link');
      // With 80% unlinked (above 15% threshold), should schedule link agent
      assert.ok(linkWorkItem, 'Should schedule link agent when many pages are unlinked');
    });
  });
});
