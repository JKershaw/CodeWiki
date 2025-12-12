/**
 * Unit tests for ExplorationPhaseRunner.
 * Tests the depth-first directory exploration phase.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  ExplorationPhaseRunner,
  type ExplorationDependencies,
  sortDirectoriesDepthFirst,
} from '../../src/executor/phases/exploration-phase-runner.js';
import type { PhaseContext, PhaseResult } from '../../src/executor/pipeline-manager.js';
import type { DirectoryCoverage } from '../../src/agents/orchestrator/context-gatherer.js';

// Create mock dependencies
function createMockDependencies(): ExplorationDependencies & {
  exploredDirs: string[];
  directoryCoverage: DirectoryCoverage[];
} {
  const exploredDirs: string[] = [];
  const directoryCoverage: DirectoryCoverage[] = [];

  return {
    exploredDirs,
    directoryCoverage,
    getDirectoryCoverage: async () => directoryCoverage,
    exploreDirectory: async (path: string) => {
      exploredDirs.push(path);
      return {
        success: true,
        costUsd: 0.01,
        pagesCreated: 1,
        pagesUpdated: 0,
      };
    },
    updatePhaseProgress: async () => {},
    isDirectoryAlreadyExplored: async (path: string) => exploredDirs.includes(path),
  };
}

describe('sortDirectoriesDepthFirst', () => {
  it('sorts directories by depth (deepest first)', () => {
    const dirs: DirectoryCoverage[] = [
      { path: 'src', fileCount: 10, wikiMentions: 0, coveragePercent: 0 },
      { path: 'src/services', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
      { path: 'src/services/llm', fileCount: 3, wikiMentions: 0, coveragePercent: 0 },
      { path: 'src/utils', fileCount: 4, wikiMentions: 0, coveragePercent: 0 },
    ];

    const sorted = sortDirectoriesDepthFirst(dirs);

    // Deepest directories should come first
    assert.strictEqual(sorted[0]!.path, 'src/services/llm');
    // Same depth should preserve relative order
    assert.ok(sorted.indexOf(sorted.find(d => d.path === 'src/services')!) <
              sorted.indexOf(sorted.find(d => d.path === 'src')!));
  });

  it('sorts by coverage percent within same depth (lowest first)', () => {
    const dirs: DirectoryCoverage[] = [
      { path: 'src/a', fileCount: 5, wikiMentions: 2, coveragePercent: 40 },
      { path: 'src/b', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
      { path: 'src/c', fileCount: 5, wikiMentions: 1, coveragePercent: 20 },
    ];

    const sorted = sortDirectoriesDepthFirst(dirs);

    // All same depth, should be ordered by coverage (lowest first)
    assert.strictEqual(sorted[0]!.path, 'src/b');
    assert.strictEqual(sorted[1]!.path, 'src/c');
    assert.strictEqual(sorted[2]!.path, 'src/a');
  });

  it('handles empty array', () => {
    const sorted = sortDirectoriesDepthFirst([]);
    assert.deepStrictEqual(sorted, []);
  });
});

describe('ExplorationPhaseRunner', () => {
  let deps: ReturnType<typeof createMockDependencies>;
  let runner: ExplorationPhaseRunner;

  beforeEach(() => {
    deps = createMockDependencies();
    runner = new ExplorationPhaseRunner(deps);
  });

  describe('run', () => {
    it('explores directories with low coverage', async () => {
      deps.directoryCoverage.push(
        { path: 'src/services', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/utils', fileCount: 3, wikiMentions: 0, coveragePercent: 0 }
      );

      const context: PhaseContext = {
        processingRunId: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        phase: 'exploration',
        phaseProgress: 0,
        phaseTarget: null,
      };

      const result = await runner.run(context);

      assert.strictEqual(result.workItemsProcessed, 1);
      assert.strictEqual(deps.exploredDirs.length, 1);
    });

    it('skips already-explored directories', async () => {
      deps.directoryCoverage.push(
        { path: 'src/services', fileCount: 5, wikiMentions: 5, coveragePercent: 100 }
      );
      deps.exploredDirs.push('src/services');

      const context: PhaseContext = {
        processingRunId: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        phase: 'exploration',
        phaseProgress: 0,
        phaseTarget: null,
      };

      const result = await runner.run(context);

      // Already explored, should complete
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.workItemsProcessed, 0);
    });

    it('marks phase complete when all directories explored', async () => {
      deps.directoryCoverage.push(
        { path: 'src/services', fileCount: 5, wikiMentions: 5, coveragePercent: 100 }
      );

      const context: PhaseContext = {
        processingRunId: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        phase: 'exploration',
        phaseProgress: 0,
        phaseTarget: null,
      };

      // Simulate already explored
      deps.exploredDirs.push('src/services');

      const result = await runner.run(context);

      assert.strictEqual(result.completed, true);
    });

    it('explores in depth-first order', async () => {
      deps.directoryCoverage.push(
        { path: 'src', fileCount: 10, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/services', fileCount: 5, wikiMentions: 0, coveragePercent: 0 },
        { path: 'src/services/llm', fileCount: 3, wikiMentions: 0, coveragePercent: 0 }
      );

      const context: PhaseContext = {
        processingRunId: uuid(),
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        phase: 'exploration',
        phaseProgress: 0,
        phaseTarget: null,
      };

      // Run multiple times to explore all
      await runner.run(context);
      await runner.run(context);
      await runner.run(context);

      // Should explore deepest first
      assert.strictEqual(deps.exploredDirs[0], 'src/services/llm');
      assert.strictEqual(deps.exploredDirs[1], 'src/services');
      assert.strictEqual(deps.exploredDirs[2], 'src');
    });
  });

  describe('getCoverageThreshold', () => {
    it('uses default threshold of 50%', () => {
      const runner = new ExplorationPhaseRunner(deps);
      // Default threshold is 50%
      const threshold = runner.getCoverageThreshold();
      assert.strictEqual(threshold, 50);
    });

    it('can be configured with custom threshold', () => {
      const runner = new ExplorationPhaseRunner(deps, { coverageThreshold: 30 });
      const threshold = runner.getCoverageThreshold();
      assert.strictEqual(threshold, 30);
    });
  });
});

describe('Phase Completion Criteria', () => {
  it('completes when no directories below threshold', async () => {
    const deps = createMockDependencies();
    deps.directoryCoverage.push(
      { path: 'src/services', fileCount: 5, wikiMentions: 5, coveragePercent: 100 },
      { path: 'src/utils', fileCount: 3, wikiMentions: 3, coveragePercent: 100 }
    );

    const runner = new ExplorationPhaseRunner(deps);
    const context: PhaseContext = {
      processingRunId: uuid(),
      repoId: 'repo-1',
      wikiId: 'wiki-1',
      phase: 'exploration',
      phaseProgress: 0,
      phaseTarget: null,
    };

    const result = await runner.run(context);

    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.workItemsProcessed, 0);
  });
});
