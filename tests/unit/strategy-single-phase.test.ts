/**
 * Unit tests for single-strategy work generation.
 * Verifies that executeStrategies returns work from only ONE strategy per call,
 * preventing mixing of work types.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import {
  executeStrategies,
  type StrategyContext,
} from '../../src/agents/orchestrator/strategies.js';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';
import { createWikiPage } from '../../src/domain/wiki-page.js';

describe('Single Strategy Work Generation', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('executeStrategies returns work from one strategy only', () => {
    it('should not mix work types when multiple strategies could produce work', async () => {
      // Create a repo with multiple directories that could trigger exploration
      // AND conditions that could trigger synthesis/meta agents
      const repoId = 'single-strategy-test-1';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/agents/index.ts': 'export * from "./base";',
        'src/agents/base.ts': 'export class Agent {}',
        'src/services/api.ts': 'export const api = {}',
        'src/utils/helpers.ts': 'export const helper = () => {}',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add some wiki pages to get past bootstrap, but leave exploration work
      // Create pages that would trigger linking and other meta work
      const page1 = createWikiPage({
        id: 'page1',
        wikiId: wiki.id,
        path: 'components/agent',
        title: 'Agent Component',
        content: '# Agent\n\nThis is about agents.',
        links: [], // No links - would trigger link agent
        confidence: 0.5, // Low confidence - would trigger quality agent
      });
      const page2 = createWikiPage({
        id: 'page2',
        wikiId: wiki.id,
        path: 'components/service',
        title: 'Service Component',
        content: '# Service\n\nThis is about services.',
        links: [],
        confidence: 0.5,
      });
      const page3 = createWikiPage({
        id: 'page3',
        wikiId: wiki.id,
        path: 'components/utils',
        title: 'Utils Component',
        content: '# Utils\n\nThis is about utils.',
        links: [],
        confidence: 0.5,
      });

      await ctx.repos.wikiPages.save(page1);
      await ctx.repos.wikiPages.save(page2);
      await ctx.repos.wikiPages.save(page3);

      // Create strategy context with contextGatherer for directory coverage
      const gatherer = new ContextGatherer(ctx.repos);
      const strategyCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        contextGatherer: gatherer,
      };

      // Execute strategies requesting multiple items
      const workItems = await executeStrategies(strategyCtx, 10);

      if (workItems.length === 0) {
        // No work generated is acceptable if nothing needs doing
        return;
      }

      // All work items should be of the same type (from one strategy)
      const workTypes = new Set(workItems.map(w => w.agentType));

      // We allow multiple agent types ONLY if they're from the same strategy
      // For now, the simplest check is that exploration work doesn't mix with commit work
      const hasExplorationWork = workItems.some(w => w.agentType === 'codebase-explorer');
      const hasCommitWork = workItems.some(w =>
        ['code-change', 'security', 'dependency'].includes(w.agentType)
      );
      const hasSynthesisWork = workItems.some(w =>
        ['project-overview', 'getting-started', 'wiki-index', 'overview'].includes(w.agentType)
      );
      const hasMetaWork = workItems.some(w =>
        ['link', 'quality', 'consistency', 'structure', 'consolidation'].includes(w.agentType)
      );

      // Count how many major work categories are present
      const categoriesPresent = [hasExplorationWork, hasCommitWork, hasSynthesisWork, hasMetaWork]
        .filter(Boolean).length;

      assert.ok(
        categoriesPresent <= 1,
        `Work items should come from at most one strategy category. Found ${categoriesPresent} categories: ` +
        `exploration=${hasExplorationWork}, commits=${hasCommitWork}, synthesis=${hasSynthesisWork}, meta=${hasMetaWork}. ` +
        `Work types: ${[...workTypes].join(', ')}`
      );
    });

    it('should return exploration work first when exploration is needed', async () => {
      const repoId = 'single-strategy-test-2';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/deep/nested/file.ts': 'export const x = 1;',
        'src/another/path/code.ts': 'export const y = 2;',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Add minimal pages to get past bootstrap
      const page = createWikiPage({
        id: 'min-page',
        wikiId: wiki.id,
        path: 'overview',
        title: 'Overview',
        content: '# Overview\n\nBasic overview.',
        links: [],
        confidence: 0.8,
      });
      await ctx.repos.wikiPages.save(page);

      const gatherer = new ContextGatherer(ctx.repos);
      const strategyCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        contextGatherer: gatherer,
      };

      const workItems = await executeStrategies(strategyCtx, 5);

      if (workItems.length > 0) {
        // If exploration work exists, it should be the ONLY type returned
        const hasExplorationWork = workItems.some(w => w.agentType === 'codebase-explorer');
        if (hasExplorationWork) {
          const allExploration = workItems.every(w => w.agentType === 'codebase-explorer');
          assert.ok(
            allExploration,
            `When exploration work exists, ALL work should be exploration. Got: ${workItems.map(w => w.agentType).join(', ')}`
          );
        }
      }
    });

    it('should stop after first strategy returns work', async () => {
      const repoId = 'single-strategy-test-3';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': 'export const main = () => {}',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create pages that would trigger multiple strategies
      for (let i = 0; i < 5; i++) {
        const page = createWikiPage({
          id: `page-${i}`,
          wikiId: wiki.id,
          path: `components/item-${i}`,
          title: `Item ${i}`,
          content: `# Item ${i}\n\nDescription of item ${i}.`,
          links: [],
          confidence: 0.6,
        });
        await ctx.repos.wikiPages.save(page);
      }

      const gatherer = new ContextGatherer(ctx.repos);
      const strategyCtx: StrategyContext = {
        repos: ctx.repos,
        repoId,
        wikiId: wiki.id,
        existingWorkKeys: new Set<string>(),
        contextGatherer: gatherer,
      };

      const workItems = await executeStrategies(strategyCtx, 10);

      if (workItems.length > 0) {
        // Verify no mixing - group by strategy category
        const explorationItems = workItems.filter(w => w.agentType === 'codebase-explorer');
        const synthesisItems = workItems.filter(w =>
          ['project-overview', 'getting-started', 'wiki-index', 'overview', 'toc', 'writer', 'testing-guide', 'extension-guide'].includes(w.agentType)
        );
        const metaItems = workItems.filter(w =>
          ['link', 'quality', 'consistency', 'structure', 'consolidation'].includes(w.agentType)
        );
        const commitItems = workItems.filter(w =>
          ['code-change', 'security', 'dependency'].includes(w.agentType)
        );

        const nonEmptyCategories = [explorationItems, synthesisItems, metaItems, commitItems]
          .filter(arr => arr.length > 0);

        assert.ok(
          nonEmptyCategories.length <= 1,
          `Should only have work from one strategy category. ` +
          `Got: exploration=${explorationItems.length}, synthesis=${synthesisItems.length}, ` +
          `meta=${metaItems.length}, commits=${commitItems.length}`
        );
      }
    });
  });
});
