/**
 * Integration tests confirming Orchestrator does NOT handle pending edits.
 * Edit request processing has been moved to the Executor for simpler architecture.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { Orchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createEditRequest, createCommitEditSource } from '../../src/domain/edit-request.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('Orchestrator No Edit Handling', () => {
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
   * Helper to create pending edit requests.
   */
  async function createPendingEdits(
    wikiId: string,
    repoId: string,
    count: number
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      const editRequest = createEditRequest({
        id: uuid(),
        repoId,
        wikiId,
        source: createCommitEditSource(`commit${i}`, new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: uuid(),
        targetPagePath: `docs/page-${i}`,
        proposedUpdateType: 'create',
        proposedContent: `# Page ${i}`,
        confidenceDelta: 0.1,
      });
      await ctx.repos.editRequests.save(editRequest);
    }
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

  describe('generateWorkList', () => {
    it('does not generate wiki-editor work items for pending edits', async () => {
      const repoId = 'orchestrator-no-wiki-editor';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create many pending edits (more than old threshold of 5)
      await createPendingEdits(wiki.id, repoId, 10);

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should NOT include wiki-editor work items
      const wikiEditorItems = workItems.filter(w => w.agentType === 'wiki-editor');
      assert.strictEqual(
        wikiEditorItems.length,
        0,
        'Orchestrator should not generate wiki-editor work items for pending edits'
      );
    });

    it('ignores pending edit request count entirely', async () => {
      const repoId = 'orchestrator-ignores-edits';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create 100 pending edits - Orchestrator should still not care
      await createPendingEdits(wiki.id, repoId, 100);

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should not have wiki-editor, regardless of how many edits are pending
      const wikiEditorItems = workItems.filter(w => w.agentType === 'wiki-editor');
      assert.strictEqual(
        wikiEditorItems.length,
        0,
        'Orchestrator should ignore pending edit count'
      );
    });

    it('continues to generate other work types normally', async () => {
      const repoId = 'orchestrator-other-work';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a wiki page so bootstrap doesn't trigger
      await createPage(wiki.id, 'overview', '# Overview\n\nExisting content.');

      // Create some pending edits
      await createPendingEdits(wiki.id, repoId, 5);

      // Create a commit that needs processing
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

      const orchestrator = new Orchestrator(ctx.repos, ctx.llm);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should still generate other work (e.g., code-change for the commit)
      // even though pending edits exist
      assert.ok(workItems.length > 0, 'Should generate other work items');

      // But NOT wiki-editor
      const wikiEditorItems = workItems.filter(w => w.agentType === 'wiki-editor');
      assert.strictEqual(wikiEditorItems.length, 0, 'Should not include wiki-editor');
    });
  });
});
