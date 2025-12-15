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
import { DefaultOrchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createEditRequest, createCommitEditSource } from '../../src/domain/edit-request.js';
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
      source: createCommitEditSource('abc123', new Date()),
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
    it('processes pending edit requests during executor run', async () => {
      // In the new synchronous model, pre-existing edits are processed in the
      // post-pool check, not as separate work items. This test verifies that
      // edits created before the executor runs are still processed.
      const repoId = 'executor-edit-first';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a pending edit request before running executor
      await createPendingEdit(wiki.id, repoId, 'docs/new-page', '# New Page\n\nThis is comprehensive documentation content that meets the minimum length requirement for wiki pages.');

      // Run executor
      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      await executor.runIterations(repoId, 1);

      // Should have processed the edit request (via post-pool synchronous processing)
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Pending edits should be processed');
    });

    it('processes even a single pending edit request', async () => {
      // Verify that even a single edit request is processed (no minimum threshold)
      const repoId = 'executor-no-threshold';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content that is long enough to pass validation requirements.');

      // Create just ONE pending edit request - should still be processed
      await createPendingEdit(wiki.id, repoId, 'docs/single-page', '# Single Page\n\nThis is comprehensive documentation for the single page that explains the feature in detail and provides enough content to pass validation.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      await executor.runIterations(repoId, 1);

      // The single edit should have been processed
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Single pending edit should be processed');
    });

    it('continues with Orchestrator work after edit processing completes', async () => {
      // In the new synchronous model, pre-existing edits are processed
      // in the post-pool check. This test verifies that the executor
      // still processes other work after handling edits.
      const repoId = 'executor-continues-after-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create one pending edit with sufficient content
      const editId = await createPendingEdit(wiki.id, repoId, 'docs/edit-page', '# Edit Page\n\nThis is comprehensive documentation content that meets the minimum requirements for wiki pages.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run executor
      await executor.runIterations(repoId, 2);

      // The original pending edit should be processed (check by ID)
      const originalEdit = await ctx.repos.editRequests.findById(editId);
      assert.ok(originalEdit, 'Original edit should still exist');
      assert.strictEqual(originalEdit.status, 'applied', 'Original edit should be applied');
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

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
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

    it('processes edits on empty wiki', async () => {
      // Even on an empty wiki, pre-existing edits should be processed
      const repoId = 'executor-edits-before-bootstrap';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Wiki is empty (no pages) - create a pending edit
      await createPendingEdit(wiki.id, repoId, 'docs/from-edit', '# From Edit Request\n\nThis is comprehensive documentation that explains the feature in detail for new developers. It provides thorough coverage of all aspects.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run executor
      await executor.runIterations(repoId, 1);

      // Edit should be processed
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Pending edit should be processed');
    });

    it('tracks edit processing in agent runs', async () => {
      // Verify that wiki-editor agent runs are tracked even when processing
      // happens synchronously (either post-pool or after analysis agents)
      const repoId = 'executor-track-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a pending edit with sufficient content
      await createPendingEdit(wiki.id, repoId, 'docs/tracked-page', '# Tracked Page\n\nThis is comprehensive documentation content that explains the tracked page functionality in detail for developers.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      await executor.runIterations(repoId, 1);

      // Verify edit was processed
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(pendingEdits.length, 0, 'Edit should be processed');
    });

    it('processes all pending edits within a run (no backlog)', async () => {
      // This test verifies that all pending edit requests are processed
      // within a single run - no edits should remain pending after the run completes.

      const repoId = 'executor-all-edits-processed';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create multiple edits with sufficient content
      await createPendingEdit(wiki.id, repoId, 'docs/edit-a', '# Edit A\n\nThis is comprehensive documentation for edit A with detailed explanations.');
      await createPendingEdit(wiki.id, repoId, 'docs/edit-b', '# Edit B\n\nThis is comprehensive documentation for edit B with detailed explanations.');
      await createPendingEdit(wiki.id, repoId, 'docs/edit-c', '# Edit C\n\nThis is comprehensive documentation for edit C with detailed explanations.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run with enough iterations
      await executor.runIterations(repoId, 5);

      // All edits should be processed - no pending edits remaining
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(
        pendingEdits.length,
        0,
        `Expected 0 pending edits but found ${pendingEdits.length}. All edits should be processed within a single run.`
      );
    });

    it('does not allow edit backlog to accumulate during continuous processing', async () => {
      // This test ensures that edit requests are processed during executor runs
      // without building a backlog.

      const repoId = 'executor-no-backlog';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create initial page
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create multiple edits with sufficient content
      await createPendingEdit(wiki.id, repoId, 'docs/edit-1', '# Edit 1\n\nThis is comprehensive documentation for edit 1 with detailed explanations and examples.');
      await createPendingEdit(wiki.id, repoId, 'docs/edit-2', '# Edit 2\n\nThis is comprehensive documentation for edit 2 with detailed explanations and examples.');
      await createPendingEdit(wiki.id, repoId, 'docs/edit-3', '# Edit 3\n\nThis is comprehensive documentation for edit 3 with detailed explanations and examples.');

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator);

      // Run executor
      await executor.runIterations(repoId, 5);

      // All edits should be processed - no backlog
      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(
        pendingEdits.length,
        0,
        `Backlog detected: ${pendingEdits.length} edits still pending. Edits should be processed.`
      );
    });
  });

  describe('synchronous edit processing after analysis agents', () => {
    it('processes edit requests immediately after analysis agent creates them (same iteration)', async () => {
      // This test verifies that when an analysis agent creates edit requests,
      // the wiki-editor runs synchronously as part of the same work item execution,
      // NOT as a separate work item. This prevents duplicate task queuing.

      const repoId = 'executor-sync-edit';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const main = () => console.log("hello");',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a commit for code-change to analyze
      const commitSha = 'sync-test-' + uuid().slice(0, 8);
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add new feature',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 5,
          linesDeleted: 0,
          affectedFiles: ['src/index.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM to return wiki updates (which create EditRequests)
      // code-change agent expects section-based format, not JSON
      // Use unique content that won't trigger similarity detection with commit pages
      ctx.llm.setDefaultResponse(`PAGE_TITLE: Database Migration System

SUMMARY:
Implemented automated database migration framework with versioning support.

FINDINGS:
- type: Architecture | importance: high | description: Database migration controller | paths: src/index.ts

WIKI_UPDATES:
=== path: database/migrations | action: create ===
# Database Migration System

The migration framework provides automated schema versioning and rollback capabilities. This documentation covers the PostgreSQL adapter integration, connection pooling configuration, and transaction management patterns used throughout the data layer.

## Schema Versioning

Each migration is assigned a sequential version number for deterministic ordering and rollback support.

=== END ===

CONFIDENCE: 0.8`);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      // Pass repoServiceFactory so analysis agents can access commit diffs
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator, ctx.repoServiceFactory);

      // Run with just 1 iteration
      const summary = await executor.runIterations(repoId, 1);

      // After just 1 iteration:
      // 1. code-change agent should have run and created an EditRequest
      // 2. wiki-editor should have run synchronously and applied the edit
      // 3. NO pending edit requests should remain

      const pendingEdits = await ctx.repos.editRequests.findPending(wiki.id);
      assert.strictEqual(
        pendingEdits.length,
        0,
        `Edit requests should be processed synchronously within the same iteration. ` +
        `Found ${pendingEdits.length} pending edits after 1 iteration.`
      );

      // Verify wiki content was updated - either new page or merged into existing
      // (similarity detection may merge similar content)
      const pages = await ctx.repos.wikiPages.findByWiki(wiki.id);
      const hasNewContent = pages.some(p =>
        p.content.includes('migration') || p.content.includes('PostgreSQL')
      );
      assert.ok(
        hasNewContent,
        `Wiki should contain the new content from the analysis. Found pages: ${pages.map(p => p.path).join(', ')}`
      );

      // Should have completed in 1 iteration, not 2
      assert.strictEqual(
        summary.iterations,
        1,
        'Should complete analysis + edit application in a single iteration'
      );
    });

    it('does not create separate wiki-editor work items when edits are processed synchronously', async () => {
      // Verify that synchronous edit processing doesn't create wiki-editor work items

      const repoId = 'executor-no-wiki-editor-work-item';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/app.ts': 'export const app = {};',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create initial page
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create a commit
      const commitSha = 'no-work-item-' + uuid().slice(0, 8);
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Update app',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 3,
          linesDeleted: 0,
          affectedFiles: ['src/app.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Mock LLM to create wiki updates
      // code-change agent expects section-based format, not JSON
      // Use unique content that won't trigger similarity detection
      ctx.llm.setDefaultResponse(`PAGE_TITLE: GraphQL Schema Design

SUMMARY:
Implemented strongly-typed GraphQL resolver architecture with DataLoader batching.

FINDINGS:
- type: Architecture | importance: high | description: GraphQL schema resolver | paths: src/app.ts

WIKI_UPDATES:
=== path: graphql/schema-design | action: create ===
# GraphQL Schema Design

The GraphQL layer implements a resolver-first architecture with DataLoader for N+1 query optimization. This documentation covers mutation patterns, subscription handlers, and federation gateway configuration for microservices deployment.

## Resolver Architecture

Each resolver implements the interface contract with automatic type generation from schema definitions.

=== END ===

CONFIDENCE: 0.8`);

      const orchestrator = new DefaultOrchestrator(ctx.repos, ctx.llm);
      // Pass repoServiceFactory so analysis agents can access commit diffs
      const executor = createExecutor(ctx.repos, ctx.git, ctx.llm, orchestrator, ctx.repoServiceFactory);

      await executor.runIterations(repoId, 2);

      // Check work queue - should NOT have any wiki-editor work items
      const allWork = await ctx.repos.workQueue.findByRepo(repoId);
      const wikiEditorWorkItems = allWork.filter(w => w.agentType === 'wiki-editor');

      assert.strictEqual(
        wikiEditorWorkItems.length,
        0,
        `Should not create wiki-editor work items when edits are processed synchronously. ` +
        `Found ${wikiEditorWorkItems.length} wiki-editor work items.`
      );
    });
  });
});
