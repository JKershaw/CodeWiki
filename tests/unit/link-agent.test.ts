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

  describe('merging links into existing Related Pages section', () => {
    it('should merge new links into existing Related Pages section', async () => {
      const repoId = 'link-agent-merge-test-1';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page that already has a Related Pages section
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await ctx.repos.wikiPages.save({
        id: 'page-has-related',
        wikiId: wiki.id,
        path: 'has-related',
        title: 'Page With Related',
        content: `# Page With Related

Some content here.

## Related Pages

- [Target 1](target-1) - Existing link`,
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: ['target-1'],
        backlinks: [],
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      // Create target pages
      await createWikiPages(wiki.id, [
        { path: 'target-1', title: 'Target 1', content: '# Target 1\n\nContent.' },
        { path: 'target-2', title: 'Target 2', content: '# Target 2\n\nContent.' },
        { path: 'new-target', title: 'New Target', content: '# New Target\n\nNew content.' },
      ]);

      // Mock LLM to suggest a NEW link (not the existing one)
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'has-related', target: 'target-2', strength: 'strong', reason: 'Should add this new link' },
        { source: 'has-related', target: 'new-target', strength: 'medium', reason: 'Another new link' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should have an update for the page with existing Related Pages
      const update = result.updates.find(u => u.path === 'has-related');
      assert.ok(update, 'Should generate update for page with existing Related Pages section');

      // The links array should include ONLY the new links (not duplicating existing)
      assert.ok(update.links, 'Update should have links array');
      assert.ok(update.links!.includes('target-2'), 'Should include new link target-2');
      assert.ok(update.links!.includes('new-target'), 'Should include new link new-target');
      // Should NOT include target-1 since it already exists
      assert.ok(!update.links!.includes('target-1'), 'Should not include already-existing link');
    });

    it('should not generate update if all suggested links already exist in Related Pages', async () => {
      const repoId = 'link-agent-merge-test-2';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page that already has all the links we'll suggest
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await ctx.repos.wikiPages.save({
        id: 'page-fully-linked',
        wikiId: wiki.id,
        path: 'fully-linked',
        title: 'Fully Linked',
        content: `# Fully Linked

Content.

## Related Pages

- [Target A](target-a) - Link A
- [Target B](target-b) - Link B`,
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: ['target-a', 'target-b'],
        backlinks: [],
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      // Create target pages
      await createWikiPages(wiki.id, [
        { path: 'target-a', title: 'Target A', content: '# Target A\n\nContent.' },
        { path: 'target-b', title: 'Target B', content: '# Target B\n\nContent.' },
      ]);

      // Mock LLM to suggest links that already exist
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'fully-linked', target: 'target-a', strength: 'strong', reason: 'Already exists' },
        { source: 'fully-linked', target: 'target-b', strength: 'medium', reason: 'Already exists' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should NOT have an update since all suggested links already exist
      const update = result.updates.find(u => u.path === 'fully-linked');
      assert.ok(!update, 'Should not generate update when all suggested links already exist');
    });
  });

  describe('link target validation', () => {
    it('should only include links to pages that actually exist', async () => {
      const repoId = 'link-agent-validate-test-1';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create source page and only ONE target page
      await createWikiPages(wiki.id, [
        { path: 'source', title: 'Source Page', content: '# Source\n\nSome content.' },
        { path: 'real-target', title: 'Real Target', content: '# Real Target\n\nExists.' },
      ]);

      // Mock LLM to suggest links to both existing AND non-existing pages
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'source', target: 'real-target', strength: 'strong', reason: 'This page exists' },
        { source: 'source', target: 'fake-target', strength: 'strong', reason: 'This page does NOT exist' },
        { source: 'source', target: 'another/fake', strength: 'medium', reason: 'Also does not exist' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      const update = result.updates.find(u => u.path === 'source');
      assert.ok(update, 'Should have update for source page');
      assert.ok(update.links, 'Update should have links array');

      // Should ONLY include the real target, not the fake ones
      assert.ok(update.links!.includes('real-target'), 'Should include existing page');
      assert.ok(!update.links!.includes('fake-target'), 'Should NOT include non-existing page');
      assert.ok(!update.links!.includes('another/fake'), 'Should NOT include non-existing page');
      assert.strictEqual(update.links!.length, 1, 'Should only have 1 valid link');
    });

    it('should not generate update if all suggested targets are invalid', async () => {
      const repoId = 'link-agent-validate-test-2';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create only the source page
      await createWikiPages(wiki.id, [
        { path: 'lonely-source', title: 'Lonely Source', content: '# Lonely\n\nNo valid targets.' },
        { path: 'other-page', title: 'Other Page', content: '# Other\n\nAnother page.' },
      ]);

      // Mock LLM to suggest links to non-existing pages
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'lonely-source', target: 'nonexistent-1', strength: 'strong', reason: 'Does not exist' },
        { source: 'lonely-source', target: 'nonexistent-2', strength: 'medium', reason: 'Does not exist either' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should NOT have an update since no valid targets
      const update = result.updates.find(u => u.path === 'lonely-source');
      assert.ok(!update, 'Should not generate update when all suggested targets are invalid');
    });
  });

  describe('batch size and coverage', () => {
    it('should process up to 20 pages per run (not just 10)', async () => {
      const repoId = 'link-agent-batch-test-1';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create 15 pages without links - all should be analyzed
      const pages = [];
      for (let i = 0; i < 15; i++) {
        pages.push({
          path: `page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nContent for page ${i}.`,
        });
      }
      await createWikiPages(wiki.id, pages);

      // Mock LLM to suggest links for all pages
      const suggestions = pages.slice(0, 14).map((p, i) => ({
        source: p.path,
        target: `page-${i + 1}`,
        strength: 'medium',
        reason: 'Sequential relationship',
      }));
      ctx.llm.setDefaultResponse(linkSuggestionResponse(suggestions));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should analyze more than 10 pages
      // The summary should mention analyzing 15 pages (or at least > 10)
      assert.ok(
        result.result.summary.includes('15 pages') ||
        result.result.summary.includes('14 pages') ||
        result.result.summary.includes('13 pages') ||
        result.result.summary.includes('12 pages') ||
        result.result.summary.includes('11 pages'),
        `Should analyze more than 10 pages. Got: ${result.result.summary}`
      );

      // Should have generated updates for multiple pages
      assert.ok(result.updates.length >= 10, `Should have updates for many pages. Got: ${result.updates.length}`);
    });

    it('should re-analyze pages when many new pages are created', async () => {
      const repoId = 'link-agent-reanalyze-many';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create an old page with links
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
      await ctx.repos.wikiPages.save({
        id: 'page-original',
        wikiId: wiki.id,
        path: 'original',
        title: 'Original Page',
        content: '# Original\n\nThe first page.',
        confidence: 0.8,
        sourceCommits: ['commit-1'],
        sourceAgentRunIds: [],
        links: ['some-old-link'],
        backlinks: [],
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      // Create 5 new pages
      const newDate = new Date();
      for (let i = 0; i < 5; i++) {
        await ctx.repos.wikiPages.save({
          id: `page-new-${i}`,
          wikiId: wiki.id,
          path: `new-${i}`,
          title: `New Page ${i}`,
          content: `# New Page ${i}\n\nNew content.`,
          confidence: 0.8,
          sourceCommits: ['commit-2'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: newDate,
          updatedAt: newDate,
        });
      }

      // Mock LLM to suggest links from original to new pages
      ctx.llm.setDefaultResponse(linkSuggestionResponse([
        { source: 'original', target: 'new-0', strength: 'strong', reason: 'Related to new content' },
        { source: 'original', target: 'new-1', strength: 'medium', reason: 'Also related' },
        { source: 'new-0', target: 'original', strength: 'medium', reason: 'References original' },
      ]));

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // The original page should be re-analyzed and get new links
      const originalUpdate = result.updates.find(u => u.path === 'original');
      assert.ok(originalUpdate, 'Original page should be re-analyzed when new pages exist');
      assert.ok(originalUpdate.links?.includes('new-0'), 'Should link to new page');
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
