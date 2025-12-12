/**
 * Integration tests for Orchestrator bootstrap behavior.
 * Tests that the orchestrator prioritizes bootstrap on empty wikis.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { DefaultOrchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createWorkItem, createWikiTarget } from '../../src/domain/work-item.js';
import { createAgentRun } from '../../src/domain/agent-run.js';

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
      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // First item should be bootstrap
      assert.ok(workItems.length > 0, 'Should generate work items');
      assert.strictEqual(workItems[0]?.agentType, 'bootstrap',
        `First work item should be bootstrap, got ${workItems[0]?.agentType}`);
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
      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
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

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
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
      await ctx.repos.workQueue.save(createWorkItem({
        id: 'existing-bootstrap-work',
        repoId,
        agentType: 'bootstrap',
        target: createWikiTarget(),
      }));

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should not create another bootstrap item
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0, 'Should not duplicate bootstrap work');
    });

    it('does not duplicate bootstrap work if already claimed (race condition prevention)', async () => {
      const repoId = 'orchestrator-no-duplicate-claimed-bootstrap';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Pre-create a CLAIMED bootstrap work item (simulates race condition where
      // one worker has claimed bootstrap but another worker is checking for work)
      const claimedBootstrap = createWorkItem({
        id: 'claimed-bootstrap-work',
        repoId,
        agentType: 'bootstrap',
        target: createWikiTarget(),
      });
      claimedBootstrap.status = 'claimed';
      claimedBootstrap.claimedAt = new Date();
      await ctx.repos.workQueue.save(claimedBootstrap);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should not create another bootstrap item - the claimed one is in progress
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0,
        'Should not duplicate bootstrap work when one is already claimed/in-progress');
    });

    it('does not regenerate bootstrap if previous bootstrap work item failed', async () => {
      const repoId = 'orchestrator-no-retry-failed-bootstrap-work';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo (empty wiki)
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Pre-create a FAILED bootstrap work item (simulates first run failure)
      const failedWorkItem = createWorkItem({
        id: 'failed-bootstrap-work',
        repoId,
        agentType: 'bootstrap',
        priority: 100,
      });
      failedWorkItem.status = 'failed';
      failedWorkItem.completedAt = new Date();
      await ctx.repos.workQueue.save(failedWorkItem);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should NOT create another bootstrap item - prevents infinite loop
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0,
        'Should not regenerate bootstrap after work item failure (prevents infinite loop)');
    });

    it('does not regenerate bootstrap if previous bootstrap agent run failed', async () => {
      const repoId = 'orchestrator-no-retry-failed-bootstrap-run';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo (empty wiki)
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Pre-create a FAILED bootstrap agent run (simulates first run failure)
      const failedAgentRun = createAgentRun({
        id: 'failed-bootstrap-run',
        repoId,
        wikiId: wiki.id,
        agentType: 'bootstrap',
      });
      failedAgentRun.status = 'failed';
      failedAgentRun.error = 'LLM service unavailable';
      failedAgentRun.completedAt = new Date();
      await ctx.repos.agentRuns.save(failedAgentRun);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should NOT create another bootstrap item - prevents infinite loop
      const bootstrapItems = workItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(bootstrapItems.length, 0,
        'Should not regenerate bootstrap after agent run failure (prevents infinite loop)');
    });

    it('prevents infinite loop when bootstrap fails on first run', async () => {
      const repoId = 'orchestrator-infinite-loop-prevention';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Get the wiki for this repo (empty wiki)
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);

      // First call: should generate bootstrap work
      const firstWorkItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);
      assert.strictEqual(firstWorkItems.length, 1, 'First call should generate bootstrap');
      assert.strictEqual(firstWorkItems[0]?.agentType, 'bootstrap');

      // Simulate the bootstrap work item being claimed and failing
      const bootstrapWorkItem = firstWorkItems[0]!;
      bootstrapWorkItem.status = 'failed';
      bootstrapWorkItem.completedAt = new Date();
      await ctx.repos.workQueue.save(bootstrapWorkItem);

      // Second call: should NOT generate new bootstrap (prevents infinite loop)
      const secondWorkItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);
      const newBootstrapItems = secondWorkItems.filter(w => w.agentType === 'bootstrap');
      assert.strictEqual(newBootstrapItems.length, 0,
        'Second call should NOT regenerate bootstrap after failure (prevents infinite loop)');

      // The system should return empty work list (nothing to do until bootstrap succeeds)
      assert.strictEqual(secondWorkItems.length, 0,
        'Should return empty work list when bootstrap has failed and wiki is empty');
    });
  });
});
