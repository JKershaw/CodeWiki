/**
 * Unit tests for LinkAgent.
 * Tests that the agent properly populates the links array in WikiPageUpdate.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createWikiTarget } from '../../src/domain/work-target.js';

describe('LinkAgent', () => {
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
   * Mock LLM response that suggests links between pages.
   * Uses the simplified format: source -> target | strength | description
   */
  function linkSuggestionResponse(suggestions: Array<{ source: string; target: string; strength: string; reason: string }>) {
    const lines = suggestions.map(s =>
      `- ${s.source} -> ${s.target} | ${s.strength} | ${s.reason}`
    ).join('\n');

    return `LINK_SUGGESTIONS:
${lines}

CONFIDENCE: 0.85`;
  }

  describe('runOnWiki', () => {
    it('should populate links array in WikiPageUpdate', async () => {
      const repoId = 'link-agent-test-1';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages without links
      await createWikiPages(wiki.id, [
        {
          path: 'overview',
          title: 'Project Overview',
          content: '# Project Overview\n\nThis is the main project overview.',
        },
        {
          path: 'architecture/design',
          title: 'Architecture Design',
          content: '# Architecture Design\n\nThe system architecture.',
        },
        {
          path: 'guides/setup',
          title: 'Setup Guide',
          content: '# Setup Guide\n\nHow to set up the project.',
        },
      ]);

      // Mock LLM to suggest links
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'overview', target: 'architecture/design', strength: 'strong', reason: 'Overview references architecture' },
        { source: 'overview', target: 'guides/setup', strength: 'medium', reason: 'Overview should link to setup' },
        { source: 'architecture/design', target: 'overview', strength: 'medium', reason: 'Architecture relates to overview' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should have updates with links populated
      assert.ok(result.updates.length > 0, 'Should generate updates');

      // Find the update for the overview page
      const overviewUpdate = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewUpdate, 'Should have update for overview page');

      // Key assertion: links array should be populated
      assert.ok(overviewUpdate.links, 'Update should have links array');
      assert.ok(overviewUpdate.links!.length > 0, 'Links array should not be empty');
      assert.ok(
        overviewUpdate.links!.includes('architecture/design') || overviewUpdate.links!.includes('guides/setup'),
        'Links should include suggested targets'
      );
    });

    it('should include all suggested links for a page in the links array', async () => {
      const repoId = 'link-agent-test-2';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages
      await createWikiPages(wiki.id, [
        { path: 'main', title: 'Main Page', content: '# Main\n\nMain content.' },
        { path: 'target-1', title: 'Target 1', content: '# Target 1\n\nContent.' },
        { path: 'target-2', title: 'Target 2', content: '# Target 2\n\nContent.' },
        { path: 'target-3', title: 'Target 3', content: '# Target 3\n\nContent.' },
      ]);

      // Mock LLM to suggest multiple links from main page
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'main', target: 'target-1', strength: 'strong', reason: 'Related content' },
        { source: 'main', target: 'target-2', strength: 'medium', reason: 'Also related' },
        { source: 'main', target: 'target-3', strength: 'weak', reason: 'Loosely related' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Find update for main page
      const mainUpdate = result.updates.find(u => u.path === 'main');
      assert.ok(mainUpdate, 'Should have update for main page');
      assert.ok(mainUpdate.links, 'Update should have links array');

      // Should include all three suggested links
      assert.strictEqual(mainUpdate.links!.length, 3, 'Should have 3 links');
      assert.ok(mainUpdate.links!.includes('target-1'), 'Should include target-1');
      assert.ok(mainUpdate.links!.includes('target-2'), 'Should include target-2');
      assert.ok(mainUpdate.links!.includes('target-3'), 'Should include target-3');
    });

    it('should re-analyze pages with links when new pages are created', async () => {
      const repoId = 'link-agent-test-3';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create an "old" page that was updated in the past and has links
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await ctx.repos.wikiPages.save({
        id: 'page-old-with-links',
        wikiId: wiki.id,
        path: 'old-with-links',
        title: 'Old Page With Links',
        content: '# Old Page\n\nHas existing links but might need more.',
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: ['some/existing/page'],  // Has links
        backlinks: [],
        createdAt: oldDate,
        updatedAt: oldDate,  // Updated in the past
      });

      // Create a "new" page that was just created
      await ctx.repos.wikiPages.save({
        id: 'page-new-page',
        wikiId: wiki.id,
        path: 'new-page',
        title: 'New Page',
        content: '# New Page\n\nJust created, might be relevant to old page.',
        confidence: 0.8,
        sourceCommits: ['commit-2'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),  // Just created
      });

      // Also create the existing link target
      await ctx.repos.wikiPages.save({
        id: 'page-some-existing-page',
        wikiId: wiki.id,
        path: 'some/existing/page',
        title: 'Existing Page',
        content: '# Existing\n\nExisting content.',
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      // Mock LLM to suggest a link from old page to new page
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'old-with-links', target: 'new-page', strength: 'strong', reason: 'Old page should link to newly created page' },
        { source: 'new-page', target: 'old-with-links', strength: 'medium', reason: 'New page references old content' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should have update for old page that already had links (because new pages exist)
      const oldPageUpdate = result.updates.find(u => u.path === 'old-with-links');
      assert.ok(oldPageUpdate, 'Should re-analyze old page when newer pages exist');
      assert.ok(oldPageUpdate.links?.includes('new-page'), 'Should add link to new page');
    });

    it('should not re-analyze recently updated pages with links', async () => {
      const repoId = 'link-agent-test-3b';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages all updated at the same time
      const now = new Date();
      await ctx.repos.wikiPages.save({
        id: 'page-has-recent-links',
        wikiId: wiki.id,
        path: 'has-recent-links',
        title: 'Page With Recent Links',
        content: '# Has Links\n\nRecently analyzed.',
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: ['other-page'],  // Has links
        backlinks: [],
        createdAt: now,
        updatedAt: now,  // Just updated
      });

      await ctx.repos.wikiPages.save({
        id: 'page-other-page',
        wikiId: wiki.id,
        path: 'other-page',
        title: 'Other Page',
        content: '# Other\n\nOther content.',
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: now,
        updatedAt: now,
      });

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Page with recent links should not be re-analyzed (no newer pages exist)
      const hasRecentLinksUpdate = result.updates.find(u => u.path === 'has-recent-links');
      assert.ok(!hasRecentLinksUpdate, 'Should not re-analyze page with recent links when no newer pages exist');
    });

    it('should skip analysis when not enough pages', async () => {
      const repoId = 'link-agent-test-4';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create only 1 page
      await createWikiPages(wiki.id, [
        { path: 'single', title: 'Single Page', content: '# Single\n\nOnly one page.' },
      ]);

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should skip analysis
      assert.strictEqual(result.updates.length, 0, 'Should not generate updates with too few pages');
      assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost');
      assert.ok(
        result.result.summary.toLowerCase().includes('not enough'),
        'Summary should indicate not enough pages'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new LinkAgent();
      assert.strictEqual(agent.type, 'link', 'Agent type should be link');
    });

    it('can handle wiki targets', () => {
      const agent = new LinkAgent();
      assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
    });

    it('cannot handle commit targets', () => {
      const agent = new LinkAgent();
      assert.ok(!agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should not handle commit targets');
    });
  });
});
