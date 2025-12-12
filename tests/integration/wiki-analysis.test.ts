/**
 * Integration tests for wiki analysis workflows.
 * Tests LinkAgent and QualityAgent with real repos.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import { QualityAgent } from '../../src/agents/meta/quality-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createWikiTarget } from '../../src/domain/work-target.js';

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
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create wiki pages directly in the repository
      await ctx.repos.wikiPages.save({
        id: 'page-1',
        wikiId: wiki.id,
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
        wikiId: wiki.id,
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
        wikiId: wiki.id,
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

      // Configure mock LLM response (new simplified format)
      ctx.llm.setDefaultResponse(`LINK_SUGGESTIONS:
- commits/abc1234 -> security/auth-review | strong | Both discuss JWT authentication
- commits/abc1234 -> architecture/api-design | medium | Related auth middleware

CONFIDENCE: 0.85`);

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createWikiTarget(), agentCtx);

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

    it('skips analysis when pages have sufficient links and no newer pages exist', async () => {
      const repoWithLinks = 'link-test-repo-2';
      await createTestRepo(ctx, repoWithLinks);
      const wiki = await getOrCreateActiveWiki(repoWithLinks, ctx.repos);

      // Create pages that already have 2+ links at the same timestamp
      // (no newer pages exist, so no re-analysis needed)
      // Pages with 2+ links are considered "sufficiently linked"
      const sameTime = new Date();
      await ctx.repos.wikiPages.save({
        id: 'linked-1',
        wikiId: wiki.id,
        path: 'page-a',
        title: 'Page A',
        content: '# Page A',
        confidence: 0.7,
        sourceCommits: [],
        sourceAgentRunIds: [],
        links: ['page-b', 'page-c'],  // 2 links = sufficient
        backlinks: [],
        createdAt: sameTime,
        updatedAt: sameTime,
      });

      await ctx.repos.wikiPages.save({
        id: 'linked-2',
        wikiId: wiki.id,
        path: 'page-b',
        title: 'Page B',
        content: '# Page B',
        confidence: 0.7,
        sourceCommits: [],
        sourceAgentRunIds: [],
        links: ['page-a', 'page-c'],  // 2 links = sufficient
        backlinks: [],
        createdAt: sameTime,
        updatedAt: sameTime,
      });

      await ctx.repos.wikiPages.save({
        id: 'linked-3',
        wikiId: wiki.id,
        path: 'page-c',
        title: 'Page C',
        content: '# Page C',
        confidence: 0.7,
        sourceCommits: [],
        sourceAgentRunIds: [],
        links: ['page-a', 'page-b'],  // 2 links = sufficient
        backlinks: [],
        createdAt: sameTime,
        updatedAt: sameTime,
      });

      const agent = new LinkAgent();
      const agentCtx = await ctx.agentContext(repoWithLinks);
      const result = await agent.run(createWikiTarget(), agentCtx);

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
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages with varying quality
      await ctx.repos.wikiPages.save({
        id: 'good-page',
        wikiId: wiki.id,
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
        wikiId: wiki.id,
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
        wikiId: wiki.id,
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
- severity: medium | page: guides/short | Page has very little content
- severity: low | page: guides/no-refs | Missing source citations

IMPROVEMENTS:
- page: guides/short | Expand content with more detail
- page: guides/no-refs | Add commit and file references

CONFIDENCE: 0.8`);

      const agent = new QualityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should identify issues
      assert.ok(result.result.findings.length > 0, 'Should find quality issues');
      assert.ok(result.result.summary.includes('Reviewed'), 'Summary should indicate review');
    });

    it('generates merge updates for pages with improvement suggestions', async () => {
      const fixableRepoId = 'quality-fixable-repo';
      await createTestRepo(ctx, fixableRepoId);
      const wiki = await getOrCreateActiveWiki(fixableRepoId, ctx.repos);

      // Create pages with quality issues
      await ctx.repos.wikiPages.save({
        id: 'shallow-page',
        wikiId: wiki.id,
        path: 'guides/shallow',
        title: 'Shallow Guide',
        content: 'Too short.',  // Very short content
        confidence: 0.3,  // Low confidence
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await ctx.repos.wikiPages.save({
        id: 'needs-depth-page',
        wikiId: wiki.id,
        path: 'guides/needs-depth',
        title: 'Guide Needs Depth',
        content: `# Guide Needs Depth

The WorkQueue manages pending tasks for the executor.

## Empty Section

`,  // Has empty section, shallow content
        confidence: 0.4,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // First LLM call: Quality review
      ctx.llm.onPromptContaining('Review these wiki pages', `ISSUES:
- severity: high | page: guides/shallow | Page is too short to be useful
- severity: medium | page: guides/needs-depth | Describes but doesn't explain mechanisms

IMPROVEMENTS:
- page: guides/shallow | Expand with implementation details and code examples
- page: guides/needs-depth | Add details about how WorkQueue uses Redis and handles retries

CONFIDENCE: 0.75`);

      // Second LLM calls: Generate improved content for each page
      ctx.llm.onPromptContaining('guides/shallow', `IMPROVED_CONTENT:
## Overview

This guide covers the shallow topic in detail.

## Implementation

Here are the implementation details with code examples.

CONFIDENCE: 0.8`);

      ctx.llm.onPromptContaining('guides/needs-depth', `IMPROVED_CONTENT:
## How It Works

The WorkQueue uses Redis for task storage and handles retries with exponential backoff.

CONFIDENCE: 0.8`);

      const agent = new QualityAgent();
      const agentCtx = await ctx.agentContext(fixableRepoId);
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should generate merge updates for improvement suggestions
      assert.ok(result.updates.length > 0, 'Should generate updates for improvements');

      // Updates should be merge type (append improvement content)
      const mergeUpdates = result.updates.filter(u => u.type === 'merge');
      assert.ok(mergeUpdates.length > 0, 'Should create merge updates for improvements');

      // Updates should target pages with issues
      const updatePaths = mergeUpdates.map(u => u.path);
      assert.ok(
        updatePaths.some(p => p === 'guides/shallow' || p === 'guides/needs-depth'),
        'Updates should target pages with quality issues'
      );
    });

    it('generates actual improved content, not just meta-commentary', async () => {
      const improveRepoId = 'quality-improve-content-repo';
      await createTestRepo(ctx, improveRepoId);
      const wiki = await getOrCreateActiveWiki(improveRepoId, ctx.repos);

      // Create a page with shallow content that needs improvement
      await ctx.repos.wikiPages.save({
        id: 'shallow-needs-fix',
        wikiId: wiki.id,
        path: 'guides/work-queue',
        title: 'Work Queue',
        content: 'The WorkQueue manages pending tasks.',  // Too shallow
        confidence: 0.3,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Also need a second page to meet the 2-page minimum
      await ctx.repos.wikiPages.save({
        id: 'helper-page',
        wikiId: wiki.id,
        path: 'guides/executor',
        title: 'Executor',
        content: 'The executor runs tasks.',
        confidence: 0.3,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // First LLM call: Review and identify issues (matches "Review these wiki pages")
      ctx.llm.onPromptContaining('Review these wiki pages', `ISSUES:
- severity: high | page: guides/work-queue | Page is too shallow - describes but doesn't explain
- severity: high | page: guides/executor | Page is too shallow

IMPROVEMENTS:
- page: guides/work-queue | Explain how WorkQueue uses Redis-backed priority queue, task claiming via atomic operations, and retry with exponential backoff
- page: guides/executor | Explain executor architecture and task processing flow

CONFIDENCE: 0.7`);

      // Second LLM call: Generate improved content (matches "improve" or "expand")
      ctx.llm.onPromptContaining('guides/work-queue', `IMPROVED_CONTENT:
## Overview

The WorkQueue manages pending tasks using a Redis-backed priority queue.

## How It Works

Tasks are claimed via WorkQueueRepository.claimBatch(), which uses atomic operations to prevent duplicate processing. If a task fails, it's re-queued with exponential backoff up to 3 retries.

## Key Methods

- \`enqueue(task)\`: Adds a task to the priority queue
- \`claimBatch(count)\`: Atomically claims tasks for processing
- \`complete(taskId)\`: Marks a task as successfully completed
- \`fail(taskId)\`: Marks a task as failed and schedules retry

CONFIDENCE: 0.85`);

      const agent = new QualityAgent();
      const agentCtx = await ctx.agentContext(improveRepoId);
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should generate updates
      assert.ok(result.updates.length > 0, 'Should generate updates');

      // Find update for work-queue page
      const workQueueUpdate = result.updates.find(u => u.path === 'guides/work-queue');
      assert.ok(workQueueUpdate, 'Should have update for work-queue page');

      // Content should have ACTUAL improved content, not just "Quality Notes"
      assert.ok(
        !workQueueUpdate.content.includes('Quality Notes'),
        'Should NOT just add Quality Notes meta-commentary'
      );
      assert.ok(
        !workQueueUpdate.content.includes('improvements were suggested'),
        'Should NOT just describe what should be improved'
      );

      // Content should have substantive information
      assert.ok(
        workQueueUpdate.content.includes('Redis') ||
        workQueueUpdate.content.includes('atomic') ||
        workQueueUpdate.content.includes('retry') ||
        workQueueUpdate.content.includes('How It Works'),
        'Should include actual substantive content about the topic'
      );
    });

    it('returns healthy status for high-quality pages', async () => {
      const healthyRepoId = 'quality-healthy-repo';
      await createTestRepo(ctx, healthyRepoId);
      const wiki = await getOrCreateActiveWiki(healthyRepoId, ctx.repos);

      // Create high-quality pages
      for (let i = 1; i <= 3; i++) {
        await ctx.repos.wikiPages.save({
          id: `healthy-${i}`,
          wikiId: wiki.id,
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
      const agentCtx = await ctx.agentContext(healthyRepoId);
      const result = await agent.run(createWikiTarget(), agentCtx);

      // For healthy pages, QualityAgent returns without LLM call
      assert.ok(result.result.summary.includes('meet quality standards'));
      assert.strictEqual(result.costUsd, 0);
    });
  });
});
