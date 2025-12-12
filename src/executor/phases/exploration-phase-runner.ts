/**
 * ExplorationPhaseRunner - Depth-first directory exploration.
 *
 * This phase runner implements the "tree-like growth" pattern:
 * 1. Get all directories with low coverage
 * 2. Sort them depth-first (deepest directories first)
 * 3. Explore one directory at a time
 * 4. Complete the phase when all directories above threshold are explored
 *
 * This ensures that child directories are documented before parents,
 * creating a natural bottom-up wiki structure.
 */

import type { PhaseRunner, PhaseContext, PhaseResult } from '../pipeline-manager.js';
import type { DirectoryCoverage } from '../../agents/orchestrator/context-gatherer.js';

/**
 * Result from exploring a single directory.
 */
export interface ExploreResult {
  success: boolean;
  costUsd: number;
  pagesCreated: number;
  pagesUpdated: number;
  error?: string;
}

/**
 * Dependencies injected into the exploration phase runner.
 * This abstraction allows testing without the full executor infrastructure.
 */
export interface ExplorationDependencies {
  /**
   * Get directory coverage information for the repository.
   */
  getDirectoryCoverage: (repoId: string, wikiId: string) => Promise<DirectoryCoverage[]>;

  /**
   * Explore a single directory using the codebase-explorer agent.
   */
  exploreDirectory: (path: string, repoId: string, wikiId: string) => Promise<ExploreResult>;

  /**
   * Update phase progress in the processing run.
   */
  updatePhaseProgress: (processingRunId: string, progress: number, target: number) => Promise<void>;

  /**
   * Check if a directory has already been explored in this session.
   */
  isDirectoryAlreadyExplored: (path: string, repoId: string) => Promise<boolean>;
}

/**
 * Options for the exploration phase runner.
 */
export interface ExplorationOptions {
  /** Coverage threshold percentage below which directories are explored (default: 50) */
  coverageThreshold?: number;
}

/**
 * Sort directories depth-first: deepest directories first, then by coverage (lowest first).
 * This ensures children are documented before parents.
 */
export function sortDirectoriesDepthFirst(dirs: DirectoryCoverage[]): DirectoryCoverage[] {
  return [...dirs].sort((a, b) => {
    // First, sort by depth (more slashes = deeper = higher priority)
    const depthA = (a.path.match(/\//g) || []).length;
    const depthB = (b.path.match(/\//g) || []).length;

    if (depthA !== depthB) {
      return depthB - depthA; // Deeper first
    }

    // Same depth: sort by coverage (lower first)
    return a.coveragePercent - b.coveragePercent;
  });
}

/**
 * Exploration phase runner - documents the current codebase depth-first.
 */
export class ExplorationPhaseRunner implements PhaseRunner {
  private readonly coverageThreshold: number;

  constructor(
    private readonly deps: ExplorationDependencies,
    options: ExplorationOptions = {}
  ) {
    this.coverageThreshold = options.coverageThreshold ?? 50;
  }

  /**
   * Get the coverage threshold for this runner.
   */
  getCoverageThreshold(): number {
    return this.coverageThreshold;
  }

  /**
   * Run one iteration of the exploration phase.
   * Explores a single directory with low coverage.
   */
  async run(context: PhaseContext): Promise<PhaseResult> {
    const { processingRunId, repoId, wikiId } = context;

    // Get directory coverage
    const allDirs = await this.deps.getDirectoryCoverage(repoId, wikiId);

    // Filter to low-coverage directories
    const lowCoverageDirs = allDirs.filter(d => d.coveragePercent < this.coverageThreshold);

    // Sort depth-first
    const sortedDirs = sortDirectoriesDepthFirst(lowCoverageDirs);

    // Update phase target if not set
    if (context.phaseTarget === null && sortedDirs.length > 0) {
      await this.deps.updatePhaseProgress(processingRunId, 0, sortedDirs.length);
    }

    // Find the first directory that hasn't been explored yet
    let directoryToExplore: DirectoryCoverage | null = null;
    for (const dir of sortedDirs) {
      const alreadyExplored = await this.deps.isDirectoryAlreadyExplored(dir.path, repoId);
      if (!alreadyExplored) {
        directoryToExplore = dir;
        break;
      }
    }

    // If no directories to explore, phase is complete
    if (!directoryToExplore) {
      return {
        completed: true,
        workItemsProcessed: 0,
        costUsd: 0,
        pagesCreated: 0,
        pagesUpdated: 0,
      };
    }

    // Explore the directory
    const result = await this.deps.exploreDirectory(
      directoryToExplore.path,
      repoId,
      wikiId
    );

    // Update progress
    const explored = sortedDirs.filter(
      async d => await this.deps.isDirectoryAlreadyExplored(d.path, repoId)
    ).length + 1;
    await this.deps.updatePhaseProgress(processingRunId, explored, sortedDirs.length);

    // Check if all directories are now explored
    let allExplored = true;
    for (const dir of sortedDirs) {
      if (dir.path === directoryToExplore.path) continue; // Just explored
      const isExplored = await this.deps.isDirectoryAlreadyExplored(dir.path, repoId);
      if (!isExplored) {
        allExplored = false;
        break;
      }
    }

    return {
      completed: allExplored,
      workItemsProcessed: 1,
      costUsd: result.costUsd,
      pagesCreated: result.pagesCreated,
      pagesUpdated: result.pagesUpdated,
    };
  }
}

/**
 * Create exploration dependencies from the executor infrastructure.
 * This connects the phase runner to the actual codebase-explorer agent.
 */
export function createExplorationDependencies(
  // These will be provided by the executor integration
  // For now, just define the interface
): ExplorationDependencies {
  throw new Error('Not implemented - use createExplorationDependenciesFromExecutor');
}
