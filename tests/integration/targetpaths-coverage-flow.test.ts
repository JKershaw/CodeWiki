/**
 * Integration test to verify that coverage calculation correctly handles
 * targetPaths WITHOUT directory expansion.
 *
 * The key insight is that targetPaths represent "what was requested" (work targets),
 * NOT "what was achieved" (actual documentation). Coverage should only reflect:
 * - filesAccessed: files actually read by agents
 * - filesReferenced: files mentioned in wiki content
 *
 * Directory expansion was causing coverage to spike to 100% when broad directories
 * like "src" were explored - even if the agent only documented a few files.
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

  it('directory targetPaths do NOT expand to cover files (prevents coverage spike)', async () => {
    // Setup: Create a repo with nested directory structure
    const repoId = 'targetpaths-no-expand-test';
    await createTestRepo(ctx, repoId, {
      'src/agents/base-agent.ts': 'export class BaseAgent {}',
      'src/agents/registry.ts': 'export const registry = new Map();',
      'src/agents/orchestrator/phased-orchestrator.ts': 'export class PhasedOrchestrator {}',
      'src/services/llm-service.ts': 'export class LLMService {}',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Verify initial state - all directories undocumented
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const initialContext = await gatherer.gather(repoId, wiki.id);

    const initialAgentsDir = initialContext.undocumentedDirectories.find(d => d.path === 'src/agents');
    assert.ok(initialAgentsDir, 'Initially src/agents should be undocumented');
    assert.strictEqual(initialAgentsDir.undocumentedRatio, 1, 'src/agents should be 100% undocumented initially');

    // Simulate executor setting targetPaths when codebase-explorer explores 'src/agents'
    // NOTE: Only targetPaths is set, NOT filesAccessed or filesReferenced
    const update = {
      type: 'create' as const,
      path: 'agents/overview',
      title: 'Agents Overview',
      content: '# Agents\n\nOverview of the agents directory.',
      agentRunId: uuid(),
      confidenceDelta: 0.3,
      skipValidation: true,
      targetPaths: ['src/agents'],  // Work target - should NOT cause coverage
    };

    const updateResult = await handleUpdateWikiPage(
      createUpdateWikiPageCommand(update),
      ctx.repos,
      wiki.id
    );
    assert.ok(updateResult.success, `Wiki page creation should succeed: ${updateResult.error}`);

    // Verify the wiki page was saved with targetPaths
    const savedPage = await ctx.repos.wikiPages.findByPath(wiki.id, 'agents/overview');
    assert.ok(savedPage, 'Wiki page should exist');
    assert.deepStrictEqual(savedPage.targetPaths, ['src/agents'], 'targetPaths should be saved');

    // Run coverage calculation again
    const afterContext = await gatherer.gather(repoId, wiki.id);

    // KEY ASSERTION: Directory should STILL be undocumented
    // Because targetPaths alone don't contribute to coverage
    const afterAgentsDir = afterContext.undocumentedDirectories.find(d => d.path === 'src/agents');
    assert.ok(afterAgentsDir, 'src/agents should STILL be in undocumented list (targetPaths do not expand)');
    assert.strictEqual(afterAgentsDir.undocumentedRatio, 1, 'src/agents should still be 100% undocumented');
  });

  it('coverage requires filesAccessed or filesReferenced, not just targetPaths', async () => {
    const repoId = 'targetpaths-vs-files-test';
    await createTestRepo(ctx, repoId, {
      'src/a/file1.ts': 'export const a1 = 1;',
      'src/a/file2.ts': 'export const a2 = 2;',
      'src/b/file3.ts': 'export const b1 = 1;',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create page with targetPaths AND actual file documentation
    const update = {
      type: 'create' as const,
      path: 'overview',
      title: 'Overview',
      content: '# Overview\n\nProject overview documenting file1.ts.',
      agentRunId: uuid(),
      confidenceDelta: 0.3,
      skipValidation: true,
      targetPaths: ['src/a'],  // Work target (informational only)
      filesAccessed: ['src/a/file1.ts'],  // Actually read this file
    };

    await handleUpdateWikiPage(createUpdateWikiPageCommand(update), ctx.repos, wiki.id);

    // Verify coverage
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const context = await gatherer.gather(repoId, wiki.id);

    // src/a should still be in undocumented list but with reduced ratio
    // because only file1.ts is covered (via filesAccessed), not file2.ts
    const aDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/a');
    assert.ok(aDirAfter, 'src/a should still be partially undocumented');
    assert.strictEqual(aDirAfter.undocumentedRatio, 0.5, 'src/a should be 50% undocumented (1 of 2 files covered)');

    // src/b should be completely undocumented
    const bDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/b');
    assert.ok(bDirAfter, 'src/b should be undocumented');
    assert.strictEqual(bDirAfter.undocumentedRatio, 1, 'src/b should be 100% undocumented');
  });

  it('filesAccessed and filesReferenced accumulate to build coverage', async () => {
    const repoId = 'files-accumulate-test';
    await createTestRepo(ctx, repoId, {
      'src/domain/repo.ts': 'export interface Repo {}',
      'src/domain/wiki.ts': 'export interface Wiki {}',
      'src/services/git.ts': 'export class GitService {}',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create first page with filesAccessed
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'create',
        path: 'domain/overview',
        title: 'Domain Overview',
        content: '# Domain\n\nDomain entities.',
        agentRunId: uuid(),
        confidenceDelta: 0.3,
        skipValidation: true,
        filesAccessed: ['src/domain/repo.ts'],  // Actual file coverage
      }),
      ctx.repos,
      wiki.id
    );

    // Create second page - filesReferenced is extracted from content
    // The content must actually reference the file path for it to be tracked
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'create',
        path: 'services/overview',
        title: 'Services Overview',
        content: '# Services\n\nService layer implementation in `src/services/git.ts`.',
        agentRunId: uuid(),
        confidenceDelta: 0.3,
        skipValidation: true,
      }),
      ctx.repos,
      wiki.id
    );

    // Verify coverage from multiple pages
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const context = await gatherer.gather(repoId, wiki.id);

    // src/domain should be partially documented (1 of 2 files)
    const domainDir = context.undocumentedDirectories.find(d => d.path === 'src/domain');
    assert.ok(domainDir, 'src/domain should be partially undocumented');
    assert.strictEqual(domainDir.undocumentedRatio, 0.5, 'src/domain should be 50% undocumented');

    // src/services should be fully documented (1 of 1 files)
    const servicesDir = context.undocumentedDirectories.find(d => d.path === 'src/services');
    assert.strictEqual(servicesDir, undefined, 'src/services should be fully covered');
  });

  it('targetPaths still accumulate across updates (for informational purposes)', async () => {
    const repoId = 'targetpaths-accumulate-info-test';
    await createTestRepo(ctx, repoId, {
      'src/a/file1.ts': 'export const a1 = 1;',
      'src/b/file2.ts': 'export const b1 = 1;',
    });
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create page targeting 'src/a'
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'create',
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nProject overview.',
        agentRunId: uuid(),
        confidenceDelta: 0.3,
        skipValidation: true,
        targetPaths: ['src/a'],
      }),
      ctx.repos,
      wiki.id
    );

    // Update the same page, adding 'src/b' to targetPaths
    await handleUpdateWikiPage(
      createUpdateWikiPageCommand({
        type: 'update',
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nUpdated project overview.',
        agentRunId: uuid(),
        confidenceDelta: 0.1,
        skipValidation: true,
        targetPaths: ['src/b'],
      }),
      ctx.repos,
      wiki.id
    );

    // Verify targetPaths accumulated (for tracking purposes)
    const page = await ctx.repos.wikiPages.findByPath(wiki.id, 'overview');
    assert.ok(page, 'Page should exist');
    assert.ok(page.targetPaths.includes('src/a'), 'targetPaths should include src/a');
    assert.ok(page.targetPaths.includes('src/b'), 'targetPaths should include src/b');

    // But coverage should still be 0% since no filesAccessed/filesReferenced
    const gatherer = new ContextGatherer(ctx.repos, ctx.repoAccessFactory);
    const context = await gatherer.gather(repoId, wiki.id);

    // Both directories should still be undocumented
    const aDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/a');
    const bDirAfter = context.undocumentedDirectories.find(d => d.path === 'src/b');

    assert.ok(aDirAfter, 'src/a should still be undocumented (targetPaths do not count)');
    assert.ok(bDirAfter, 'src/b should still be undocumented (targetPaths do not count)');
  });
});
