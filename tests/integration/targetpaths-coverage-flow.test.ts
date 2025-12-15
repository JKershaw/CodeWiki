/**
 * Integration test to verify that targetPaths set by the executor
 * correctly flow through to coverage calculation.
 *
 * This test simulates the production flow:
 * 1. Executor processes codebase-explorer work item
 * 2. Wiki page is created with targetPaths = [directory path]
 * 3. Coverage calculation runs
 * 4. Directory should show reduced undocumented ratio
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';
import { handleUpdateWikiPage, createUpdateWikiPageCommand } from '../../src/commands/update-wiki-page.js';

describe('targetPaths Coverage Flow Integration', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('directory targetPath without trailing slash covers all files in subdirectories', async () => {
    // Setup: Create a repo with nested directory structure
    const repoId = 'targetpaths-subdir-test';
    await createTestRepo(ctx, repoId, {
      // Files in src/agents (direct children)
      'src/agents/base-agent.ts': 'export class BaseAgent {}',
      'src/agents/registry.ts': 'export const registry = new Map();',
      // Files in src/agents/orchestrator (nested subdirectory)
      'src/agents/orchestrator/phased-orchestrator.ts': 'export class PhasedOrchestrator {}',
      'src/agents/orchestrator/context-gatherer.ts': 'export class ContextGatherer {}',
      // Files in src/services (different directory - should remain undocumented)
      'src/services/llm-service.ts': 'export class LLMService {}',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Step 1: Verify initial state - all directories undocumented
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const initialContext = await gatherer.gather(repoId, wiki.id);

    // Should have undocumented directories
    const initialAgentsDir = initialContext.undocumentedDirectories.find(d => d.path === 'src/agents');
    const initialOrchestratorDir = initialContext.undocumentedDirectories.find(d => d.path === 'src/agents/orchestrator');
    const initialServicesDir = initialContext.undocumentedDirectories.find(d => d.path === 'src/services');

    assert.ok(initialAgentsDir, 'Initially src/agents should be undocumented');
    assert.ok(initialOrchestratorDir, 'Initially src/agents/orchestrator should be undocumented');
    assert.ok(initialServicesDir, 'Initially src/services should be undocumented');
    assert.strictEqual(initialAgentsDir.undocumentedRatio, 1, 'src/agents should be 100% undocumented initially');
    assert.strictEqual(initialOrchestratorDir.undocumentedRatio, 1, 'src/agents/orchestrator should be 100% undocumented initially');

    // Step 2: Simulate what executor does - create wiki page with targetPaths
    // This simulates: codebase-explorer explores 'src/agents' and executor sets targetPaths
    const update = {
      type: 'create' as const,
      path: 'agents/overview',
      title: 'Agents Overview',
      content: '# Agents\n\nOverview of the agents directory. This module contains all the agent implementations for processing commits, analyzing code, and generating documentation. Each agent has a specific responsibility and follows a common interface.',
      agentRunId: uuid(),
      confidenceDelta: 0.3,
      skipValidation: true,  // Skip content validation for testing
      // This is what the executor sets at line 623-625:
      targetPaths: ['src/agents'],  // No trailing slash - should still cover subdirs
    };

    const updateResult = await handleUpdateWikiPage(
      createUpdateWikiPageCommand(update),
      ctx.repos,
      wiki.id
    );
    assert.ok(updateResult.success, `Wiki page creation should succeed: ${updateResult.error}`);

    // Step 3: Verify the wiki page was saved with targetPaths
    const savedPage = await ctx.repos.wikiPages.findByPath(wiki.id, 'agents/overview');
    assert.ok(savedPage, 'Wiki page should exist');
    assert.deepStrictEqual(savedPage.targetPaths, ['src/agents'], 'targetPaths should be saved');

    // Step 4: Run coverage calculation again
    const afterContext = await gatherer.gather(repoId, wiki.id);

    // Step 5: Verify coverage changed
    // With targetPaths = ['src/agents'], ALL files under src/agents/ should be covered
    // This includes files in src/agents/orchestrator/
    const afterAgentsDir = afterContext.undocumentedDirectories.find(d => d.path === 'src/agents');
    const afterOrchestratorDir = afterContext.undocumentedDirectories.find(d => d.path === 'src/agents/orchestrator');
    const afterServicesDir = afterContext.undocumentedDirectories.find(d => d.path === 'src/services');

    // src/agents should be fully covered (not in undocumented list)
    assert.strictEqual(
      afterAgentsDir,
      undefined,
      'src/agents should NOT be in undocumented list after targetPaths expansion'
    );

    // src/agents/orchestrator should ALSO be fully covered (via parent directory targetPath)
    assert.strictEqual(
      afterOrchestratorDir,
      undefined,
      'src/agents/orchestrator should NOT be in undocumented list (covered via parent targetPath)'
    );

    // src/services should still be undocumented
    assert.ok(afterServicesDir, 'src/services should still be undocumented');
    assert.strictEqual(afterServicesDir.undocumentedRatio, 1, 'src/services should be 100% undocumented');
  });

  it('targetPaths accumulate across multiple wiki page updates', async () => {
    const repoId = 'targetpaths-accumulate-test';
    await createTestRepo(ctx, repoId, {
      'src/a/file1.ts': 'export const a1 = 1;',
      'src/b/file2.ts': 'export const b1 = 1;',
      'src/c/file3.ts': 'export const c1 = 1;',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create page targeting 'src/a'
    const update1 = {
      type: 'create' as const,
      path: 'overview',
      title: 'Overview',
      content: '# Overview\n\nProject overview.',
      agentRunId: uuid(),
      confidenceDelta: 0.3,
      skipValidation: true,
      targetPaths: ['src/a'],
    };

    await handleUpdateWikiPage(createUpdateWikiPageCommand(update1), ctx.repos, wiki.id);

    // Update the same page, adding 'src/b' to targetPaths
    const update2 = {
      type: 'update' as const,
      path: 'overview',
      title: 'Overview',
      content: '# Overview\n\nUpdated project overview.',
      agentRunId: uuid(),
      confidenceDelta: 0.1,
      skipValidation: true,
      targetPaths: ['src/b'],
    };

    await handleUpdateWikiPage(createUpdateWikiPageCommand(update2), ctx.repos, wiki.id);

    // Verify targetPaths accumulated
    const page = await ctx.repos.wikiPages.findByPath(wiki.id, 'overview');
    assert.ok(page, 'Page should exist');
    assert.ok(page.targetPaths.includes('src/a'), 'targetPaths should include src/a');
    assert.ok(page.targetPaths.includes('src/b'), 'targetPaths should include src/b');

    // Verify coverage
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const context = await gatherer.gather(repoId, wiki.id);

    // src/a and src/b should be covered
    const aDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/a');
    const bDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/b');
    const cDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/c');

    assert.strictEqual(aDirAfter, undefined, 'src/a should be covered');
    assert.strictEqual(bDirAfter, undefined, 'src/b should be covered');
    assert.ok(cDirAfter, 'src/c should still be undocumented');
  });

  it('coverage calculation correctly uses targetPaths from multiple wiki pages', async () => {
    const repoId = 'targetpaths-multi-page-test';
    await createTestRepo(ctx, repoId, {
      'src/domain/repo.ts': 'export interface Repo {}',
      'src/domain/wiki.ts': 'export interface Wiki {}',
      'src/services/git.ts': 'export class GitService {}',
      'src/services/llm.ts': 'export class LLMService {}',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create first page targeting domain
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'create',
        path: 'domain/overview',
        title: 'Domain Overview',
        content: '# Domain\n\nDomain entities.',
        agentRunId: uuid(),
        confidenceDelta: 0.3,
        skipValidation: true,
        targetPaths: ['src/domain'],
      }),
      ctx.repos,
      wiki.id
    );

    // Create second page targeting services
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'create',
        path: 'services/overview',
        title: 'Services Overview',
        content: '# Services\n\nService layer.',
        agentRunId: uuid(),
        confidenceDelta: 0.3,
        skipValidation: true,
        targetPaths: ['src/services'],
      }),
      ctx.repos,
      wiki.id
    );

    // Verify all directories are covered
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const context = await gatherer.gather(repoId, wiki.id);

    // Both directories should be covered (not in undocumented list)
    const domainDir = context.undocumentedDirectories.find(d => d.path === 'src/domain');
    const servicesDir = context.undocumentedDirectories.find(d => d.path === 'src/services');

    assert.strictEqual(domainDir, undefined, 'src/domain should be covered');
    assert.strictEqual(servicesDir, undefined, 'src/services should be covered');

    // No undocumented directories should remain
    assert.strictEqual(
      context.undocumentedDirectories.length,
      0,
      'All directories should be covered'
    );
  });
});
