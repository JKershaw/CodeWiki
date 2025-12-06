/**
 * Integration tests for ConsistencyAgent.
 * Tests the agent that detects inconsistencies across wiki pages.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { ConsistencyAgent } from '../../src/agents/meta/consistency-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { consistencyAgentResponses } from '../fixtures/agent-responses.js';

describe('ConsistencyAgent', () => {
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
      const repoId = 'consistency-few-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create only 3 pages (below minimum of 5)
      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nProject overview.' },
        { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nHow to set up.' },
        { path: 'api/reference', title: 'API Reference', content: '# API\n\nAPI docs.' },
      ]);

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should indicate not enough pages
      assert.ok(
        result.result.summary.toLowerCase().includes('not enough') ||
        result.result.summary.toLowerCase().includes('need'),
        'Should indicate not enough pages for analysis'
      );

      // Should not incur LLM cost
      assert.strictEqual(result.costUsd, 0, 'Should not make LLM call for too few pages');
    });

    it('detects broken links between pages', async () => {
      const repoId = 'consistency-broken-links';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Broken Links Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with broken links
      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview', links: ['guides/setup', 'nonexistent/page'] },
        { path: 'guides/setup', title: 'Setup', content: '# Setup', links: ['overview'] },
        { path: 'guides/deploy', title: 'Deploy', content: '# Deploy', links: ['does-not-exist'] },
        { path: 'api/reference', title: 'API', content: '# API', links: [] },
        { path: 'architecture/main', title: 'Architecture', content: '# Architecture', links: [] },
      ]);

      ctx.llm.setDefaultResponse(consistencyAgentResponses.terminologyInconsistencies());

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should find broken link issues
      const brokenLinkFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('non-existent') ||
        f.description.toLowerCase().includes('broken') ||
        f.type.toLowerCase().includes('consistency')
      );
      assert.ok(brokenLinkFinding, 'Should identify broken links');

      // Should track LLM cost
      assert.ok(result.costUsd > 0, 'Should incur LLM cost for analysis');
    });

    it('detects terminology inconsistencies', async () => {
      const repoId = 'consistency-terminology';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Terminology Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with inconsistent terminology
      await createWikiPages(wiki.id, [
        {
          path: 'architecture/overview',
          title: 'Architecture Overview',
          content: '# Architecture\n\nThe system uses Services for business logic.',
        },
        {
          path: 'guides/api',
          title: 'API Guide',
          content: '# API Guide\n\nProviders handle all API requests.',
        },
        {
          path: 'guides/setup',
          title: 'Setup Guide',
          content: '# Setup\n\nConfigure ServiceProviders in the config file.',
        },
        {
          path: 'patterns/overview',
          title: 'Patterns',
          content: '# Patterns\n\nWe use dependency injection with Services.',
        },
        {
          path: 'api/reference',
          title: 'API Reference',
          content: '# API\n\nEndpoint handlers are defined in Providers.',
        },
      ]);

      ctx.llm.setDefaultResponse(consistencyAgentResponses.terminologyInconsistencies());

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should find terminology issues
      const terminologyFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('terminology') ||
        f.description.toLowerCase().includes('service') ||
        f.description.toLowerCase().includes('provider')
      );
      assert.ok(terminologyFinding, 'Should identify terminology inconsistencies');
    });

    it('detects contradictions between pages', async () => {
      const repoId = 'consistency-contradictions';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Contradiction Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with contradictory information
      await createWikiPages(wiki.id, [
        {
          path: 'architecture/database',
          title: 'Database Architecture',
          content: '# Database\n\nThe application requires PostgreSQL 14+.',
        },
        {
          path: 'guides/deployment',
          title: 'Deployment Guide',
          content: '# Deployment\n\nBy default, the application uses SQLite for storage.',
        },
        {
          path: 'overview',
          title: 'Overview',
          content: '# Overview\n\nProject overview.',
        },
        {
          path: 'guides/setup',
          title: 'Setup',
          content: '# Setup\n\nInstall PostgreSQL before running.',
        },
        {
          path: 'api/reference',
          title: 'API',
          content: '# API Reference\n\nAPI documentation.',
        },
      ]);

      ctx.llm.setDefaultResponse(consistencyAgentResponses.contradictionsDetected());

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should find contradiction
      const contradictionFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('contradiction') ||
        f.description.toLowerCase().includes('postgresql') ||
        f.description.toLowerCase().includes('sqlite')
      );
      assert.ok(contradictionFinding, 'Should identify contradictions');

      // Contradictions should be high importance
      assert.ok(
        contradictionFinding?.importance === 'high',
        'Contradictions should be high importance'
      );
    });

    it('detects duplicate content between pages', async () => {
      const repoId = 'consistency-duplicates';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Duplicate Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with duplicate content
      const sharedContent = 'This is the shared content that appears in multiple pages. '.repeat(20);

      await createWikiPages(wiki.id, [
        {
          path: 'guides/setup',
          title: 'Setup Guide',
          content: `# Setup Guide\n\n${sharedContent}`,
        },
        {
          path: 'guides/installation',
          title: 'Installation Guide',
          content: `# Installation Guide\n\n${sharedContent}`,
        },
        {
          path: 'overview',
          title: 'Overview',
          content: '# Overview\n\nUnique content here.',
        },
        {
          path: 'api/reference',
          title: 'API Reference',
          content: '# API\n\nAPI documentation.',
        },
        {
          path: 'architecture/main',
          title: 'Architecture',
          content: '# Architecture\n\nArchitecture docs.',
        },
      ]);

      ctx.llm.setDefaultResponse(consistencyAgentResponses.consistentWiki());

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should detect similar content (quick check without LLM)
      const duplicateFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('similar') ||
        f.description.toLowerCase().includes('duplicate') ||
        f.description.toLowerCase().includes('merging')
      );
      // Note: This test relies on the quick check for similar content
      // The mock LLM returns no issues, but the quick check should find duplicates
      assert.ok(duplicateFinding, 'Should identify duplicate/similar content');
    });

    it('reports consistent wiki when no issues found', async () => {
      const repoId = 'consistency-healthy';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Healthy Wiki',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create well-organized, consistent pages
      await createWikiPages(wiki.id, [
        {
          path: 'overview',
          title: 'Project Overview',
          content: '# Project Overview\n\nThe project uses Services for business logic.',
          links: ['architecture/services'],
        },
        {
          path: 'architecture/services',
          title: 'Service Architecture',
          content: '# Services\n\nServices encapsulate business logic.',
          links: ['overview'],
        },
        {
          path: 'guides/setup',
          title: 'Setup Guide',
          content: '# Setup\n\nHow to set up the project.',
          links: ['overview'],
        },
        {
          path: 'api/reference',
          title: 'API Reference',
          content: '# API Reference\n\nServices expose REST endpoints.',
          links: ['architecture/services'],
        },
        {
          path: 'guides/testing',
          title: 'Testing Guide',
          content: '# Testing\n\nHow to test Services.',
          links: ['architecture/services'],
        },
      ]);

      ctx.llm.setDefaultResponse(consistencyAgentResponses.consistentWiki());

      const agent = new ConsistencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Summary should indicate consistency
      assert.ok(
        result.result.summary.toLowerCase().includes('consistent') ||
        result.result.summary.includes('0 issue') ||
        result.result.findings.length === 0,
        'Should indicate wiki is consistent'
      );

      // Should not create auto-fix updates
      assert.strictEqual(result.updates.length, 0, 'Consistency agent should not auto-fix');
    });

    it('throws error when trying to run on commits', async () => {
      const agent = new ConsistencyAgent();
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
      const agent = new ConsistencyAgent();
      assert.strictEqual(agent.type, 'consistency', 'Agent type should be consistency');
    });

    it('can handle wiki targets', () => {
      const agent = new ConsistencyAgent();
      assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
    });

    it('cannot handle commit targets', () => {
      const agent = new ConsistencyAgent();
      assert.ok(!agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should not handle commit targets');
    });
  });
});
