/**
 * Unit tests for Orchestrator strategy passing priority files.
 *
 * Tests that codebaseExplorationStrategy includes priorityFiles in work items
 * based on the lowCoverageFiles from context.
 *
 * TDD: Write tests before implementation.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { codebaseExplorationStrategy } from '../../src/agents/orchestrator/strategies.js';
import type { StrategyContext } from '../../src/agents/orchestrator/strategies.js';
import type { UndocumentedDirectory, OrchestratorContext } from '../../src/agents/orchestrator/context-gatherer.js';
import type { PathTarget } from '../../src/domain/work-target.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock StrategyContext with specified undocumented directories and low-coverage files.
 */
function createMockStrategyContext(
  undocumentedDirectories: UndocumentedDirectory[],
  lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }> = []
): StrategyContext {
  const mockOrchestratorContext: OrchestratorContext = {
    totalCommits: 10,
    commitsByAgent: {},
    recentCommits: [],
    wikiPages: 10,
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
    lowCoverageFiles,
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

describe('Orchestrator Priority Files', () => {
  describe('codebaseExplorationStrategy', () => {
    it('should include priorityFiles in work items', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 5, undocumentedCount: 3, undocumentedRatio: 0.6 },
      ];

      const lowCoverageFiles = [
        { path: 'src/agents/base.ts', coverage: 0, directory: 'src/agents' },
        { path: 'src/agents/registry.ts', coverage: 25, directory: 'src/agents' },
        { path: 'src/agents/orchestrator.ts', coverage: 0, directory: 'src/agents' },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories, lowCoverageFiles);
      const result = await codebaseExplorationStrategy(ctx, 5);

      assert.ok(result.workItems.length > 0, 'Should create work items');

      const workItem = result.workItems[0];
      assert.ok(workItem, 'Should have at least one work item');

      const target = workItem.target as PathTarget;
      assert.strictEqual(target.type, 'path');
      assert.strictEqual(target.path, 'src/agents');
      assert.ok(target.priorityFiles, 'Should have priorityFiles');
      assert.ok(Array.isArray(target.priorityFiles), 'priorityFiles should be an array');
      assert.ok(target.priorityFiles.length > 0, 'priorityFiles should not be empty');
    });

    it('should only include files from the target directory', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 5, undocumentedCount: 2, undocumentedRatio: 0.4 },
      ];

      const lowCoverageFiles = [
        { path: 'src/agents/base.ts', coverage: 0, directory: 'src/agents' },
        { path: 'src/services/llm.ts', coverage: 0, directory: 'src/services' },
        { path: 'src/agents/registry.ts', coverage: 0, directory: 'src/agents' },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories, lowCoverageFiles);
      const result = await codebaseExplorationStrategy(ctx, 5);

      const workItem = result.workItems[0];
      const target = workItem.target as PathTarget;

      // Should only have files from src/agents
      assert.ok(target.priorityFiles, 'Should have priorityFiles');
      assert.ok(
        target.priorityFiles.every(f => f.startsWith('src/agents/')),
        `All priorityFiles should be in src/agents. Got: ${target.priorityFiles.join(', ')}`
      );
      assert.ok(
        !target.priorityFiles.includes('src/services/llm.ts'),
        'Should not include files from other directories'
      );
    });

    it('should cap priorityFiles to a reasonable limit', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/large', totalFiles: 50, undocumentedCount: 30, undocumentedRatio: 0.6 },
      ];

      // Create 30 low-coverage files
      const lowCoverageFiles = Array.from({ length: 30 }, (_, i) => ({
        path: `src/large/file${i}.ts`,
        coverage: 0,
        directory: 'src/large',
      }));

      const ctx = createMockStrategyContext(undocumentedDirectories, lowCoverageFiles);
      const result = await codebaseExplorationStrategy(ctx, 5);

      const workItem = result.workItems[0];
      const target = workItem.target as PathTarget;

      // Should have a reasonable cap (e.g., 20)
      assert.ok(target.priorityFiles, 'Should have priorityFiles');
      assert.ok(
        target.priorityFiles.length <= 20,
        `Should cap priorityFiles. Got ${target.priorityFiles.length}`
      );
    });

    it('should handle directory with no low-coverage files', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 5, undocumentedCount: 2, undocumentedRatio: 0.4 },
      ];

      // No files match this directory
      const lowCoverageFiles = [
        { path: 'src/services/llm.ts', coverage: 0, directory: 'src/services' },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories, lowCoverageFiles);
      const result = await codebaseExplorationStrategy(ctx, 5);

      const workItem = result.workItems[0];
      const target = workItem.target as PathTarget;

      // priorityFiles can be undefined or empty array
      assert.ok(
        !target.priorityFiles || target.priorityFiles.length === 0,
        'Should have no priorityFiles for this directory'
      );
    });

    it('should work with multiple directories', async () => {
      const undocumentedDirectories: UndocumentedDirectory[] = [
        { path: 'src/agents', totalFiles: 5, undocumentedCount: 2, undocumentedRatio: 0.4 },
        { path: 'src/services', totalFiles: 3, undocumentedCount: 2, undocumentedRatio: 0.67 },
      ];

      const lowCoverageFiles = [
        { path: 'src/agents/base.ts', coverage: 0, directory: 'src/agents' },
        { path: 'src/services/llm.ts', coverage: 0, directory: 'src/services' },
        { path: 'src/services/git.ts', coverage: 25, directory: 'src/services' },
      ];

      const ctx = createMockStrategyContext(undocumentedDirectories, lowCoverageFiles);
      const result = await codebaseExplorationStrategy(ctx, 5);

      // Should have 2 work items, each with appropriate priorityFiles
      assert.strictEqual(result.workItems.length, 2, 'Should have 2 work items');

      // First item (src/services - higher ratio)
      const servicesItem = result.workItems.find(
        w => (w.target as PathTarget).path === 'src/services'
      );
      assert.ok(servicesItem, 'Should have src/services work item');
      const servicesTarget = servicesItem.target as PathTarget;
      assert.ok(servicesTarget.priorityFiles, 'src/services should have priorityFiles');
      assert.ok(
        servicesTarget.priorityFiles.every(f => f.startsWith('src/services/')),
        'src/services priorityFiles should only contain src/services files'
      );

      // Second item (src/agents)
      const agentsItem = result.workItems.find(
        w => (w.target as PathTarget).path === 'src/agents'
      );
      assert.ok(agentsItem, 'Should have src/agents work item');
      const agentsTarget = agentsItem.target as PathTarget;
      assert.ok(agentsTarget.priorityFiles, 'src/agents should have priorityFiles');
      assert.ok(
        agentsTarget.priorityFiles.every(f => f.startsWith('src/agents/')),
        'src/agents priorityFiles should only contain src/agents files'
      );
    });
  });
});
