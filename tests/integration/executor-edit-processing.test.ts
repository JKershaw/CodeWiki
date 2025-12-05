/**
 * Integration tests for Executor automatic edit request processing.
 * Tests that the Executor processes pending edit requests before asking
 * the Orchestrator for work, without any threshold.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { Executor, createExecutor } from '../../src/executor/executor.js';
import { Orchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createEditRequest } from '../../src/domain/edit-request.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('Executor Edit Request Processing', () => {
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
   * Helper to create a pending edit request.
   */
  async function createPendingEdit(
    wikiId: string,
    repoId: string,
    pagePath: string,
    content: string
  ): Promise<string> {
    const editId = uuid();
    const editRequest = createEditRequest({
      id: editId,
      repoId,
      wikiId,
      sourceCommitSha: 'abc123',
      sourceCommitTimestamp: new Date(),
      sourceAgentType: 'code-change',
      sourceAgentRunId: uuid(),
      targetPagePath: pagePath,
      proposedUpdateType: 'create',
      proposedContent: content,
      confidenceDelta: 0.1,
    });
    await ctx.repos.editRequests.save(editRequest);
    return editId;
  }

  /**
   * Helper to create a wiki page.
   */
  async function createPage(
    wikiId: string,
    path: string,
    content: string
  ): Promise<WikiPage> {
    const page: WikiPage = {
      id: uuid(),
      wikiId,
      path,
      title: path.split('/').pop() || path,
      content,
      confidence: 0.7,
      sourceCommits: [],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await ctx.repos.wikiPages.save(page);
    return page;
  }

  describe('automatic edit processing', () => {
    it('processes pending edit requests before asking Orchestrator for work', async () => {
      const repoId = 'executor-edit-first';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a single pending edit request (below old threshold of 5)
      await createPendingEdit(wiki.id, repoId, 'docs/new-page', '# New Page\n\nContent.');

      // Run executor with 1 iteration
      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      const summary = await executor.runIterations(repoId, 1);

      // Should have processed the edit request
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Pending edits should be processed');

      // The wiki-editor agent should have run
      assert.ok(summary.iterations >= 1, 'Should have run at least one iteration');
    });

    it('runs WikiEditorAgent when any pending edits exist (no threshold)', async () => {
      const repoId = 'executor-no-threshold';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create just ONE pending edit request - should still trigger processing
      await createPendingEdit(wiki.id, repoId, 'docs/single-page', '# Single Page');

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      await executor.runIterations(repoId, 1);

      // The single edit should have been processed
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Single pending edit should be processed');

      // Verify the page was created
      const pages = await ctx.repos.wikiPages.findByWiki(wiki.id);
      const newPage = pages.find(p => p.path === 'docs/single-page');
      assert.ok(newPage, 'New page should have been created from edit request');
    });

    it('continues with Orchestrator work after edit processing completes', async () => {
      const repoId = 'executor-continues-after-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create one pending edit
      const editId = await createPendingEdit(wiki.id, repoId, 'docs/edit-page', '# Edit Page');

      // Create a commit that needs processing (for Orchestrator to pick up)
      const commitSha = uuid().slice(0, 8);
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Test commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 0,
          affectedFiles: ['src/test.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM for the code-change agent - no wiki updates to avoid new edits
      ctx.llm.setDefaultResponse(`{
        "summary": "Test analysis",
        "findings": [],
        "wikiUpdates": [],
        "confidence": 0.8
      }`);

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run with 2 iterations - should process edit first, then do other work
      const summary = await executor.runIterations(repoId, 2);

      // The original pending edit should be processed (check by ID)
      const originalEdit = await ctx.repos.editRequests.findById(editId);
      assert.ok(originalEdit, 'Original edit should still exist');
      assert.strictEqual(originalEdit.status, 'applied', 'Original edit should be applied');

      // Should have run at least 2 iterations (edit processing + other work)
      assert.ok(summary.iterations >= 2, 'Should have run at least 2 iterations');
    });

    it('handles case where more edits exist than MAX_EDITS_PER_RUN', async () => {
      const repoId = 'executor-many-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create 15 pending edits (more than MAX_EDITS_PER_RUN of 10)
      for (let i = 0; i < 15; i++) {
        await createPendingEdit(wiki.id, repoId, `docs/page-${i}`, `# Page ${i}`);
      }

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run with 1 iteration - WikiEditorAgent will process up to 10
      await executor.runIterations(repoId, 1);

      // Should have 5 remaining (15 - 10)
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 5, 'Should have 5 remaining edits after processing 10');

      // Run another iteration to process remaining
      await executor.runIterations(repoId, 1);

      const remainingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(remainingEdits.length, 0, 'All edits should be processed after second run');
    });

    it('processes edits before bootstrap on empty wiki', async () => {
      const repoId = 'executor-edits-before-bootstrap';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Wiki is empty (no pages) - bootstrap would normally trigger
      // But if there are pending edits, they should be processed first

      // Create a pending edit
      await createPendingEdit(wiki.id, repoId, 'docs/from-edit', '# From Edit Request');

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run with 1 iteration
      await executor.runIterations(repoId, 1);

      // Edit should be processed first
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Pending edit should be processed');

      // The page from the edit should exist
      const pages = await ctx.repos.wikiPages.findByWiki(wiki.id);
      const editPage = pages.find(p => p.path === 'docs/from-edit');
      assert.ok(editPage, 'Page from edit request should exist');
    });

    it('tracks edit processing in agent runs', async () => {
      const repoId = 'executor-track-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a pending edit
      await createPendingEdit(wiki.id, repoId, 'docs/tracked-page', '# Tracked Page');

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      await executor.runIterations(repoId, 1);

      // Should have an agent run for wiki-editor
      const agentRuns = await ctx.repos.agentRuns.findByRepo(repoId);
      const wikiEditorRuns = agentRuns.filter(r => r.agentType === 'wiki-editor');
      assert.ok(wikiEditorRuns.length > 0, 'Should have wiki-editor agent run for tracking');
    });
  });
});
