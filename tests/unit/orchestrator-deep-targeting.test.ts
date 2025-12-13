/**
 * Unit tests for Orchestrator strategy deep directory targeting.
 *
 * These tests verify that the codebaseExplorationStrategy prefers targeting
 * directories with more undocumented files over those that are better covered.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { codebaseExplorationStrategy } from '../../src/agents/orchestrator/strategies.js';
import type { StrategyContext } from '../../src/agents/orchestrator/strategies.js';
import type { UndocumentedDirectory, OrchestratorContext } from '../../src/agents/orchestrator/context-gatherer.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock StrategyContext with specified undocumented directories.
 */
function createMockStrategyContext(
  undocumentedDirectories: UndocumentedDirectory[],
  options?: {
    wikiPageCount?: number;
  }
): StrategyContext {
  const { wikiPageCount = 10 } = options ?? {};

  const mockOrchestratorContext: OrchestratorContext = {
    totalCommits: 10,
    commitsByAgent: {},
    recentCommits: [],
    wikiPages: wikiPageCount,
    categoryCounts: {},
    categoriesWithOverview: [],
    categoriesWithoutOverview: [],
    pagesNeedingRewrite: 0,
    avgConfidence: 0.7,
    lowConfidencePages: 0,
    recentRuns: [],
    pagesWithoutLinks: 0,
    pagesWithoutLinksList: [],
    shallowPages: 0,
    shallowPagesList: [],
    pagesLackingExamples: 0,
    pagesLackingExamplesList: [],
    hasProjectOverview: true,
    hasGettingStarted: true,
    hasTestingGuide: false,
    hasExtensionGuide: false,
    undocumentedDirectories,
    lowCoverageFiles: [],
    fileCoverageTree: null,
    projectOverviewContent: null,
    pendingEditRequests: 0,
  };

  return {
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    repos: {} as any,
    existingWorkKeys: new Set(),
    contextGatherer: {
      gather: mock.fn(async () => mockOrchestratorContext),
      formatForPrompt: mock.fn(() => ''),
    } as any,
  };
}

describe('Orchestrator Deep Directory Targeting', () => {
  describe('codebaseExplorationStrategy', () => {
    it('should prefer directories with higher undocumented ratio', async () => {
      // Scenario: src/agents/analysis has 100% undocumented, src/services has 50%
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents/analysis', totalFiles: 4, undocumentedCount: 4, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      const result = await codebaseExplorationStrategy(ctx, 5);

      // Should have created work items
      assert.ok(result.workItems.length > 0, 'Should create work items');

      // The first work item should target the directory with highest undocumented ratio
      const firstTarget = result.workItems[0];
      assert.ok(firstTarget, 'Should have at least one work item');

      const targetPath = (firstTarget.target as any).path;
      assert.strictEqual(
        targetPath,
        'src/agents/analysis',
        `Should target directory with highest undocumented ratio first. Got: ${targetPath}`
      );
    });

    it('should sort by undocumented ratio first, then by count', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/services', totalFiles: 10, undocumentedCount: 5, undocumentedRatio: 0.5 },
        { path: 'src/agents/analysis', totalFiles: 4, undocumentedCount: 4, undocumentedRatio: 1.0 },
        { path: 'src/utils', totalFiles: 2, undocumentedCount: 2, undocumentedRatio: 1.0 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      const result = await codebaseExplorationStrategy(ctx, 5);

      const paths = result.workItems.map(w => (w.target as any).path);

      // Both src/agents/analysis and src/utils have 100% undocumented
      // src/agents/analysis has more undocumented files (4 vs 2)
      // So src/agents/analysis should come first
      assert.ok(paths.length >= 2, 'Should have at least 2 work items');

      const analysisIndex = paths.indexOf('src/agents/analysis');
      const utilsIndex = paths.indexOf('src/utils');

      assert.ok(
        analysisIndex !== -1,
        `Should include src/agents/analysis. Paths: ${paths.join(', ')}`
      );
      assert.ok(
        utilsIndex !== -1,
        `Should include src/utils. Paths: ${paths.join(', ')}`
      );

      // More undocumented files should come first when ratio is equal
      assert.ok(
        analysisIndex < utilsIndex,
        `Directory with more undocumented files (src/agents/analysis at index ${analysisIndex}) should come before (src/utils at index ${utilsIndex})`
      );
    });

    it('should prefer deeper directories when ratio and count are equal', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 4, undocumentedCount: 4, undocumentedRatio: 1.0 },
        { path: 'src/a/nested', totalFiles: 4, undocumentedCount: 4, undocumentedRatio: 1.0 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      const result = await codebaseExplorationStrategy(ctx, 2);

      const paths = result.workItems.map(w => (w.target as any).path);

      // Deeper directory should come first when ratio and count are equal
      assert.strictEqual(
        paths[0],
        'src/a/nested',
        `Should prefer deeper directory. First target: ${paths[0]}`
      );
    });

    it('should only include directories with undocumented files', async () => {
      // Empty list means all directories are documented
      const undocumentedDirectories: UndocumentedDirectory[] = [];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      const result = await codebaseExplorationStrategy(ctx, 5);

      // Should not create any work items when everything is documented
      assert.strictEqual(
        result.workItems.length,
        0,
        'Should not create work items when everything is documented'
      );
    });

    it('should respect the remaining slots limit', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/a', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
        { path: 'src/b', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
        { path: 'src/c', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
        { path: 'src/d', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      const result = await codebaseExplorationStrategy(ctx, 2);

      // Should only create 2 work items even though 4 directories need coverage
      assert.ok(
        result.workItems.length <= 2,
        `Should respect slots limit. Got ${result.workItems.length} items`
      );
    });

    it('should add targeted directories to existingWorkKeys', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      await codebaseExplorationStrategy(ctx, 5);

      // Should have added the work key
      assert.ok(
        ctx.existingWorkKeys.has('codebase-explorer:path:src/agents'),
        'Should add work key for targeted directory'
      );
    });

    it('should skip directories already in existingWorkKeys', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 10, undocumentedCount: 10, undocumentedRatio: 1.0 },
        { path: 'src/services', totalFiles: 5, undocumentedCount: 5, undocumentedRatio: 1.0 },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories);
      // Pre-add the first directory to existingWorkKeys
      ctx.existingWorkKeys.add('codebase-explorer:path:src/agents');

      const result = await codebaseExplorationStrategy(ctx, 5);

      const paths = result.workItems.map(w => (w.target as any).path);

      // Should not include the pre-added directory
      assert.ok(
        !paths.includes('src/agents'),
        `Should skip directory already in existingWorkKeys. Paths: ${paths.join(', ')}`
      );

      // Should include the other directory
      assert.ok(
        paths.includes('src/services'),
        `Should include other directories. Paths: ${paths.join(', ')}`
      );
    });
  });
});
