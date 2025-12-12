/**
 * Unit tests for Orchestrator strategy deep directory targeting.
 *
 * These tests verify that the codebaseExplorationStrategy prefers targeting
 * deeper directories with low coverage over shallower parent directories.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { codebaseExplorationStrategy } from '../../src/agents/orchestrator/strategies.js';
import type { StrategyContext } from '../../src/agents/orchestrator/strategies.js';
import type { DirectoryCoverage, OrchestratorContext } from '../../src/agents/orchestrator/context-gatherer.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock StrategyContext with specified directory coverage.
 */
function createMockStrategyContext(
  directoryCoverage: DirectoryCoverage[],
  options?: {
    iterationPhase?: 'early' | 'mid' | 'late';
    wikiPageCount?: number;
  }
): StrategyContext {
  const { iterationPhase = 'early', wikiPageCount = 10 } = options ?? {};

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
    directoryCoverage,
    fileCoverageTree: null,
    projectOverviewContent: null,
    pendingEditRequests: 0,
    iterationPhase,
  };

  return {
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    repos: {} as any,
    existingWorkKeys: new Set(),
    iterationPhase,
    contextGatherer: {
      gather: mock.fn(async () => mockOrchestratorContext),
      formatForPrompt: mock.fn(() => ''),
    } as any,
  };
}

describe('Orchestrator Deep Directory Targeting', () => {
  describe('codebaseExplorationStrategy', () => {
    it('should prefer deeper directories with lower coverage over shallower ones', async () => {
      // Scenario: src/agents has 50% coverage, but src/agents/analysis has 0%
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/agents', fileCount: 10, wikiMentions: 5, coveragePercent: 50 },
        { path: 'src/agents/analysis', fileCount: 4, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/agents/orchestrator', fileCount: 3, wikiMentions: 3, coveragePercent: 100 },
        { path: 'src/services', fileCount: 5, wikiMentions: 2, coveragePercent: 40 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      const result = await codebaseExplorationStrategy(ctx, 5);

      // Should have created work items
      assert.ok(result.workItems.length > 0, 'Should create work items');

      // The first work item should target the deepest directory with lowest coverage
      const firstTarget = result.workItems[0];
      assert.ok(firstTarget, 'Should have at least one work item');

      // src/agents/analysis (0% coverage) should be prioritized over src/agents (50%)
      const targetPath = (firstTarget.target as any).path;
      assert.strictEqual(
        targetPath,
        'src/agents/analysis',
        `Should target deeply nested low-coverage directory first. Got: ${targetPath}`
      );
    });

    it('should sort by coverage first, then by depth', async () => {
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/services', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/agents/analysis', fileCount: 4, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/agents', fileCount: 10, wikiMentions: 5, coveragePercent: 50 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      const result = await codebaseExplorationStrategy(ctx, 5);

      // Both src/services and src/agents/analysis have 0% coverage
      // src/agents/analysis is deeper (3 parts) than src/services (2 parts)
      // So src/agents/analysis should come first
      const paths = result.workItems.map(w => (w.target as any).path);

      assert.ok(paths.length >= 2, 'Should have at least 2 work items');

      // Find positions of both directories
      const analysisIndex = paths.indexOf('src/agents/analysis');
      const servicesIndex = paths.indexOf('src/services');

      assert.ok(
        analysisIndex !== -1,
        `Should include src/agents/analysis. Paths: ${paths.join(', ')}`
      );
      assert.ok(
        servicesIndex !== -1,
        `Should include src/services. Paths: ${paths.join(', ')}`
      );

      // Deeper directory should come first when coverage is equal
      assert.ok(
        analysisIndex < servicesIndex,
        `Deeper directory (src/agents/analysis at index ${analysisIndex}) should come before shallower (src/services at index ${servicesIndex})`
      );
    });

    it('should not target parent directory when child has same coverage', async () => {
      // If src/agents and src/agents/analysis both have 0%, prefer the child
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/agents', fileCount: 10, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/agents/analysis', fileCount: 4, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/agents/orchestrator', fileCount: 3, wikiMentions: 0, coveragePercent: 0 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      const result = await codebaseExplorationStrategy(ctx, 2);

      const paths = result.workItems.map(w => (w.target as any).path);

      // Should prefer child directories over parent when coverage is same
      // Because documenting a specific subdirectory is more focused
      assert.ok(
        paths[0] !== 'src/agents' || paths.length === 1,
        `Should prefer child directories over parent. First target: ${paths[0]}`
      );
    });

    it('should skip directories that are already well-documented', async () => {
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/agents/orchestrator', fileCount: 3, wikiMentions: 10, coveragePercent: 100 },
        { path: 'src/agents/analysis', fileCount: 4, wikiMentions: 0, coveragePercent: 0 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      const result = await codebaseExplorationStrategy(ctx, 5);

      const paths = result.workItems.map(w => (w.target as any).path);

      // Should not include the 100% coverage directory
      assert.ok(
        !paths.includes('src/agents/orchestrator'),
        `Should skip well-documented directories. Paths: ${paths.join(', ')}`
      );

      // Should include the 0% coverage directory
      assert.ok(
        paths.includes('src/agents/analysis'),
        `Should include low-coverage directories. Paths: ${paths.join(', ')}`
      );
    });

    it('should respect the remaining slots limit', async () => {
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/a', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/b', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/c', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/d', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      const result = await codebaseExplorationStrategy(ctx, 2);

      // Should only create 2 work items even though 4 directories need coverage
      assert.ok(
        result.workItems.length <= 2,
        `Should respect slots limit. Got ${result.workItems.length} items`
      );
    });

    it('should add targeted directories to existingWorkKeys', async () => {
      const directoryCoverage: DirectoryCoverage[] = [
        { path: 'src/agents', fileCount: 10, wikiMentions: 0, coveragePercent: 0 },
      ];

      const ctx = createMockStrategyContext(directoryCoverage);
      await codebaseExplorationStrategy(ctx, 5);

      // Should have added the work key
      assert.ok(
        ctx.existingWorkKeys.has('codebase-explorer:path:src/agents'),
        'Should add work key for targeted directory'
      );
    });
  });
});
