/**
 * Unit tests for CategoryAgent.
 *
 * Run with: node --import tsx --test tests/unit/category-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CategoryAgent } from '../../src/agents/meta/category-agent.js';
import { createCommitTarget, createPathTarget, createWikiTarget } from '../../src/domain/work-target.js';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/test-context.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('CategoryAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  describe('canHandle', () => {
    it('returns true for WikiTarget', () => {
      const agent = new CategoryAgent();
      const wikiTarget = createWikiTarget();

      assert.strictEqual(agent.canHandle(wikiTarget), true);
    });

    it('returns false for CommitTarget', () => {
      const agent = new CategoryAgent();
      const commitTarget = createCommitTarget('abc123');

      assert.strictEqual(agent.canHandle(commitTarget), false);
    });

    it('returns false for PathTarget', () => {
      const agent = new CategoryAgent();
      const pathTarget = createPathTarget('src/utils');

      assert.strictEqual(agent.canHandle(pathTarget), false);
    });
  });

  describe('run', () => {
    it('throws for non-wiki targets', async () => {
      const agent = new CategoryAgent();
      const commitTarget = createCommitTarget('abc123');
      const mockContext = {} as any;

      await assert.rejects(
        () => agent.run(commitTarget, mockContext),
        /cannot handle target type/i
      );
    });

    it('returns early with empty updates when wiki has fewer than 2 pages', async () => {
      const repoId = 'category-test-few-pages';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create just one page
      const page: WikiPage = {
        id: 'page-1',
        wikiId: agentCtx.wikiId,
        path: 'docs/single-page',
        title: 'Single Page',
        content: '# Single Page\n\nJust one page in the wiki.',
        confidence: 0.7,
        sourceCommits: ['abc123'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);

      const agent = new CategoryAgent();
      const wikiTarget = createWikiTarget();
      const result = await agent.run(wikiTarget, agentCtx);

      assert.strictEqual(result.updates.length, 0);
      assert.ok(result.result.summary.includes('Not enough pages'));
    });

    it('analyzes pages and returns categorization results', async () => {
      const repoId = 'category-test-analysis';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create multiple pages in different categories
      const pages: WikiPage[] = [
        {
          id: 'page-1',
          wikiId: agentCtx.wikiId,
          path: 'security/auth',
          title: 'Authentication',
          content: '# Authentication\n\nHandles user login and session management.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-2',
          wikiId: agentCtx.wikiId,
          path: 'api/endpoints',
          title: 'API Endpoints',
          content: '# API Endpoints\n\nREST API endpoint documentation.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-3',
          wikiId: agentCtx.wikiId,
          path: 'guides/getting-started',
          title: 'Getting Started',
          content: '# Getting Started\n\nHow to set up the project.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const page of pages) {
        await ctx.repos.wikiPages.save(page);
      }

      // Configure mock to return a categorization response
      ctx.llm.setDefaultResponse(`CATEGORIZATIONS:
- [security/auth] | [security] | [security] | [confidence:0.9] | [Correctly categorized as security]
- [api/endpoints] | [api] | [api] | [confidence:0.85] | [Correctly categorized as API]
- [guides/getting-started] | [guides] | [guides] | [confidence:0.95] | [Correctly categorized as guides]

FINDINGS:

CONFIDENCE: 0.9`);

      const agent = new CategoryAgent();
      const wikiTarget = createWikiTarget();
      const result = await agent.run(wikiTarget, agentCtx);

      // Should have analyzed pages
      assert.ok(result.result.summary.includes('Analyzed'));
      assert.strictEqual(result.result.confidence, 0.9);
    });

    it('creates findings for miscategorized pages', async () => {
      const repoId = 'category-test-mismatch';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create a page that appears miscategorized
      const pages: WikiPage[] = [
        {
          id: 'page-1',
          wikiId: agentCtx.wikiId,
          path: 'guides/oauth-security', // In guides but about security
          title: 'OAuth Security',
          content: '# OAuth Security\n\nSecurity considerations for OAuth implementation.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-2',
          wikiId: agentCtx.wikiId,
          path: 'security/overview',
          title: 'Security Overview',
          content: '# Security Overview\n\nProject security practices.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const page of pages) {
        await ctx.repos.wikiPages.save(page);
      }

      // Configure mock to return a mismatch finding
      ctx.llm.setDefaultResponse(`CATEGORIZATIONS:
- [guides/oauth-security] | [guides] | [security] | [confidence:0.85] | [Content is about security, not a guide]
- [security/overview] | [security] | [security] | [confidence:0.95] | [Correctly categorized]

FINDINGS:
- [category_mismatch] [SEVERITY:medium] [guides/oauth-security] should be in [security] because [it discusses OAuth security implementation details, not a how-to guide]

CONFIDENCE: 0.85`);

      const agent = new CategoryAgent();
      const wikiTarget = createWikiTarget();
      const result = await agent.run(wikiTarget, agentCtx);

      // Should have created a finding
      assert.ok(result.result.findings.length > 0);
      const finding = result.result.findings[0];
      assert.ok(finding!.description.includes('security'));
    });
  });

  describe('getSystemPrompt', () => {
    it('returns a non-null system prompt', () => {
      const agent = new CategoryAgent();
      const prompt = agent.getSystemPrompt();

      assert.ok(prompt !== null);
      assert.ok(prompt!.length > 0);
      assert.ok(prompt!.includes('category'));
    });
  });

  describe('type', () => {
    it('has correct agent type', () => {
      const agent = new CategoryAgent();
      assert.strictEqual(agent.type, 'category');
    });
  });
});
