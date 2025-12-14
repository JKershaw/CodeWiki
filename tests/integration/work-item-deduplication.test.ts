/**
 * Integration tests for work item deduplication.
 *
 * Tests that concurrent orchestrator calls don't create duplicate work items
 * for the same target.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { PhasedOrchestrator } from '../../src/agents/orchestrator/phased-orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createWikiPage } from '../../src/domain/wiki-page.js';
import { createWorkItem, createPathTarget, createCommitTarget, generateWorkItemId } from '../../src/domain/work-item.js';
import { createSaveWorkItemsCommand, handleSaveWorkItems } from '../../src/commands/work-queue.js';

describe('Work Item Deduplication', () => {
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

  describe('Concurrent orchestrator calls', () => {
    it('should not create duplicate work items when called concurrently', async () => {
      const repoId = 'dedup-concurrent-test';

      // Create a repo with some undocumented directories
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
        'src/services/auth.ts': 'export const auth = {};',
        'src/services/db.ts': 'export const db = {};',
        'src/utils/helpers.ts': 'export const helper = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add some pages to get past bootstrap phase
      for (let i = 0; i < 5; i++) {
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `docs/page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nContent.`,
          confidence: 0.6,
        }));
      }

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);

      // Call generateWorkList twice concurrently - simulating the race condition
      const [workItems1, workItems2] = await Promise.all([
        orchestrator.generateWorkList(repoId, wiki.id, 10),
        orchestrator.generateWorkList(repoId, wiki.id, 10),
      ]);

      // Both calls should return work items
      assert.ok(workItems1.length > 0, 'First call should generate work items');
      assert.ok(workItems2.length > 0, 'Second call should generate work items');

      // Get all pending work items from the queue
      const allPendingWork = await ctx.repos.workQueue.findPending(repoId);

      // Extract work keys to check for duplicates
      const workKeys = allPendingWork.map(w => {
        if (w.target.type === 'commit') {
          return `${w.agentType}:commit:${w.target.commitId}`;
        } else if (w.target.type === 'path') {
          return `${w.agentType}:path:${w.target.path}`;
        } else {
          return `${w.agentType}:wiki`;
        }
      });

      // Check for duplicates
      const uniqueKeys = new Set(workKeys);
      assert.strictEqual(
        workKeys.length,
        uniqueKeys.size,
        `Found duplicate work items: ${workKeys.filter((k, i) => workKeys.indexOf(k) !== i).join(', ')}`
      );
    });

    it('should deduplicate work items with same target across saves', async () => {
      const repoId = 'dedup-save-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create two work items with the same logical target using deterministic IDs
      const target = createPathTarget('src/services');
      const workItem1 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target),
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      const workItem2 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target), // Same deterministic ID!
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      // Save both - second save should overwrite the first (same ID)
      await ctx.repos.workQueue.save(workItem1);
      await ctx.repos.workQueue.save(workItem2);

      // Should only have one work item for this target
      const allWork = await ctx.repos.workQueue.findPending(repoId);
      const explorerWork = allWork.filter(
        w => w.agentType === 'codebase-explorer' &&
             w.target.type === 'path' &&
             w.target.path === 'src/services'
      );

      assert.strictEqual(
        explorerWork.length,
        1,
        `Expected 1 work item for src/services, got ${explorerWork.length}`
      );
    });
  });

  describe('Deterministic work item IDs', () => {
    it('should generate the same ID for the same work target', async () => {
      const repoId = 'dedup-id-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Create two work items with same target using deterministic ID generation
      const target = createCommitTarget('abc123');
      const workItem1 = createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', target),
        repoId,
        agentType: 'code-change',
        target,
      });

      const workItem2 = createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', target),
        repoId,
        agentType: 'code-change',
        target,
      });

      // With deterministic IDs, both work items should have the same ID
      assert.strictEqual(
        workItem1.id,
        workItem2.id,
        'Work items with same target should have same deterministic ID'
      );
    });
  });

  describe('In-progress work protection', () => {
    it('should not overwrite pending work items when saving duplicates via command', async () => {
      const repoId = 'dedup-pending-protection-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Create and save a work item
      const target = createPathTarget('src/services');
      const workItem1 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target),
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      await handleSaveWorkItems(createSaveWorkItemsCommand([workItem1]), ctx.repos);

      // Try to save another work item with the same ID via command
      const workItem2 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target),
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      const result = await handleSaveWorkItems(createSaveWorkItemsCommand([workItem2]), ctx.repos);

      // Should report 0 items saved (skipped because pending already exists)
      assert.strictEqual(result.data, 0, 'Should skip saving duplicate pending work item');

      // Should still have exactly one work item
      const allWork = await ctx.repos.workQueue.findPending(repoId);
      assert.strictEqual(allWork.length, 1, 'Should have exactly one work item');
    });

    it('should not overwrite claimed work items when saving duplicates', async () => {
      const repoId = 'dedup-claimed-protection-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      // Create, save, and claim a work item
      const target = createPathTarget('src/utils');
      const workItem1 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target),
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      await ctx.repos.workQueue.save(workItem1);
      const claimed = await ctx.repos.workQueue.claimNext(repoId);
      assert.ok(claimed, 'Should have claimed work item');
      assert.strictEqual(claimed.status, 'claimed');

      // Try to save a new work item with the same ID
      const workItem2 = createWorkItem({
        id: generateWorkItemId(repoId, 'codebase-explorer', target),
        repoId,
        agentType: 'codebase-explorer',
        target,
      });

      const result = await handleSaveWorkItems(createSaveWorkItemsCommand([workItem2]), ctx.repos);

      // Should report 0 items saved (skipped because claimed already exists)
      assert.strictEqual(result.data, 0, 'Should skip saving duplicate claimed work item');

      // The existing item should still be claimed, not overwritten
      const existingItem = await ctx.repos.workQueue.findById(workItem1.id);
      assert.ok(existingItem, 'Work item should still exist');
      assert.strictEqual(existingItem.status, 'claimed', 'Work item should still be claimed');
    });
  });
});
