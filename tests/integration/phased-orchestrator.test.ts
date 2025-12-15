/**
 * Integration tests for PhasedOrchestrator work generation.
 * Tests that each phase generates appropriate work items.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { PhasedOrchestrator } from '../../src/agents/orchestrator/phased-orchestrator.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createWikiPage } from '../../src/domain/wiki-page.js';

describe('PhasedOrchestrator Integration', () => {
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

  describe('Orchestrator Run Recording', () => {
    it('records orchestrator run when generating work items', async () => {
      const repoId = 'phased-recording-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const x = 1;',
        'src/utils/helpers.ts': 'export const helper = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add some pages to get past bootstrap
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
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should have generated some work
      assert.ok(workItems.length > 0, 'Should generate work items');

      // Should have recorded an orchestrator run
      const runs = await ctx.repos.orchestratorRuns.findByRepo(repoId, { limit: 10 });
      assert.ok(runs.length > 0, 'Should have recorded orchestrator run');

      const latestRun = runs[0]!;
      assert.ok(latestRun.decision.reasoning.includes('Phase'), 'Reasoning should include phase info');
      assert.strictEqual(latestRun.usedLLM, false, 'Should not use LLM');
      assert.ok(latestRun.model.startsWith('phased-orchestrator:'), 'Model should indicate phased orchestrator');
      assert.ok(latestRun.workItemsCreated.length > 0, 'Should record work items created');
      assert.ok(latestRun.decision.workItems.length > 0, 'Should record work item details');
    });

    it('records bootstrap decision with proper reasoning', async () => {
      const repoId = 'phased-bootstrap-recording';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      assert.strictEqual(workItems[0]?.agentType, 'bootstrap', 'Should schedule bootstrap');

      // Check that bootstrap decision was recorded
      const runs = await ctx.repos.orchestratorRuns.findByRepo(repoId, { limit: 10 });
      assert.ok(runs.length > 0, 'Should have recorded orchestrator run');

      const latestRun = runs[0]!;
      assert.ok(latestRun.decision.reasoning.includes('Bootstrap'), 'Reasoning should mention bootstrap');
      assert.ok(latestRun.decision.reasoning.includes('empty'), 'Reasoning should mention empty wiki');
    });
  });

  describe('Phase 0: Reconnaissance', () => {
    it('schedules bootstrap on empty wiki', async () => {
      const repoId = 'phased-recon-bootstrap';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      assert.ok(workItems.length > 0, 'Should generate work items');
      assert.strictEqual(workItems[0]?.agentType, 'bootstrap', 'First item should be bootstrap');
    });

    it('analyzes recent commits after bootstrap exists', async () => {
      const repoId = 'phased-recon-commits';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/index.ts': 'export const x = 1;',
      });

      // Add commits
      for (let i = 0; i < 5; i++) {
        const sha = await addCommit(ctx, repoId, {
          [`src/file${i}.ts`]: `export const val${i} = ${i};`,
        }, `Add file ${i}`);

        await ctx.repos.commits.save({
          id: sha,
          repoId,
          sha,
          message: `Add file ${i}`,
          authorName: 'Test',
          authorEmail: 'test@test.com',
          committedAt: new Date(Date.now() - i * 1000), // Recent commits
          diffSummary: { filesAdded: 1, filesModified: 0, filesDeleted: 0, linesAdded: 1, linesDeleted: 0, affectedFiles: [`src/file${i}.ts`] },
          processedBy: [],
          createdAt: new Date(),
        });
      }

      // Mark bootstrap as completed
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.agentRuns.save({
        id: 'bootstrap-run',
        repoId,
        agentType: 'bootstrap',
        status: 'completed',
        target: { type: 'wiki' },
        startedAt: new Date(),
        completedAt: new Date(),
        requestedUpdates: [],
        createdAt: new Date(),
      });

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should include code-change for recent commits
      const codeChangeItems = workItems.filter(w => w.agentType === 'code-change');
      assert.ok(codeChangeItems.length > 0, 'Should schedule code-change for recent commits');
    });
  });

  describe('Phase 1: Skeleton', () => {
    it('prioritizes exploration when few pages exist', async () => {
      const repoId = 'phased-skeleton-explore';

      await createTestRepo(ctx, repoId, {
        'src/core/index.ts': 'export * from "./main";',
        'src/core/main.ts': 'export function main() {}',
        'src/utils/helpers.ts': 'export const helper = () => {};',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add a few pages (less than 10)
      for (let i = 0; i < 5; i++) {
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `docs/page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nContent for page ${i}. This is some substantial documentation content that explains things in detail.`,
          confidence: 0.6,
        }));
      }

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should prioritize exploration
      const explorerItems = workItems.filter(w => w.agentType === 'codebase-explorer');
      assert.ok(explorerItems.length > 0, 'Should schedule codebase-explorer');
    });
  });

  describe('Phase 2: Breadth', () => {
    it('schedules exploration and commit work in breadth phase', async () => {
      const repoId = 'phased-breadth-allocation';

      await createTestRepo(ctx, repoId, {
        'src/agents/index.ts': 'export * from "./base";',
        'src/services/index.ts': 'export * from "./main";',
        'src/utils/index.ts': 'export * from "./helpers";',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add 15 pages (enough to be past skeleton, but < 25)
      for (let i = 0; i < 15; i++) {
        const category = i < 5 ? 'agents' : i < 10 ? 'services' : 'utils';
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `${category}/page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nContent for page ${i}. This is documentation content.`,
          confidence: 0.5,
        }));
      }

      // Add some commits
      for (let i = 0; i < 10; i++) {
        const sha = `commit-${i}`;
        await ctx.repos.commits.save({
          id: sha,
          repoId,
          sha,
          message: `Commit ${i}`,
          authorName: 'Test',
          authorEmail: 'test@test.com',
          committedAt: new Date(Date.now() - i * 86400000),
          diffSummary: { filesAdded: 1, filesModified: 0, filesDeleted: 0, linesAdded: 10, linesDeleted: 0, affectedFiles: ['src/file.ts'] },
          processedBy: [],
          createdAt: new Date(),
        });
      }

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should generate some work (exploration or commits)
      assert.ok(workItems.length > 0, 'Should generate work items');

      // Should include either exploration or commit work
      const explorerCount = workItems.filter(w => w.agentType === 'codebase-explorer').length;
      const commitCount = workItems.filter(w => w.agentType === 'code-change').length;
      assert.ok(explorerCount > 0 || commitCount > 0, 'Should schedule exploration or commit work');
    });
  });

  describe('Phase 3: Depth and Guides', () => {
    it('schedules synthesis agents when key pages missing', async () => {
      const repoId = 'phased-depth-guides';

      // Create source files matching the wiki page categories
      // 5 directories with 7 files each = 35 total files
      const sourceFiles: Record<string, string> = {};
      const categories = ['agents', 'services', 'utils', 'core', 'api'];
      for (let i = 0; i < 35; i++) {
        const category = categories[i % 5];
        sourceFiles[`src/${category}/file${i}.ts`] = `export const val${i} = ${i};`;
      }
      await createTestRepo(ctx, repoId, sourceFiles);

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add 35+ wiki pages that properly cover the source files
      // Use filesReferenced for graduated coverage scoring
      // Each page needs substantial content to exceed LOW_COVERAGE_THRESHOLD (40%)
      for (let i = 0; i < 35; i++) {
        const category = categories[i % 5];
        // Use filesReferenced with enough content for coverage
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `${category}/file${i}`,
          title: `File ${i} Documentation`,
          content: 'x'.repeat(200), // 200 chars per file to ensure coverage exceeds threshold
          confidence: 0.65,
          filesReferenced: [`src/${category}/file${i}.ts`],
        }));
      }

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should include synthesis agents for missing key pages
      const synthesisTypes = ['project-overview', 'getting-started', 'testing-guide', 'extension-guide'];
      const synthesisItems = workItems.filter(w => synthesisTypes.includes(w.agentType));
      assert.ok(synthesisItems.length > 0, 'Should schedule synthesis agents for missing key pages');
    });
  });

  describe('Phase 4: Polish', () => {
    it('schedules quality agents when wiki has findings', async () => {
      const repoId = 'phased-polish-quality';

      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add 45+ high-confidence pages (to pass Phase 3's avgConfidence check)
      for (let i = 0; i < 45; i++) {
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `docs/page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nContent.`,
          confidence: 0.75, // High confidence
        }));
      }

      // Add key pages
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'overview',
        wikiId: wiki.id,
        path: 'architecture/overview',
        title: 'Overview',
        content: '# Overview\n\nProject overview.',
        confidence: 0.8,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'getting-started',
        wikiId: wiki.id,
        path: 'guides/getting-started',
        title: 'Getting Started',
        content: '# Getting Started\n\nGuide.',
        confidence: 0.8,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'testing',
        wikiId: wiki.id,
        path: 'guides/testing',
        title: 'Testing',
        content: '# Testing\n\nGuide.',
        confidence: 0.8,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'extension',
        wikiId: wiki.id,
        path: 'guides/extension-patterns',
        title: 'Extension',
        content: '# Extension\n\nGuide.',
        confidence: 0.8,
      }));

      // Add many findings (> 5 to trigger Polish phase)
      for (let i = 0; i < 8; i++) {
        await ctx.repos.findings.save({
          id: `finding-${i}`,
          wikiId: wiki.id,
          type: 'quality',
          severity: 'medium',
          message: `Quality issue ${i}`,
          pagePath: `docs/page-${i}`,
          status: 'open',
          createdAt: new Date(),
        });
      }

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should generate work items
      assert.ok(workItems.length > 0, 'Should generate work items');

      // With many findings, should include quality/meta agents or consolidation
      const qualityTypes = ['quality', 'consistency', 'writer', 'consolidation', 'codebase-explorer'];
      const relevantItems = workItems.filter(w => qualityTypes.includes(w.agentType));
      assert.ok(relevantItems.length > 0, 'Should schedule quality-related agents');
    });
  });

  describe('Phase 5: Maintenance', () => {
    it('generates minimal work when wiki is complete', async () => {
      const repoId = 'phased-maintenance';

      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const x = 1;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add 50+ high-confidence pages
      for (let i = 0; i < 55; i++) {
        await ctx.repos.wikiPages.save(createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `docs/page-${i}`,
          title: `Page ${i}`,
          content: `# Page ${i}\n\nComprehensive documentation content for page ${i} with examples and links.`,
          confidence: 0.85,
          links: [`docs/page-${(i + 1) % 55}`],
        }));
      }

      // Add all key pages
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'overview', wikiId: wiki.id, path: 'architecture/overview',
        title: 'Overview', content: '# Overview', confidence: 0.9,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'getting-started', wikiId: wiki.id, path: 'guides/getting-started',
        title: 'Getting Started', content: '# Getting Started', confidence: 0.9,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'testing', wikiId: wiki.id, path: 'guides/testing',
        title: 'Testing', content: '# Testing', confidence: 0.9,
      }));
      await ctx.repos.wikiPages.save(createWikiPage({
        id: 'extension', wikiId: wiki.id, path: 'guides/extension-patterns',
        title: 'Extension', content: '# Extension', confidence: 0.9,
      }));

      const orchestrator = new PhasedOrchestrator(ctx.repos, ctx.llm, {}, ctx.repoAccessFactory);
      const workItems = await orchestrator.generateWorkList(repoId, wiki.id, 10);

      // Should generate minimal work (1-3 items max)
      assert.ok(workItems.length <= 3, `Maintenance should generate few items, got ${workItems.length}`);
    });
  });
});
