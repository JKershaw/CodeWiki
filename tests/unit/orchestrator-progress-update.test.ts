/**
 * Unit tests for orchestrator progress update feature.
 * Tests that the orchestrator generates a progress summary after each run.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, MockLLMService, type TestContext } from '../helpers/index.js';
import { Orchestrator } from '../../src/agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type { OrchestratorRun } from '../../src/domain/orchestrator-run.js';

describe('Orchestrator Progress Update', () => {
  let ctx: TestContext;
  let mockLLM: MockLLMService;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    mockLLM = new MockLLMService();
  });

  describe('OrchestratorRun progressUpdate field', () => {
    it('should have progressUpdate field in OrchestratorRun interface', async () => {
      // Type check - this test passes if the code compiles
      const run: Partial<OrchestratorRun> = {
        id: 'test',
        progressUpdate: 'Wiki is 50% complete. Major gaps remain in src/services directory.',
      };

      assert.strictEqual(run.progressUpdate, 'Wiki is 50% complete. Major gaps remain in src/services directory.');
    });

    it('should allow progressUpdate to be undefined', async () => {
      const run: Partial<OrchestratorRun> = {
        id: 'test',
      };

      assert.strictEqual(run.progressUpdate, undefined);
    });
  });

  describe('generateProgressUpdate method', () => {
    it('should generate a progress update after LLM orchestrator run', async () => {
      const repoId = 'progress-update-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Mock the orchestrator decision response
      mockLLM.setDefaultResponse(`# Reasoning
Testing progress update feature.

# Work Items
codebase-explorer,src,Document the source directory`);

      // Mock the progress update response
      mockLLM.onPromptContaining('progress summary',
        'Wiki is approximately 20% complete. The src directory has been identified for documentation. ' +
        'Estimated 4-5 more iterations needed to achieve comprehensive coverage.');

      const orchestrator = new Orchestrator(ctx.repos, mockLLM, { useLLM: true });

      // Generate work list (which should also generate progress update)
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Check that a progress update LLM call was made
      const progressCalls = mockLLM.calls.filter(call =>
        call.messages.some(m => m.content.includes('progress summary'))
      );

      assert.strictEqual(progressCalls.length, 1, 'Should make one progress update LLM call');
    });

    it('should store progress update in orchestrator run record', async () => {
      const repoId = 'progress-update-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const expectedProgressUpdate =
        'Wiki documentation is roughly 30% complete. The codebase has good coverage of core modules ' +
        'but lacks documentation for utility functions. Estimated 3 more iterations for comprehensive coverage.';

      // Mock responses
      mockLLM.setDefaultResponse(`# Reasoning
Exploring undocumented code.

# Work Items
codebase-explorer,src,Low coverage directory`);

      mockLLM.onPromptContaining('progress summary', expectedProgressUpdate);

      const orchestrator = new Orchestrator(ctx.repos, mockLLM, { useLLM: true });

      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Fetch the saved orchestrator run
      const runs = await ctx.repos.orchestratorRuns.findByRepo(repoId);
      assert.ok(runs.length > 0, 'Should have saved orchestrator run');

      const latestRun = runs[runs.length - 1]!;
      assert.ok(latestRun.progressUpdate, 'Should have progressUpdate field');
      assert.strictEqual(latestRun.progressUpdate, expectedProgressUpdate);
    });

    it('should generate progress update for deterministic mode too', async () => {
      const repoId = 'progress-update-test-3';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      const expectedProgressUpdate =
        'Wiki is in early stages with 0 pages. Bootstrapping required to initialize documentation.';

      mockLLM.onPromptContaining('progress summary', expectedProgressUpdate);

      // Deterministic mode (useLLM: false)
      const orchestrator = new Orchestrator(ctx.repos, mockLLM, { useLLM: false });

      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Should still generate progress update via LLM
      const progressCalls = mockLLM.calls.filter(call =>
        call.messages.some(m => m.content.includes('progress summary'))
      );

      assert.strictEqual(progressCalls.length, 1, 'Should make progress update call even in deterministic mode');
    });

    it('should handle progress update failure gracefully', async () => {
      const repoId = 'progress-update-test-4';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a mock that throws on progress update calls
      const failingMockLLM = new MockLLMService();
      failingMockLLM.setDefaultResponse(`# Reasoning
Test run.

# Work Items
codebase-explorer,src,Test`);

      // Override complete to throw on progress calls
      const originalComplete = failingMockLLM.complete.bind(failingMockLLM);
      failingMockLLM.complete = async (options) => {
        if (options.messages.some(m => m.content.includes('progress summary'))) {
          throw new Error('Simulated LLM failure');
        }
        return originalComplete(options);
      };

      const orchestrator = new Orchestrator(ctx.repos, failingMockLLM, { useLLM: true });

      // Should not throw - gracefully handles failure
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Work items should still be returned
      assert.ok(Array.isArray(workItems), 'Should return work items despite progress update failure');
    });

    it('should skip progress update when no LLM is available', async () => {
      const repoId = 'progress-update-test-5';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // No LLM provided
      const orchestrator = new Orchestrator(ctx.repos, undefined, { useLLM: false });

      // Should not throw
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 5);
      assert.ok(Array.isArray(workItems), 'Should return work items without LLM');
    });
  });

  describe('progress update prompt', () => {
    it('should include wiki context in progress update prompt', async () => {
      const repoId = 'progress-prompt-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const main = () => {};',
        'src/utils.ts': 'export const helper = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      mockLLM.setDefaultResponse(`# Reasoning
Documenting code.

# Work Items
codebase-explorer,src,Low coverage`);

      mockLLM.onPromptContaining('progress summary', 'Progress update content');

      const orchestrator = new Orchestrator(ctx.repos, mockLLM, { useLLM: true });
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      // Check progress prompt includes context
      const progressCall = mockLLM.calls.find(call =>
        call.messages.some(m => m.content.includes('progress summary'))
      );

      assert.ok(progressCall, 'Should have progress update call');
      const promptContent = progressCall!.messages.map(m => m.content).join(' ');

      // Should include context about wiki state
      assert.ok(
        promptContent.includes('wiki') || promptContent.includes('Wiki'),
        'Progress prompt should mention wiki'
      );
    });

    it('should ask for one paragraph summary', async () => {
      const repoId = 'progress-prompt-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      mockLLM.setDefaultResponse(`# Reasoning
Test.

# Work Items
codebase-explorer,src,Test`);

      mockLLM.onPromptContaining('progress summary', 'One paragraph response');

      const orchestrator = new Orchestrator(ctx.repos, mockLLM, { useLLM: true });
      await orchestrator.generateWorkList(repoId, wiki.id, 5);

      const progressCall = mockLLM.calls.find(call =>
        call.messages.some(m => m.content.includes('progress summary'))
      );

      assert.ok(progressCall, 'Should have progress update call');
      const promptContent = progressCall!.messages.map(m => m.content).join(' ');

      // Should ask for concise response
      assert.ok(
        promptContent.includes('paragraph') || promptContent.includes('brief') || promptContent.includes('concise'),
        'Progress prompt should ask for brief/paragraph response'
      );
    });
  });
});
