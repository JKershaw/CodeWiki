/**
 * Integration tests for ConsolidationAgent and its handlers.
 * Tests the self-healing pipeline that processes findings from meta agents.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { ConsolidationAgent } from '../../src/agents/consolidation/consolidation-agent.js';
import { FindingHandlerRegistry } from '../../src/agents/consolidation/finding-handler-registry.js';
import { DuplicateHandler } from '../../src/agents/consolidation/handlers/duplicate-handler.js';
import { BrokenLinkHandler } from '../../src/agents/consolidation/handlers/broken-link-handler.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createFinding, type Finding, type FindingType } from '../../src/domain/finding.js';
import { consolidationAgentResponses } from '../fixtures/agent-responses.js';

describe('ConsolidationAgent', () => {
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

  /**
   * Helper to create findings for testing.
   */
  async function createTestFinding(
    wikiId: string,
    repoId: string,
    type: FindingType,
    affectedPaths: string[],
    options: {
      description?: string;
      severity?: 'low' | 'medium' | 'high';
      metadata?: Finding['metadata'];
    } = {}
  ): Promise<Finding> {
    const finding = createFinding({
      id: `finding-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      wikiId,
      repoId,
      sourceAgentRunId: 'test-agent-run',
      type,
      description: options.description ?? `Test ${type} finding`,
      affectedPaths,
      severity: options.severity ?? 'medium',
      metadata: options.metadata,
    });
    await ctx.repos.findings.save(finding);
    return finding;
  }

  describe('runOnWiki', () => {
    it('should return empty result when no findings exist', async () => {
      const repoId = 'consolidation-no-findings';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nProject overview.' },
      ]);

      const agent = new ConsolidationAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      assert.ok(
        result.result.summary.toLowerCase().includes('no findings'),
        'Should indicate no findings to consolidate'
      );
      assert.strictEqual(result.updates.length, 0, 'Should not generate updates');
      assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost');
    });

    it('should delegate to correct handler based on finding type', async () => {
      const repoId = 'consolidation-delegation';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create duplicate pages
      await createWikiPages(wiki.id, [
        { path: 'guides/setup', title: 'Setup Guide', content: '# Setup Guide\n\nHow to set up.' },
        { path: 'guides/installation', title: 'Installation', content: '# Installation\n\nHow to install.' },
      ]);

      // Create a duplicate finding
      await createTestFinding(wiki.id, repoId, 'duplicate_title', ['guides/setup', 'guides/installation'], {
        description: 'Pages have similar titles and content',
      });

      ctx.llm.setDefaultResponse(consolidationAgentResponses.duplicateMerge());

      const agent = new ConsolidationAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should have processed the finding (incurred LLM cost)
      assert.ok(result.costUsd > 0, 'Should incur LLM cost for processing');
      // The result summary should mention consolidation
      assert.ok(
        result.result.findings.some(f => f.type === 'CONSOLIDATION'),
        'Should produce consolidation finding'
      );
    });

    it('should handle unsupported finding types gracefully', async () => {
      const repoId = 'consolidation-unsupported';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      await createWikiPages(wiki.id, [
        { path: 'overview', title: 'Overview', content: '# Overview' },
      ]);

      // Create finding with unsupported type using direct save
      const finding: Finding = {
        id: 'finding-unsupported',
        wikiId: wiki.id,
        repoId,
        sourceAgentRunId: 'test-agent-run',
        type: 'low_quality' as FindingType, // This type has no handler
        description: 'Page is low quality',
        affectedPaths: ['overview'],
        severity: 'low',
        status: 'open',
        detectedAt: new Date(),
        addressedAt: null,
        addressedByAgentRunId: null,
      };
      await ctx.repos.findings.save(finding);

      // Use a custom registry without low_quality handler
      const registry = new FindingHandlerRegistry();
      registry.register(new DuplicateHandler());
      registry.register(new BrokenLinkHandler());

      const agent = new ConsolidationAgent(registry);
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnWiki(agentCtx);

      // Should indicate unsupported type
      assert.ok(
        result.result.summary.toLowerCase().includes('unsupported'),
        'Should indicate unsupported finding type'
      );
      assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost for unsupported types');
    });

    it('throws error when trying to run on commits', async () => {
      const agent = new ConsolidationAgent();
      const agentCtx = await ctx.agentContext('any-repo');

      await assert.rejects(
        async () => agent.runOnCommit('any-commit', agentCtx),
        /does not run on commits/i,
        'Should throw error when called with commit'
      );
    });
  });

  describe('finding lifecycle', () => {
    it('should mark findings as in_progress then addressed on success', async () => {
      const repoId = 'consolidation-lifecycle-success';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      await createWikiPages(wiki.id, [
        { path: 'guides/setup', title: 'Setup', content: '# Setup\n\nSetup content.' },
        { path: 'guides/install', title: 'Install', content: '# Install\n\nInstall content.' },
      ]);

      const finding = await createTestFinding(
        wiki.id,
        repoId,
        'duplicate_title',
        ['guides/setup', 'guides/install'],
        { description: 'Duplicate setup guides' }
      );

      ctx.llm.setDefaultResponse(consolidationAgentResponses.duplicateMerge());

      const agent = new ConsolidationAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await agent.runOnWiki(agentCtx);

      // Check finding status was updated
      const updatedFinding = await ctx.repos.findings.findById(finding.id);
      assert.ok(updatedFinding, 'Finding should still exist');
      assert.strictEqual(
        updatedFinding.status,
        'addressed',
        'Finding should be marked as addressed'
      );
      assert.ok(updatedFinding.addressedAt, 'addressedAt should be set');
    });

    // TODO: Add error handling test when MockLLMService supports error simulation.
    // The ConsolidationAgent has error recovery logic that resets findings to 'open'
    // status if the handler fails (see consolidation-agent.ts:90-94).
    // This behavior should be tested when the mock can simulate LLM failures.
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new ConsolidationAgent();
      assert.strictEqual(agent.type, 'consolidation', 'Agent type should be consolidation');
    });

    it('can handle wiki targets', () => {
      const agent = new ConsolidationAgent();
      assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
    });

    it('cannot handle commit targets', () => {
      const agent = new ConsolidationAgent();
      assert.ok(
        !agent.canHandle({ type: 'commit', commitId: 'abc123' }),
        'Should not handle commit targets'
      );
    });

    it('has no system prompt (delegates to handlers)', () => {
      const agent = new ConsolidationAgent();
      assert.strictEqual(agent.getSystemPrompt(), null, 'Should have no system prompt');
    });
  });
});

describe('DuplicateHandler', () => {
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

  async function createWikiPages(
    wikiId: string,
    pages: Array<{ path: string; title: string; content: string }>
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
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  it('should merge duplicate pages and generate delete update', async () => {
    const repoId = 'duplicate-merge';

    await createTestRepo(ctx, repoId, {
      'README.md': '# Test',
    });

    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await createWikiPages(wiki.id, [
      {
        path: 'guides/setup',
        title: 'Setup Guide',
        content: '# Setup Guide\n\nHow to set up the project.',
      },
      {
        path: 'guides/installation',
        title: 'Installation Guide',
        content: '# Installation Guide\n\nHow to install the project.',
      },
    ]);

    ctx.llm.setDefaultResponse(consolidationAgentResponses.duplicateMerge());

    const handler = new DuplicateHandler();
    const agentCtx = await ctx.agentContext(repoId);

    const result = await handler.handle(
      {
        type: 'duplicate_title',
        findings: [
          createFinding({
            id: 'finding-1',
            wikiId: wiki.id,
            repoId,
            sourceAgentRunId: 'test',
            type: 'duplicate_title',
            description: 'Similar pages',
            affectedPaths: ['guides/setup', 'guides/installation'],
            severity: 'medium',
          }),
        ],
        affectedPaths: ['guides/setup', 'guides/installation'],
        severity: 'medium',
      },
      agentCtx
    );

    // Should have updates for merge
    assert.ok(result.updates.length > 0, 'Should generate updates');

    // Should have an update for the primary page
    const updateForPrimary = result.updates.find(u => u.type === 'update');
    assert.ok(updateForPrimary, 'Should have update for primary page');

    // Should have a delete for the secondary page
    const deleteUpdate = result.updates.find(u => u.type === 'delete');
    assert.ok(deleteUpdate, 'Should have delete for secondary page');
    assert.ok(deleteUpdate?.redirectTo, 'Delete should have redirect');
  });

  it('should keep pages separate when LLM decides not to merge', async () => {
    const repoId = 'duplicate-keep-separate';

    await createTestRepo(ctx, repoId, {
      'README.md': '# Test',
    });

    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await createWikiPages(wiki.id, [
      {
        path: 'guides/frontend-setup',
        title: 'Frontend Setup',
        content: '# Frontend Setup\n\nHow to set up the frontend.',
      },
      {
        path: 'guides/backend-setup',
        title: 'Backend Setup',
        content: '# Backend Setup\n\nHow to set up the backend.',
      },
    ]);

    ctx.llm.setDefaultResponse(consolidationAgentResponses.duplicateKeepSeparate());

    const handler = new DuplicateHandler();
    const agentCtx = await ctx.agentContext(repoId);

    const result = await handler.handle(
      {
        type: 'similar_content',
        findings: [
          createFinding({
            id: 'finding-2',
            wikiId: wiki.id,
            repoId,
            sourceAgentRunId: 'test',
            type: 'similar_content',
            description: 'Pages have some similar content',
            affectedPaths: ['guides/frontend-setup', 'guides/backend-setup'],
            severity: 'low',
          }),
        ],
        affectedPaths: ['guides/frontend-setup', 'guides/backend-setup'],
        severity: 'low',
      },
      agentCtx
    );

    // Should not generate updates when keeping separate
    assert.strictEqual(
      result.updates.length,
      0,
      'Should not generate updates when keeping pages separate'
    );
  });

  it('should handle case with only one page gracefully', async () => {
    const repoId = 'duplicate-single-page';

    await createTestRepo(ctx, repoId, {
      'README.md': '# Test',
    });

    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await createWikiPages(wiki.id, [
      { path: 'guides/setup', title: 'Setup', content: '# Setup' },
    ]);

    const handler = new DuplicateHandler();
    const agentCtx = await ctx.agentContext(repoId);

    const result = await handler.handle(
      {
        type: 'duplicate_title',
        findings: [],
        affectedPaths: ['guides/setup'],
        severity: 'medium',
      },
      agentCtx
    );

    // Should return empty result
    assert.ok(
      result.result.summary.toLowerCase().includes('not enough'),
      'Should indicate not enough pages'
    );
    assert.strictEqual(result.updates.length, 0, 'Should not generate updates');
    assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost');
  });
});

describe('BrokenLinkHandler', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

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

  it('should fix broken link by finding similar valid path', async () => {
    const repoId = 'broken-link-fix';

    await createTestRepo(ctx, repoId, {
      'README.md': '# Test',
    });

    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await createWikiPages(wiki.id, [
      {
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nSee [Setup Guide](setup-guid.md) for details.',
        links: ['setup-guid'], // Typo in link
      },
      {
        path: 'setup-guide',
        title: 'Setup Guide',
        content: '# Setup Guide\n\nHow to set up.',
      },
    ]);

    const handler = new BrokenLinkHandler();
    const agentCtx = await ctx.agentContext(repoId);

    const result = await handler.handle(
      {
        type: 'broken_link',
        findings: [
          createFinding({
            id: 'finding-broken',
            wikiId: wiki.id,
            repoId,
            sourceAgentRunId: 'test',
            type: 'broken_link',
            description: 'Broken link to setup-guid',
            affectedPaths: ['overview'],
            severity: 'high',
            metadata: { brokenLinkPath: 'setup-guid' },
          }),
        ],
        affectedPaths: ['overview'],
        severity: 'high',
      },
      agentCtx
    );

    // Should fix the link
    const updateForPage = result.updates.find(u => u.path === 'overview');
    assert.ok(updateForPage, 'Should have update for page with broken link');
    assert.ok(
      updateForPage?.content?.includes('setup-guide'),
      'Should fix the link to valid path'
    );
  });

  it('should remove link when no similar path exists', async () => {
    const repoId = 'broken-link-remove';

    await createTestRepo(ctx, repoId, {
      'README.md': '# Test',
    });

    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await createWikiPages(wiki.id, [
      {
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nSee [Deleted Page](completely-nonexistent.md) for more.',
        links: ['completely-nonexistent'],
      },
    ]);

    const handler = new BrokenLinkHandler();
    const agentCtx = await ctx.agentContext(repoId);

    const result = await handler.handle(
      {
        type: 'broken_link',
        findings: [
          createFinding({
            id: 'finding-broken-2',
            wikiId: wiki.id,
            repoId,
            sourceAgentRunId: 'test',
            type: 'broken_link',
            description: 'Broken link to nonexistent page',
            affectedPaths: ['overview'],
            severity: 'high',
            metadata: { brokenLinkPath: 'completely-nonexistent' },
          }),
        ],
        affectedPaths: ['overview'],
        severity: 'high',
      },
      agentCtx
    );

    // Should remove the link
    const updateForPage = result.updates.find(u => u.path === 'overview');
    assert.ok(updateForPage, 'Should have update for page with broken link');
    // Link should be removed but text preserved
    assert.ok(
      !updateForPage?.content?.includes('[Deleted Page]'),
      'Should remove the link markdown'
    );
    assert.ok(
      updateForPage?.content?.includes('Deleted Page'),
      'Should preserve the link text'
    );
  });
});

describe('FindingHandlerRegistry', () => {
  it('should register and retrieve handlers correctly', () => {
    const registry = new FindingHandlerRegistry();
    const handler = new DuplicateHandler();

    registry.register(handler);

    assert.strictEqual(
      registry.getHandler('duplicate_title'),
      handler,
      'Should retrieve handler for duplicate_title'
    );
    assert.strictEqual(
      registry.getHandler('similar_content'),
      handler,
      'Should retrieve handler for similar_content'
    );
  });

  it('should return undefined for unknown finding types', () => {
    const registry = new FindingHandlerRegistry();

    assert.strictEqual(
      registry.getHandler('broken_link'),
      undefined,
      'Should return undefined for unregistered type'
    );
  });

  it('should check if handler exists', () => {
    const registry = new FindingHandlerRegistry();
    registry.register(new DuplicateHandler());

    assert.ok(registry.hasHandler('duplicate_title'), 'Should have duplicate_title handler');
    assert.ok(!registry.hasHandler('broken_link'), 'Should not have broken_link handler');
  });

  it('should list all supported types', () => {
    const registry = new FindingHandlerRegistry();
    registry.register(new DuplicateHandler());
    registry.register(new BrokenLinkHandler());

    const types = registry.getSupportedTypes();
    assert.ok(types.includes('duplicate_title'), 'Should include duplicate_title');
    assert.ok(types.includes('similar_content'), 'Should include similar_content');
    assert.ok(types.includes('broken_link'), 'Should include broken_link');
  });
});
