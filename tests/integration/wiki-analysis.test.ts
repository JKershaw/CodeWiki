/**
 * Integration tests for wiki analysis workflows.
 * Tests LinkAgent and QualityAgent with real repos.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import { QualityAgent } from '../../src/agents/meta/quality-agent.js';

describe('Wiki Analysis', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('LinkAgent', () => {
    const repoId = 'link-test-repo';

    beforeEach(async () => {
      ctx.llm.reset();
    });

    it('suggests links between related wiki pages', async () => {
      await createTestRepo(ctx, repoId);

      // Create wiki pages directly in the repository
      await ctx.repos.wikiPages.save({
        id: 'page-1',
        repoId,
        path: 'commits/abc1234',
        title: 'Add User Authentication',
        content: '# Add User Authentication\n\nImplemented JWT-based auth in src/auth.ts.',
        confidence: 0.7,
        sourceCommits: ['abc1234'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'page-2',
        repoId,
        path: 'security/auth-review',
        title: 'Authentication Security Review',
        content: '# Authentication Security Review\n\nSecurity analysis of the JWT implementation.',
        confidence: 0.8,
        sourceCommits: ['def5678'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'page-3',
        repoId,
        path: 'architecture/api-design',
        title: 'API Design Patterns',
        content: '# API Design Patterns\n\nREST API design with authentication middleware.',
        confidence: 0.8,
        sourceCommits: ['ghi9012'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Configure mock LLM response
      ctx.llm.setDefaultResponse(`LINK_SUGGESTIONS:
- [commits/abc1234] -> [security/auth-review] | [STRENGTH:strong] | Both discuss JWT authentication
- [commits/abc1234] -> [architecture/api-design] | [STRENGTH:medium] | Related auth middleware

CONFIDENCE: 0.85`);

      const agent = new LinkAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Verify link suggestions were found
      assert.ok(result.result.findings.length > 0, 'Should find link suggestions');
      const linkFindings = result.result.findings.filter(f => f.type === 'LINK');
      assert.ok(linkFindings.length > 0, 'Should have LINK type findings');

      // Verify merge updates were created
      const mergeUpdates = result.updates.filter(u => u.type === 'merge');
      assert.ok(mergeUpdates.length > 0, 'Should create merge updates');
      assert.ok(
        mergeUpdates.some(u => u.content.includes('Related Pages')),
        'Updates should include Related Pages section'
      );
    });

    it('skips analysis when pages already have links', async () => {
      const repoWithLinks = 'link-test-repo-2';
      await createTestRepo(ctx, repoWithLinks);

      // Create pages that already have links
      await ctx.repos.wikiPages.save({
        id: 'linked-1',
        repoId: repoWithLinks,
        path: 'page-a',
        title: 'Page A',
        content: '# Page A',
        confidence: 0.7,
        sourceCommits: [],
        links: ['page-b'],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'linked-2',
        repoId: repoWithLinks,
        path: 'page-b',
        title: 'Page B',
        content: '# Page B',
        confidence: 0.7,
        sourceCommits: [],
        links: ['page-a'],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const agent = new LinkAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoWithLinks));

      assert.strictEqual(result.result.summary, 'All pages already have links analyzed');
      assert.strictEqual(result.updates.length, 0);
      assert.strictEqual(result.costUsd, 0);
    });
  });

  describe('QualityAgent', () => {
    const repoId = 'quality-test-repo';

    beforeEach(async () => {
      ctx.llm.reset();
    });

    it('identifies quality issues in wiki pages', async () => {
      await createTestRepo(ctx, repoId);

      // Create pages with varying quality
      await ctx.repos.wikiPages.save({
        id: 'good-page',
        repoId,
        path: 'commits/abc1234',
        title: 'Well-Written Page',
        content: `# Well-Written Page

This page has substantial content from commit abc1234 with proper references
to source files like \`src/auth.ts\`. It explains the authentication system
in detail and provides useful context for developers.

## Implementation Details

The implementation follows standard patterns and is well-documented.`,
        confidence: 0.9,
        sourceCommits: ['abc1234'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'poor-page',
        repoId,
        path: 'guides/short',
        title: 'Short Guide',
        content: 'Too short.',
        confidence: 0.3,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'no-refs-page',
        repoId,
        path: 'guides/no-refs',
        title: 'Guide Without References',
        content: `# Guide Without References

This guide discusses various topics but never mentions any specific
commit hashes or file paths, making it hard to trace back to source.`,
        confidence: 0.5,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      ctx.llm.setDefaultResponse(`ISSUES:
- [SEVERITY:medium] | [guides/short] | Page has very little content
- [SEVERITY:low] | [guides/no-refs] | Missing source citations

IMPROVEMENTS:
- [guides/short] | Expand content with more detail
- [guides/no-refs] | Add commit and file references

CONFIDENCE: 0.8`);

      const agent = new QualityAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Should identify issues
      assert.ok(result.result.findings.length > 0, 'Should find quality issues');
      assert.ok(result.result.summary.includes('Reviewed'), 'Summary should indicate review');
    });

    it('returns healthy status for high-quality pages', async () => {
      const healthyRepoId = 'quality-healthy-repo';
      await createTestRepo(ctx, healthyRepoId);

      // Create high-quality pages
      for (let i = 1; i <= 3; i++) {
        await ctx.repos.wikiPages.save({
          id: `healthy-${i}`,
          repoId: healthyRepoId,
          path: `commits/commit${i}`,
          title: `Quality Page ${i}`,
          content: `# Quality Page ${i}

This page has substantial content from commit abc${i}234 with proper
references to source files like \`src/module${i}.ts\`. It provides
comprehensive documentation that helps developers understand the system.`,
          confidence: 0.9,
          sourceCommits: [`abc${i}234`],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const agent = new QualityAgent();
      const result = await agent.runOnWiki(ctx.agentContext(healthyRepoId));

      // For healthy pages, QualityAgent returns without LLM call
      assert.ok(result.result.summary.includes('meet quality standards'));
      assert.strictEqual(result.costUsd, 0);
    });
  });
});
