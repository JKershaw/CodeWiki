/**
 * Integration tests for Orchestrator bootstrap behavior.
 * Tests that the orchestrator prioritizes bootstrap on empty wikis.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { Orchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';

describe('Orchestrator Bootstrap Behavior', () => {
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

  describe('generateWorkList with empty wiki', () => {
    it('prioritizes bootstrap as first work item on empty wiki', async () => {
      const repoId = 'orchestrator-bootstrap-priority';

      // Create repo with commits but NO wiki pages
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const x = 1;',
      });

      // Add some commits to process
      const commitSha = await addCommit(ctx, repoId, {
        'src/index.ts': 'export const x = 2;',
      }, 'Update x value');

      // Store commit in repository
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Update x value',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 1,
          linesDeleted: 1,
          affectedFiles: ['src/index.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // First item should be bootstrap
      assert.ok(workItems.length > 0, 'Should generate work items');
      assert.strictEqual(workItems[0]?.agentType, 'bootstrap',
        `First work item should be bootstrap, got ${workItems[0]?.agentType}`);

      // Bootstrap should have highest priority
      assert.ok(workItems[0]?.priority >= 90,
        `Bootstrap should have high priority, got ${workItems[0]?.priority}`);
    });

    it('returns only bootstrap work item when wiki is empty', async () => {
      const repoId = 'orchestrator-bootstrap-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Add multiple commits
      for (let i = 0; i < 3; i++) {
        const sha = await addCommit(ctx, repoId, {
          [`src/file${i}.ts`]: `export const val${i} = ${i};`,
        }, `Add file ${i}`);

        await ctx.repos.commits.save({
          id: sha,
          repoId,
          sha,
          message: `Add file ${i}`,
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          committedAt: new Date(),
          diffSummary: {
            filesAdded: 1,
            filesModified: 0,
            filesDeleted: 0,
            linesAdded: 1,
            linesDeleted: 0,
            affectedFiles: [`src/file${i}.ts`],
          },
          processedBy: [],
          createdAt: new Date(),
        });
      }

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should ONLY return bootstrap - don't add commit work until bootstrapped
      assert.strictEqual(workItems.length, 1, 'Should only return bootstrap work item');
      assert.strictEqual(workItems[0]?.agentType, 'bootstrap');
    });

    it('does not trigger bootstrap when wiki has pages', async () => {
      const repoId = 'orchestrator-no-bootstrap';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Pre-populate wiki with a page
      await ctx.repos.wikiPages.save({
        id: 'existing-overview',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nExisting content.',
        confidence: 0.6,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add a commit to process
      const sha = await addCommit(ctx, repoId, {
        'src/index.ts': 'export const x = 1;',
      }, 'Add index');

      await ctx.repos.commits.save({
        id: sha,
        repoId,
        sha,
        message: 'Add index',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 1,
          linesDeleted: 0,
          affectedFiles: ['src/index.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock the LLM to return work items in markdown format
      // Must be set after commit is created so we have the real SHA
      ctx.llm.setDefaultResponse(`# Reasoning
Process new commit with code-change agent

# Work Items
code-change,${sha},Analyze new commit`);

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should NOT include bootstrap
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0, 'Should not include bootstrap when wiki has pages');

      // Should include other work (code-change, etc.)
      assert.ok(workItems.length > 0, 'Should have other work items');
      assert.ok(
        workItems.some(w => w.agentType === 'code-change'),
        'Should include code-change work items'
      );
    });

    it('does not duplicate bootstrap work if already pending', async () => {
      const repoId = 'orchestrator-no-duplicate-bootstrap';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Pre-create a pending bootstrap work item
      await ctx.repos.workQueue.save({
        id: 'existing-bootstrap-work',
        repoId,
        agentType: 'bootstrap',
        priority: 100,
        status: 'pending',
        createdAt: new Date(),
        claimedAt: null,
        completedAt: null,
        agentRunId: null,
        targetCommitId: null,
        targetPagePath: null,
      });

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should not create another bootstrap item
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0, 'Should not duplicate bootstrap work');
    });
  });
});
