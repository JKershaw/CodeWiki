/**
 * Integration tests for StructureAgent.
 * Tests the agent that analyzes wiki organization and suggests improvements.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { StructureAgent } from '../../src/agents/meta/structure-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { structureAgentResponses } from '../fixtures/agent-responses.js';

describe('StructureAgent', () => {
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
        sourceCommits: [],
        links: page.links ?? [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  describe('runOnWiki', () => {
    it('skips analysis when wiki has too few pages', async () => {
      const repoId = 'structure-few-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create only 2 pages (below minimum threshold)
      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nProject overview.' },
        { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nHow to set up.' },
      ]);

      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should indicate not enough pages
      assert.ok(
        result.result.summary.toLowerCase().includes('not enough') ||
        result.result.summary.toLowerCase().includes('few'),
        'Should indicate not enough pages for analysis'
      );

      // Should not incur LLM cost
      assert.strictEqual(result.costUsd, 0, 'Should not make LLM call for too few pages');

      // Should have high confidence
      assert.ok(result.result.confidence >= 0.9, 'Should have high confidence for skipped analysis');
    });

    it('detects structural issues like long pages', async () => {
      const repoId = 'structure-long-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Structure Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a very long page (over 5000 chars)
      const longContent = '# Very Long Page\n\n' + 'This is content. '.repeat(500);

      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nShort overview.' },
        { path: 'architecture/main', title: 'Architecture Main', content: longContent },
        { path: 'guides/setup', title: 'Setup', content: '# Setup\n\nSetup guide.' },
        { path: 'guides/deployment', title: 'Deployment', content: '# Deployment\n\nDeploy guide.' },
      ]);

      ctx.llm.setDefaultResponse(structureAgentResponses.structureImprovementsNeeded());

      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should find structural issues
      assert.ok(result.result.findings.length > 0, 'Should identify structural issues');

      // Should identify the long page issue
      const longPageFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('long') ||
        f.description.toLowerCase().includes('split') ||
        f.description.toLowerCase().includes('characters')
      );
      assert.ok(longPageFinding, 'Should identify page that is too long');

      // Should track LLM cost for analysis
      assert.ok(result.costUsd > 0, 'Should incur LLM cost for analysis');
    });

    it('detects orphaned pages with no links', async () => {
      const repoId = 'structure-orphans';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Orphan Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages including some orphans (no links in or out)
      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nMain overview.', links: ['guides/setup'] },
        { path: 'guides/setup', title: 'Setup', content: '# Setup\n\nSetup guide.', links: [] },
        { path: 'api/reference', title: 'API Reference', content: '# API\n\nAPI docs.' }, // Orphan
        { path: 'patterns/factory', title: 'Factory Pattern', content: '# Factory\n\nFactory pattern.' }, // Orphan
        { path: 'guides/testing', title: 'Testing Guide', content: '# Testing\n\nTesting guide.', links: [] },
        { path: 'architecture/overview', title: 'Architecture', content: '# Arch\n\nArchitecture.', links: [] },
      ]);

      ctx.llm.setDefaultResponse(structureAgentResponses.structureImprovementsNeeded());

      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should identify orphaned pages
      const orphanFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('orphan') ||
        f.description.toLowerCase().includes('no links')
      );
      assert.ok(orphanFinding, 'Should identify orphaned pages');
    });

    it('reports healthy structure when no issues found', async () => {
      const repoId = 'structure-healthy';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Healthy Wiki',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create well-structured pages - put multiple pages in same categories
      // to avoid "lonely category" detection
      await createWikiPages(wiki.id, [
        {
          path: 'guides/overview',
          title: 'Guides Overview - Documentation Index',
          content: '# Guides Overview\n\nThis is the guides overview with links.\n\n## Related Pages',
          links: ['guides/setup', 'guides/deployment'],
        },
        {
          path: 'guides/setup',
          title: 'Getting Started - Setup Guide',
          content: '# Setup\n\nHow to get started with the project.',
          links: ['guides/overview'],
        },
        {
          path: 'guides/deployment',
          title: 'Deployment Guide - Production Setup',
          content: '# Deployment\n\nHow to deploy the application.',
          links: ['guides/overview'],
        },
      ]);

      // Mock response for healthy structure (no suggestions)
      ctx.llm.setDefaultResponse(structureAgentResponses.healthyStructure());

      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Summary should indicate healthy structure - check that no structural issues were found
      // Note: The agent may still report a count but with 0 issues
      assert.ok(
        result.result.summary.toLowerCase().includes('healthy') ||
        result.result.findings.length === 0 ||
        result.result.summary.includes('0 structural'),
        `Should indicate healthy wiki structure, got: ${result.result.summary}`
      );

      // Should not create any updates (structure agent reports, doesn't auto-fix)
      assert.strictEqual(result.updates.length, 0, 'Structure agent should not auto-fix');
    });

    it('detects category imbalances', async () => {
      const repoId = 'structure-imbalance';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Imbalanced Wiki',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create imbalanced categories - one category has only 1 page
      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Project Overview', content: '# Overview' },
        { path: 'guides/one', title: 'Guide One', content: '# Guide 1' },
        { path: 'guides/two', title: 'Guide Two', content: '# Guide 2' },
        { path: 'guides/three', title: 'Guide Three', content: '# Guide 3' },
        { path: 'lonely/single', title: 'Single Page', content: '# Lonely' }, // Lonely category
      ]);

      ctx.llm.setDefaultResponse(structureAgentResponses.structureImprovementsNeeded());

      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should identify lonely category
      const lonelyFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('lonely') ||
        f.description.toLowerCase().includes('only 1 page') ||
        f.description.toLowerCase().includes('single')
      );
      assert.ok(lonelyFinding, 'Should identify category with only one page');
    });

    it('throws error when trying to run on commits', async () => {
      const agent = new StructureAgent();
      const agentCtx = await ctx.agentContext('any-repo');

      await assert.rejects(
        async () => agent.runOnCommit('any-commit', agentCtx),
        /does not run on commits/i,
        'Should throw error when called with commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new StructureAgent();
      assert.strictEqual(agent.type, 'structure', 'Agent type should be structure');
    });

    it('can handle wiki targets', () => {
      const agent = new StructureAgent();
      assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
    });

    it('cannot handle commit targets', () => {
      const agent = new StructureAgent();
      assert.ok(!agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should not handle commit targets');
    });
  });
});
