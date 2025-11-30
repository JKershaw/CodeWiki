/**
 * Integration tests for WikiEditorAgent.
 * Tests the intelligent processing of edit requests based on commit ordering.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { WikiEditorAgent } from '../../src/agents/meta/wiki-editor-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createEditRequest } from '../../src/domain/edit-request.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Commit } from '../../src/domain/commit.js';

describe('WikiEditorAgent', () => {
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
   * Helper to create a wiki page with specified content.
   */
  async function createPage(
    wikiId: string,
    id: string,
    path: string,
    title: string,
    content: string,
    sourceCommits: string[] = []
  ): Promise<WikiPage> {
    const page: WikiPage = {
      id,
      wikiId,
      path,
      title,
      content,
      confidence: 0.7,
      sourceCommits,
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await ctx.repos.wikiPages.save(page);
    return page;
  }

  /**
   * Helper to create a commit record.
   */
  async function createCommitRecord(
    repoId: string,
    sha: string,
    committedAt: Date,
    message: string = 'Test commit'
  ): Promise<Commit> {
    const commit: Commit = {
      id: uuid(),
      repoId,
      sha,
      message,
      author: 'Test User',
      authorEmail: 'test@example.com',
      committedAt,
      processedBy: [],
    };
    await ctx.repos.commits.save(commit);
    return commit;
  }

  /**
   * Helper to create a pending edit request.
   */
  async function createPendingEdit(
    wikiId: string,
    repoId: string,
    commitSha: string,
    commitTimestamp: Date,
    pagePath: string,
    content: string
  ): Promise<void> {
    const editRequest = createEditRequest({
      id: uuid(),
      repoId,
      wikiId,
      sourceCommitSha: commitSha,
      sourceCommitTimestamp: commitTimestamp,
      sourceAgentType: 'code-change',
      sourceAgentRunId: uuid(),
      targetPagePath: pagePath,
      proposedUpdateType: 'update',
      proposedContent: content,
      confidenceDelta: 0.1,
    });
    await ctx.repos.editRequests.save(editRequest);
  }

  describe('runOnWiki', () => {
    it('returns empty result when no pending edit requests', async () => {
      const repoId = 'editor-no-pending';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 0);
      assert.ok(result.result.summary.includes('No pending'));
      assert.strictEqual(result.costUsd, 0);
    });

    it('creates new page when page does not exist', async () => {
      const repoId = 'editor-create-page';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a commit and edit request for a non-existent page
      const commitTimestamp = new Date('2024-01-15T10:00:00Z');
      await createCommitRecord(repoId, 'abc123', commitTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'abc123',
        commitTimestamp,
        'docs/new-page',
        '# New Documentation\n\nThis is new content.'
      );

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 1);
      assert.strictEqual(result.updates[0]!.path, 'docs/new-page');
      assert.strictEqual(result.updates[0]!.type, 'create');
      assert.ok(result.updates[0]!.content.includes('New Documentation'));
      assert.strictEqual(result.costUsd, 0); // No LLM needed for create
    });

    it('applies update normally when commit is newer than page', async () => {
      const repoId = 'editor-newer-commit';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create an older commit that the page is based on
      const olderTimestamp = new Date('2024-01-01T10:00:00Z');
      const olderCommit = await createCommitRecord(repoId, 'old123', olderTimestamp);

      // Create the existing page referencing the older commit
      await createPage(
        wiki.id,
        'existing-page',
        'docs/api',
        'API Docs',
        '# Old API Content',
        [olderCommit.sha]
      );

      // Create a newer commit and edit request
      const newerTimestamp = new Date('2024-01-15T10:00:00Z');
      await createCommitRecord(repoId, 'new456', newerTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'new456',
        newerTimestamp,
        'docs/api',
        '# Updated API Content\n\nNew information.'
      );

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 1);
      assert.strictEqual(result.updates[0]!.path, 'docs/api');
      assert.strictEqual(result.updates[0]!.type, 'update');
      assert.ok(result.updates[0]!.content.includes('Updated API Content'));
      assert.strictEqual(result.costUsd, 0); // No LLM needed for newer commits
    });

    it('uses LLM to decide when commit is older than page', async () => {
      const repoId = 'editor-older-commit';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a newer commit that the page is based on
      const newerTimestamp = new Date('2024-01-15T10:00:00Z');
      const newerCommit = await createCommitRecord(repoId, 'new123', newerTimestamp);

      // Create the existing page referencing the newer commit
      await createPage(
        wiki.id,
        'existing-page',
        'docs/api',
        'API Docs',
        '# Current API Content\n\nLatest information.',
        [newerCommit.sha]
      );

      // Create an older commit and edit request
      const olderTimestamp = new Date('2024-01-01T10:00:00Z');
      await createCommitRecord(repoId, 'old456', olderTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'old456',
        olderTimestamp,
        'docs/api',
        '# Old API Content\n\nHistorical information.'
      );

      // Configure mock LLM to return a SKIP decision
      ctx.llm.setDefaultResponse(`DECISION: SKIP
REASONING: The current content supersedes this historical information.
CONTENT: `);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should have called LLM
      assert.ok(result.costUsd > 0, 'Should have called LLM');
      // Should produce no updates (skipped)
      assert.strictEqual(result.updates.length, 0);
    });

    it('adds historical context when LLM decides HISTORY', async () => {
      const repoId = 'editor-history-decision';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a newer commit that the page is based on
      const newerTimestamp = new Date('2024-01-15T10:00:00Z');
      const newerCommit = await createCommitRecord(repoId, 'new123', newerTimestamp);

      // Create the existing page
      await createPage(
        wiki.id,
        'existing-page',
        'docs/api',
        'API Docs',
        '# Current API\n\nJWT-based authentication.',
        [newerCommit.sha]
      );

      // Create an older commit and edit request
      const olderTimestamp = new Date('2024-01-01T10:00:00Z');
      await createCommitRecord(repoId, 'old456', olderTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'old456',
        olderTimestamp,
        'docs/api',
        '# Old API\n\nSession-based authentication.'
      );

      // Configure mock LLM to return a HISTORY decision
      ctx.llm.setDefaultResponse(`DECISION: HISTORY
REASONING: The historical context about session-based auth is valuable for understanding the evolution.
CONTENT: Originally used session-based authentication before migrating to JWT.`);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 1);
      const update = result.updates[0]!;
      assert.ok(update.content.includes('## Historical Context'), 'Should add historical context section');
      assert.ok(update.content.includes('session-based auth'), 'Should include historical info');
      assert.ok(update.content.includes('Current API'), 'Should preserve existing content');
    });

    it('merges content when LLM decides MERGE', async () => {
      const repoId = 'editor-merge-decision';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a newer commit
      const newerTimestamp = new Date('2024-01-15T10:00:00Z');
      const newerCommit = await createCommitRecord(repoId, 'new123', newerTimestamp);

      // Create the existing page
      await createPage(
        wiki.id,
        'existing-page',
        'docs/api',
        'API Docs',
        '# API Documentation\n\nEndpoint information.',
        [newerCommit.sha]
      );

      // Create an older commit and edit request
      const olderTimestamp = new Date('2024-01-01T10:00:00Z');
      await createCommitRecord(repoId, 'old456', olderTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'old456',
        olderTimestamp,
        'docs/api',
        '# API Details\n\nRate limiting: 100 requests per minute.'
      );

      // Configure mock LLM to return a MERGE decision
      ctx.llm.setDefaultResponse(`DECISION: MERGE
REASONING: The rate limiting information is still relevant.
CONTENT: # API Documentation

Endpoint information.

## Rate Limiting

100 requests per minute.`);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 1);
      const update = result.updates[0]!;
      assert.ok(update.content.includes('Rate Limiting'), 'Should include merged content');
    });

    it('processes multiple edit requests in order', async () => {
      const repoId = 'editor-multiple';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create commits for non-existent pages (creates, no LLM needed)
      const timestamp1 = new Date('2024-01-01T10:00:00Z');
      const timestamp2 = new Date('2024-01-15T10:00:00Z');
      await createCommitRecord(repoId, 'commit1', timestamp1);
      await createCommitRecord(repoId, 'commit2', timestamp2);

      // Create pending edits for new pages
      await createPendingEdit(wiki.id, repoId, 'commit1', timestamp1, 'docs/page1', '# Page 1');
      await createPendingEdit(wiki.id, repoId, 'commit2', timestamp2, 'docs/page2', '# Page 2');

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 2);
      // Should process in timestamp order (oldest first)
      assert.strictEqual(result.updates[0]!.path, 'docs/page1');
      assert.strictEqual(result.updates[1]!.path, 'docs/page2');
    });

    it('limits edits per run', async () => {
      const repoId = 'editor-limit';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create many pending edits (more than the limit)
      for (let i = 0; i < 15; i++) {
        const timestamp = new Date(`2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`);
        await createCommitRecord(repoId, `commit${i}`, timestamp);
        await createPendingEdit(wiki.id, repoId, `commit${i}`, timestamp, `docs/page${i}`, `# Page ${i}`);
      }

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should be limited to 10 edits per run
      assert.ok(result.updates.length <= 10, `Should limit to 10 edits, got ${result.updates.length}`);
    });

    it('marks edit requests as processed', async () => {
      const repoId = 'editor-mark-processed';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const timestamp = new Date('2024-01-15T10:00:00Z');
      await createCommitRecord(repoId, 'abc123', timestamp);

      const editRequest = createEditRequest({
        id: 'edit-to-process',
        repoId,
        wikiId: wiki.id,
        sourceCommitSha: 'abc123',
        sourceCommitTimestamp: timestamp,
        sourceAgentType: 'code-change',
        sourceAgentRunId: uuid(),
        targetPagePath: 'docs/new-page',
        proposedUpdateType: 'update',
        proposedContent: '# Content',
        confidenceDelta: 0.1,
      });
      await ctx.repos.editRequests.save(editRequest);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      await agent.runOnWiki(agentCtx);

      // Check that edit request was marked as processed
      const processed = await ctx.repos.editRequests.findById('edit-to-process');
      assert.ok(processed);
      assert.strictEqual(processed.status, 'applied');
      assert.ok(processed.processedAt);
      assert.ok(processed.processingNotes);
    });
  });

  describe('runOnCommit', () => {
    it('throws error when called', async () => {
      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext('any-repo');

      await assert.rejects(
        async () => agent.runOnCommit('any-commit-id', agentCtx),
        /does not run on commits/,
        'Should throw error explaining agent does not run on commits'
      );
    });
  });

  describe('Historical Context handling', () => {
    it('appends to existing Historical Context section', async () => {
      const repoId = 'editor-existing-history';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a newer commit
      const newerTimestamp = new Date('2024-01-15T10:00:00Z');
      const newerCommit = await createCommitRecord(repoId, 'new123', newerTimestamp);

      // Create page with existing Historical Context section
      await createPage(
        wiki.id,
        'existing-page',
        'docs/api',
        'API Docs',
        `# API Documentation

Current implementation uses JWT.

## Historical Context

### 2024-01-10 (prev123)
First version of API.`,
        [newerCommit.sha]
      );

      // Create an older commit and edit request
      const olderTimestamp = new Date('2024-01-05T10:00:00Z');
      await createCommitRecord(repoId, 'old456', olderTimestamp);
      await createPendingEdit(
        wiki.id,
        repoId,
        'old456',
        olderTimestamp,
        'docs/api',
        '# Early API\n\nPrototype phase.'
      );

      // Configure mock LLM to return a HISTORY decision
      ctx.llm.setDefaultResponse(`DECISION: HISTORY
REASONING: Adds context about the prototype phase.
CONTENT: Prototype implementation during early development.`);

      const agent = new WikiEditorAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      assert.strictEqual(result.updates.length, 1);
      const update = result.updates[0]!;

      // Should have both history entries
      assert.ok(update.content.includes('## Historical Context'));
      assert.ok(update.content.includes('prev123'), 'Should preserve existing history');
      assert.ok(update.content.includes('old456'), 'Should add new history entry');
    });
  });
});
