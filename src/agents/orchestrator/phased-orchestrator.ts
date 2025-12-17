/**
 * Phased Orchestrator - Adapts strategy based on wiki maturity.
 *
 * Recognizes 6 distinct phases and allocates work accordingly:
 * - Phase 0: Reconnaissance - Understand codebase before documenting
 * - Phase 1: Skeleton - Build navigable structure
 * - Phase 2: Breadth - Cover all directories shallowly
 * - Phase 3: Depth + Guides - Deepen coverage, create synthesis content
 * - Phase 4: Polish - Quality-focused improvements
 * - Phase 5: Maintenance - Reactive mode
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { WorkItem } from '../../domain/work-item.js';
import { createWorkItem, generateWorkItemId } from '../../domain/work-item.js';
import { createOrchestratorRun } from '../../domain/orchestrator-run.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import { ContextGatherer, type OrchestratorContext, type UndocumentedDirectory } from './context-gatherer.js';
import { calculateFileCoverage } from './file-coverage-tree.js';
import type { Orchestrator, OrchestratorConfig, WorkSummary } from './orchestrator.js';
import { ANALYSIS_AGENTS, type AgentType } from '../../agents/registry.js';

// ============================================================================
// Debug Infrastructure
// ============================================================================

/**
 * Check if orchestrator debug mode is enabled.
 * Set ORCHESTRATOR_DEBUG=1 to enable detailed logging.
 */
export function isDebugEnabled(): boolean {
  return process.env.ORCHESTRATOR_DEBUG === '1' || process.env.ORCHESTRATOR_DEBUG === 'true';
}

/**
 * Log debug information if debug mode is enabled.
 */
function debugLog(message: string): void {
  if (isDebugEnabled()) {
    console.log(`[DEBUG ORCHESTRATOR] ${message}`);
  }
}

/**
 * Log debug section header.
 */
function debugSection(title: string): void {
  if (isDebugEnabled()) {
    console.log(`\n[DEBUG ORCHESTRATOR] ═══ ${title} ═══`);
  }
}

/**
 * Format directory coverage for debug output.
 */
function formatDirectoryCoverage(dir: UndocumentedDirectory): string {
  const coveragePct = ((1 - dir.undocumentedRatio) * 100).toFixed(1);
  const undocPct = (dir.undocumentedRatio * 100).toFixed(1);
  return `${dir.path}: ${undocPct}% undocumented (${dir.undocumentedCount}/${dir.totalFiles} files) → ${coveragePct}% coverage`;
}

// Import CQRS queries
import {
  createListWikiPagesQuery,
  handleListWikiPages,
  createCountPendingWorkQuery,
  handleCountPendingWork,
  createGetPendingWorkKeysQuery,
  handleGetPendingWorkKeys,
  createListUnprocessedCommitsQuery,
  handleListUnprocessedCommits,
  createListAgentRunsQuery,
  handleListAgentRuns,
  createListOpenConflictsQuery,
  handleListOpenConflicts,
  createListOpenFindingsQuery,
  handleListOpenFindings,
  createListLowConfidencePagesQuery,
  handleListLowConfidencePages,
  createCountCommitsByRepoQuery,
  handleCountCommitsByRepo,
  createCountProcessedByAgentQuery,
  handleCountProcessedByAgent,
} from '../../queries/index.js';

/**
 * Phase enumeration.
 */
export enum Phase {
  Reconnaissance = 0,
  Skeleton = 1,
  Breadth = 2,
  DepthAndGuides = 3,
  Polish = 4,
  Maintenance = 5,
}

/**
 * Context needed for phase detection.
 */
export interface PhaseContext {
  pages: number;
  directoriesWithAnyCoverage: number;
  lowestDirectoryCoverage: number;
  /** Ratio of source files that have been touched (have any documentation score > 0) */
  touchedFilesRatio: number;
  avgConfidence: number;
  hasProjectOverview: boolean;
  hasGettingStarted: boolean;
  hasTestingGuide: boolean;
  hasExtensionGuide: boolean;
  lowConfidenceRatio: number;
  openFindings: number;
}

/** Minimum ratio of files that must be touched to exit Phase 2 */
export const TOUCHED_FILES_THRESHOLD = 0.90;

/**
 * Detect current phase based on wiki state.
 */
export function detectPhase(ctx: PhaseContext): Phase {
  // Phase 0: Empty wiki
  if (ctx.pages === 0) {
    return Phase.Reconnaissance;
  }

  // Phase 1: Few pages or few directories covered
  if (ctx.pages < 10 || ctx.directoriesWithAnyCoverage < 3) {
    return Phase.Skeleton;
  }

  // Phase 2: Not enough files touched OR not enough pages
  // We use touchedFilesRatio instead of lowestDirectoryCoverage to avoid
  // the "moving target" problem where score-based percentages shift as maxScore grows.
  // A file is "touched" if it has any documentation score > 0.
  if (ctx.touchedFilesRatio < TOUCHED_FILES_THRESHOLD || ctx.pages < 25) {
    return Phase.Breadth;
  }

  // Phase 3: Key pages missing or confidence < 65%
  const keyPagesMissing = !ctx.hasProjectOverview || !ctx.hasGettingStarted ||
                          !ctx.hasTestingGuide || !ctx.hasExtensionGuide;
  if (keyPagesMissing || ctx.avgConfidence < 0.65) {
    return Phase.DepthAndGuides;
  }

  // Phase 4: Low confidence ratio > 10% or too many findings
  if (ctx.lowConfidenceRatio > 0.10 || ctx.openFindings > 5) {
    return Phase.Polish;
  }

  // Phase 5: Maintenance
  return Phase.Maintenance;
}

/**
 * Calculate the lowest directory coverage from undocumented directories.
 *
 * This function correctly includes ALL directories in the calculation,
 * including those with undocumentedRatio === 1.0 (0% coverage).
 *
 * Bug fix: The previous implementation excluded ratio=1.0 directories,
 * which caused lowestDirectoryCoverage to be artificially high when
 * some directories were completely undocumented.
 *
 * @param undocumentedDirectories - Array of directories with their coverage ratios
 * @param wikiPages - Number of wiki pages (used for fallback estimate)
 * @returns Lowest coverage percentage (0-100) across all directories
 */
export function calculateLowestDirectoryCoverage(
  undocumentedDirectories: UndocumentedDirectory[],
  wikiPages: number
): number {
  if (undocumentedDirectories.length === 0) {
    // No directory info - use page-based estimate as fallback
    return Math.min(wikiPages * 2, 80);
  }

  // Calculate coverage for ALL directories (including ratio=1.0)
  // Coverage = (1 - undocumentedRatio) * 100
  // e.g., ratio 0.6 = 40% coverage, ratio 1.0 = 0% coverage
  const coverages = undocumentedDirectories.map(d => (1 - d.undocumentedRatio) * 100);
  return Math.min(...coverages);
}

/**
 * Maximum number of priority files to include in a work item.
 * Prevents payload bloat while still providing coverage guidance.
 */
export const MAX_PRIORITY_FILES = 20;

/**
 * Maximum number of directories to focus on per batch.
 *
 * This limit ensures depth-first behavior: instead of spreading work
 * across many directories, we focus on 2-3 at a time until they reach
 * the phase threshold. This prevents the "round-robin" problem where
 * no directory ever gets completed.
 */
export const MAX_FOCUS_DIRECTORIES = 3;

/**
 * Prioritize directories for exploration based on phase threshold.
 *
 * This function implements the "focus strategy" to ensure depth-first
 * documentation within breadth-first phases:
 *
 * 1. Directories already at/above threshold are excluded
 * 2. "In-progress" directories (started but not done) are prioritized
 * 3. In-progress dirs are sorted by proximity to threshold (closest first)
 * 4. Not-started directories come after in-progress ones
 *
 * @param dirs - Undocumented directories (should already be deterministically sorted)
 * @param phaseThreshold - Maximum undocumented ratio to consider "done" (e.g., 0.70 = 30% coverage)
 * @returns Prioritized directories, with in-progress first
 */
export function prioritizeDirectoriesForPhase(
  dirs: UndocumentedDirectory[],
  phaseThreshold: number
): UndocumentedDirectory[] {
  // Separate directories into categories
  const inProgress: UndocumentedDirectory[] = [];
  const notStarted: UndocumentedDirectory[] = [];

  for (const dir of dirs) {
    // Skip directories already at or above threshold
    if (dir.undocumentedRatio <= phaseThreshold) {
      continue;
    }

    // "In progress" = some work done (ratio < 1.0) but not at threshold
    if (dir.undocumentedRatio < 1.0) {
      inProgress.push(dir);
    } else {
      // "Not started" = 100% undocumented
      notStarted.push(dir);
    }
  }

  // Sort in-progress by undocumented ratio ascending (closest to threshold first)
  // This ensures we finish directories that are almost done
  inProgress.sort((a, b) => a.undocumentedRatio - b.undocumentedRatio);

  // Combine: in-progress first (closest to threshold), then not-started
  return [...inProgress, ...notStarted];
}

/**
 * Low coverage file type from context gatherer.
 */
type LowCoverageFile = { path: string; coverage: number; directory: string };

// ============================================================================
// BFS Directory Selection (Phase 2 Breadth)
// ============================================================================

/**
 * Get immediate child directories of a parent path.
 *
 * This function extracts children by analyzing path structure - a child
 * is a directory that starts with the parent path and has exactly one
 * additional path segment.
 *
 * For root (parentPath=''), finds directories that have no parent in the list.
 * This handles cases where we have ['src/agents', 'src/services'] but no 'src'.
 *
 * @param parentPath - Parent directory path (empty string for root)
 * @param allDirectories - All known directory paths
 * @returns Sorted array of immediate child directory paths
 */
export function getChildDirectories(
  parentPath: string,
  allDirectories: string[]
): string[] {
  const allDirsSet = new Set(allDirectories);

  if (parentPath === '') {
    // Root case: find directories with no parent in the list
    const roots = new Set<string>();

    for (const dir of allDirectories) {
      const segments = dir.split('/');

      // Walk up the path to find the topmost ancestor in the list
      // or the directory itself if no ancestor exists
      let root = dir;
      for (let i = 1; i < segments.length; i++) {
        const prefix = segments.slice(0, i).join('/');
        if (allDirsSet.has(prefix)) {
          root = prefix;
          break;
        }
      }

      // If no shorter prefix exists in list, this dir (or its first segment) is a root
      if (root === dir) {
        // Check if first segment exists
        const firstSeg = segments[0];
        if (firstSeg && allDirsSet.has(firstSeg)) {
          roots.add(firstSeg);
        } else {
          roots.add(dir);
        }
      } else {
        roots.add(root);
      }
    }

    return Array.from(roots).sort();
  }

  // Non-root case: find immediate children
  const children: string[] = [];
  const prefix = parentPath + '/';

  for (const dir of allDirectories) {
    if (!dir.startsWith(prefix)) {
      continue;
    }

    const remainder = dir.slice(prefix.length);

    // Immediate child has no slash in remainder
    if (!remainder.includes('/')) {
      children.push(dir);
    }
  }

  return children.sort();
}

/**
 * Check if a directory is "covered" (has sufficient documentation).
 *
 * Uses a simple binary threshold: a directory is covered if more than 50%
 * of its files have been touched (have any documentation).
 *
 * @param dir - Directory with coverage stats
 * @param threshold - Coverage threshold (default 0.5 = 50%)
 * @returns true if directory is covered
 */
export function isDirectoryCovered(
  dir: UndocumentedDirectory,
  threshold: number = 0.5
): boolean {
  // Coverage = 1 - undocumentedRatio
  // Covered if coverage > threshold
  // Which means: (1 - undocumentedRatio) > threshold
  // Or: undocumentedRatio < (1 - threshold)
  return dir.undocumentedRatio < (1 - threshold);
}

/**
 * Select directories for Phase 2 breadth work using BFS traversal.
 *
 * This approach:
 * 1. Identifies source roots (directories with no parent in the list)
 * 2. Traverses breadth-first, processing siblings before children
 * 3. Selects uncovered directories for work
 * 4. Descends into covered directories to find uncovered children
 *
 * Benefits over the previous "focus strategy":
 * - Naturally processes level-by-level (no round-robin problem)
 * - Simpler algorithm (~30 lines vs ~100+)
 * - Deterministic ordering via alphabetical sort at each level
 *
 * @param directories - All directories with their coverage stats
 * @param maxDirectories - Maximum directories to select (default MAX_FOCUS_DIRECTORIES)
 * @returns Array of directory paths to explore
 */
export function selectDirectoriesForBreadthWork(
  directories: UndocumentedDirectory[],
  maxDirectories: number = MAX_FOCUS_DIRECTORIES
): string[] {
  if (directories.length === 0) {
    return [];
  }

  // Build a map for quick coverage lookup
  const coverageMap = new Map<string, UndocumentedDirectory>();
  const allPaths: string[] = [];
  for (const dir of directories) {
    coverageMap.set(dir.path, dir);
    allPaths.push(dir.path);
  }

  // Find source roots (directories with no parent in the list)
  const roots = getChildDirectories('', allPaths);

  // BFS traversal
  const queue: string[] = [...roots];
  const selected: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0 && selected.length < maxDirectories) {
    const dirPath = queue.shift()!;

    if (visited.has(dirPath)) {
      continue;
    }
    visited.add(dirPath);

    const dir = coverageMap.get(dirPath);

    // If we don't have coverage info for this directory, skip it
    // (it might be a parent directory not in the original list)
    if (!dir) {
      // Still add children to explore
      const children = getChildDirectories(dirPath, allPaths);
      queue.push(...children);
      continue;
    }

    if (isDirectoryCovered(dir)) {
      // Directory is covered - descend to children
      const children = getChildDirectories(dirPath, allPaths);
      queue.push(...children);
    } else {
      // Directory is NOT covered - select it for work
      selected.push(dirPath);
    }
  }

  return selected;
}

/**
 * Create an exploration work item with priority files.
 *
 * This helper function extracts low-coverage files for the target directory
 * and includes them as priorityFiles in the work item. This ensures the
 * codebase-explorer agent reads undocumented files first, fixing the issue
 * where it would re-read the same files on every visit.
 *
 * @param dirPath - Directory path to explore
 * @param repoId - Repository ID
 * @param lowCoverageFiles - Array of files with low coverage
 * @returns WorkItem with priorityFiles for coverage-aware exploration
 */
export function createExplorationWorkItem(
  dirPath: string,
  repoId: string,
  lowCoverageFiles: LowCoverageFile[]
): ReturnType<typeof createWorkItem> {
  // Get low-coverage files in this directory
  const priorityFiles = lowCoverageFiles
    .filter(f => f.directory === dirPath)
    .map(f => f.path)
    .slice(0, MAX_PRIORITY_FILES);

  // Build target - only include priorityFiles if non-empty
  const target: { type: 'path'; path: string; priorityFiles?: string[] } =
    priorityFiles.length > 0
      ? { type: 'path', path: dirPath, priorityFiles }
      : { type: 'path', path: dirPath };

  return createWorkItem({
    id: generateWorkItemId(repoId, 'codebase-explorer', target),
    repoId,
    agentType: 'codebase-explorer',
    target,
  });
}

/**
 * Phased Orchestrator implementation.
 */
export class PhasedOrchestrator implements Orchestrator {
  private contextGatherer: ContextGatherer;
  private config: OrchestratorConfig;

  constructor(
    private readonly repos: Repositories,
    private readonly llm?: LLMService,
    config?: OrchestratorConfig,
    private readonly repoAccessFactory?: UnifiedRepoAccessFactory
  ) {
    this.contextGatherer = new ContextGatherer(repos, repoAccessFactory);
    this.config = {
      useLLM: config?.useLLM ?? false,
      model: config?.model ?? 'anthropic/claude-haiku-4.5',
    };
  }

  /**
   * Generate a prioritized work list based on current phase.
   */
  async generateWorkList(
    repoId: string,
    wikiId: string,
    maxItems: number = 10
  ): Promise<WorkItem[]> {
    const startTime = Date.now();

    // Check for bootstrap first (special case)
    const bootstrapWork = await this.checkBootstrapNeeded(repoId, wikiId);
    if (bootstrapWork) {
      // Record bootstrap decision
      const context = await this.contextGatherer.gather(repoId, wikiId);
      await this.recordOrchestratorRun(
        repoId,
        context,
        Phase.Reconnaissance,
        null,
        'Bootstrap required - wiki is empty, initializing documentation.',
        [bootstrapWork],
        startTime
      );
      return [bootstrapWork];
    }

    // Fetch existing work keys for deduplication
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    // Check pending work count
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingWork = pendingResult.data || 0;

    if (pendingWork >= maxItems) {
      return [];
    }

    const remainingSlots = maxItems - pendingWork;

    // Gather context
    const context = await this.contextGatherer.gather(repoId, wikiId);

    // Build phase context
    const phaseCtx = await this.buildPhaseContext(repoId, wikiId, context);
    const phase = detectPhase(phaseCtx);

    console.log(`📊 Phase: ${Phase[phase]} (pages=${phaseCtx.pages}, dirs=${phaseCtx.directoriesWithAnyCoverage}, conf=${(phaseCtx.avgConfidence * 100).toFixed(0)}%)`);

    // Debug output for phase context and coverage
    if (isDebugEnabled()) {
      debugSection('Phase Context');
      debugLog(`pages: ${phaseCtx.pages}`);
      debugLog(`directoriesWithAnyCoverage: ${phaseCtx.directoriesWithAnyCoverage}`);
      debugLog(`lowestDirectoryCoverage: ${phaseCtx.lowestDirectoryCoverage.toFixed(1)}%`);
      debugLog(`touchedFilesRatio: ${(phaseCtx.touchedFilesRatio * 100).toFixed(1)}% (${context.touchedFiles}/${context.totalSourceFiles} files)`);
      debugLog(`avgConfidence: ${(phaseCtx.avgConfidence * 100).toFixed(1)}%`);
      debugLog(`lowConfidenceRatio: ${(phaseCtx.lowConfidenceRatio * 100).toFixed(1)}%`);
      debugLog(`openFindings: ${phaseCtx.openFindings}`);
      debugLog(`Key pages: overview=${phaseCtx.hasProjectOverview}, getting-started=${phaseCtx.hasGettingStarted}, testing=${phaseCtx.hasTestingGuide}, extension=${phaseCtx.hasExtensionGuide}`);

      debugSection('Phase Detection Logic');
      if (phaseCtx.pages === 0) {
        debugLog(`→ Phase 0 (Reconnaissance): pages === 0`);
      } else if (phaseCtx.pages < 10 || phaseCtx.directoriesWithAnyCoverage < 3) {
        debugLog(`→ Phase 1 (Skeleton): pages=${phaseCtx.pages} < 10 OR dirs=${phaseCtx.directoriesWithAnyCoverage} < 3`);
      } else if (phaseCtx.touchedFilesRatio < TOUCHED_FILES_THRESHOLD || phaseCtx.pages < 25) {
        debugLog(`→ Phase 2 (Breadth): touchedFilesRatio=${(phaseCtx.touchedFilesRatio * 100).toFixed(1)}% < ${(TOUCHED_FILES_THRESHOLD * 100).toFixed(0)}% OR pages=${phaseCtx.pages} < 25`);
      } else {
        debugLog(`→ Phase ${phase} based on key pages / confidence`);
      }

      debugSection(`Undocumented Directories (${context.undocumentedDirectories.length} total)`);
      const topDirs = context.undocumentedDirectories.slice(0, 15);
      for (const dir of topDirs) {
        debugLog(formatDirectoryCoverage(dir));
      }
      if (context.undocumentedDirectories.length > 15) {
        debugLog(`... and ${context.undocumentedDirectories.length - 15} more directories`);
      }

      debugSection(`Low Coverage Files (${context.lowCoverageFiles.length} total)`);
      const topFiles = context.lowCoverageFiles.slice(0, 20);
      for (const file of topFiles) {
        debugLog(`${file.coverage.toFixed(0)}% ${file.path}`);
      }
      if (context.lowCoverageFiles.length > 20) {
        debugLog(`... and ${context.lowCoverageFiles.length - 20} more files`);
      }

      debugSection('Existing Work Keys (pending)');
      debugLog(`${existingWorkKeys.size} work items already pending`);
    }

    // Generate work based on phase
    const workItems = await this.generatePhaseWork(
      phase,
      repoId,
      wikiId,
      context,
      existingWorkKeys,
      remainingSlots
    );

    // Debug: Final work item summary
    if (isDebugEnabled()) {
      debugSection('Generated Work Items');
      if (workItems.length === 0) {
        debugLog('No work items generated');
      } else {
        for (let i = 0; i < workItems.length; i++) {
          const item = workItems[i]!;
          let targetDesc = '';
          if (item.target.type === 'path') {
            const pathTarget = item.target as { path: string; priorityFiles?: string[] };
            const fileCount = pathTarget.priorityFiles?.length ?? 0;
            targetDesc = `path:${pathTarget.path}` + (fileCount > 0 ? ` (${fileCount} priority files)` : '');
          } else if (item.target.type === 'commit') {
            targetDesc = `commit:${(item.target as { commitId: string }).commitId.slice(0, 8)}`;
          } else {
            targetDesc = 'wiki';
          }
          debugLog(`  ${i + 1}. ${item.agentType} → ${targetDesc}`);
        }
      }
      debugLog(`\nTotal: ${workItems.length} work items`);
    }

    // Record orchestrator decision
    if (workItems.length > 0) {
      const reasoning = this.buildPhaseReasoning(phase, phaseCtx, workItems, context);
      await this.recordOrchestratorRun(
        repoId,
        context,
        phase,
        phaseCtx,
        reasoning,
        workItems,
        startTime
      );
    }

    return workItems;
  }

  /**
   * Build human-readable reasoning for the phase-based decision.
   * Includes comprehensive decision inputs for debugging/observability.
   */
  private buildPhaseReasoning(
    phase: Phase,
    phaseCtx: PhaseContext,
    workItems: WorkItem[],
    context?: OrchestratorContext
  ): string {
    const phaseName = Phase[phase];

    // Build summary line
    const summaryMetrics = [
      `${phaseCtx.pages} pages`,
      `${phaseCtx.directoriesWithAnyCoverage} dirs covered`,
      `${(phaseCtx.avgConfidence * 100).toFixed(0)}% avg confidence`,
    ];
    const workSummary = this.summarizeWorkItems(workItems);
    const summary = `Phase ${phase} (${phaseName}): ${summaryMetrics.join(', ')}. Scheduling: ${workSummary}`;

    // Build decision inputs section
    const inputs: string[] = [];
    inputs.push('');
    inputs.push('**Decision Inputs:**');
    inputs.push(`- Pages: ${phaseCtx.pages}`);
    inputs.push(`- Directories with coverage: ${phaseCtx.directoriesWithAnyCoverage}`);
    inputs.push(`- Lowest directory coverage: ${phaseCtx.lowestDirectoryCoverage.toFixed(1)}%`);
    inputs.push(`- Touched files: ${(phaseCtx.touchedFilesRatio * 100).toFixed(1)}% (threshold: ${(TOUCHED_FILES_THRESHOLD * 100).toFixed(0)}%)`);
    inputs.push(`- Avg confidence: ${(phaseCtx.avgConfidence * 100).toFixed(1)}%`);
    inputs.push(`- Low confidence ratio: ${(phaseCtx.lowConfidenceRatio * 100).toFixed(1)}%`);
    inputs.push(`- Open findings: ${phaseCtx.openFindings}`);

    // Key pages status
    const keyPages = [];
    if (phaseCtx.hasProjectOverview) keyPages.push('project-overview ✓');
    else keyPages.push('project-overview ✗');
    if (phaseCtx.hasGettingStarted) keyPages.push('getting-started ✓');
    else keyPages.push('getting-started ✗');
    if (phaseCtx.hasTestingGuide) keyPages.push('testing-guide ✓');
    else keyPages.push('testing-guide ✗');
    if (phaseCtx.hasExtensionGuide) keyPages.push('extension-guide ✓');
    else keyPages.push('extension-guide ✗');
    inputs.push(`- Key pages: ${keyPages.join(', ')}`);

    // Phase transition explanation
    inputs.push('');
    inputs.push('**Phase Transition Logic:**');
    inputs.push(this.explainPhaseTransition(phase, phaseCtx));

    // Directory selection (if we have context)
    if (context && context.undocumentedDirectories.length > 0) {
      inputs.push('');
      inputs.push('**Directory Selection:**');

      if (phase === Phase.Breadth) {
        // Phase 2 uses BFS
        inputs.push(`- Algorithm: BFS traversal`);
        inputs.push(`- Coverage threshold: >50% files touched = covered`);

        const selectedPaths = selectDirectoriesForBreadthWork(
          context.undocumentedDirectories,
          MAX_FOCUS_DIRECTORIES
        );

        if (selectedPaths.length > 0) {
          inputs.push(`- Selected via BFS (max ${MAX_FOCUS_DIRECTORIES}):`);
          for (const path of selectedPaths) {
            const dir = context.undocumentedDirectories.find(d => d.path === path);
            const coveragePct = dir ? ((1 - dir.undocumentedRatio) * 100).toFixed(1) : '?';
            inputs.push(`  - ${path}: ${coveragePct}% coverage`);
          }
        }
      } else {
        // Other phases use focus strategy
        const phaseThreshold = this.getPhaseThreshold(phase);
        inputs.push(`- Phase threshold: ${((1 - phaseThreshold) * 100).toFixed(0)}% coverage (undocRatio ≤ ${phaseThreshold})`);

        const prioritized = prioritizeDirectoriesForPhase(
          context.undocumentedDirectories,
          phaseThreshold
        );
        const inProgress = prioritized.filter(d => d.undocumentedRatio < 1.0);
        const notStarted = prioritized.filter(d => d.undocumentedRatio === 1.0);

        inputs.push(`- In-progress directories: ${inProgress.length}`);
        inputs.push(`- Not-started directories: ${notStarted.length}`);

        // Show top prioritized directories
        const topDirs = prioritized.slice(0, MAX_FOCUS_DIRECTORIES);
        if (topDirs.length > 0) {
          inputs.push(`- Selected for work (max ${MAX_FOCUS_DIRECTORIES}):`);
          for (const dir of topDirs) {
            const status = dir.undocumentedRatio < 1.0 ? 'in-progress' : 'not-started';
            const coveragePct = ((1 - dir.undocumentedRatio) * 100).toFixed(1);
            inputs.push(`  - ${dir.path}: ${coveragePct}% coverage (${status})`);
          }
        }
      }
    }

    return summary + inputs.join('\n');
  }

  /**
   * Explain why the current phase was selected and what blocks transition to the next.
   */
  private explainPhaseTransition(phase: Phase, ctx: PhaseContext): string {
    switch (phase) {
      case Phase.Reconnaissance:
        return `- Current: Phase 0 (Reconnaissance) - pages === 0\n- Blocked by: No wiki pages exist yet`;

      case Phase.Skeleton:
        if (ctx.pages < 10) {
          return `- Current: Phase 1 (Skeleton) - pages (${ctx.pages}) < 10\n- Blocked by: Need ${10 - ctx.pages} more pages to advance`;
        }
        return `- Current: Phase 1 (Skeleton) - dirs (${ctx.directoriesWithAnyCoverage}) < 3\n- Blocked by: Need ${3 - ctx.directoriesWithAnyCoverage} more directories with coverage`;

      case Phase.Breadth: {
        const blockers = [];
        if (ctx.touchedFilesRatio < TOUCHED_FILES_THRESHOLD) {
          blockers.push(`touched files ${(ctx.touchedFilesRatio * 100).toFixed(1)}% < ${(TOUCHED_FILES_THRESHOLD * 100).toFixed(0)}%`);
        }
        if (ctx.pages < 25) {
          blockers.push(`pages (${ctx.pages}) < 25`);
        }
        return `- Current: Phase 2 (Breadth)\n- Blocked by: ${blockers.join(', ')}`;
      }

      case Phase.DepthAndGuides: {
        const missing = [];
        if (!ctx.hasProjectOverview) missing.push('project-overview');
        if (!ctx.hasGettingStarted) missing.push('getting-started');
        if (!ctx.hasTestingGuide) missing.push('testing-guide');
        if (!ctx.hasExtensionGuide) missing.push('extension-guide');
        const blockers = [];
        if (missing.length > 0) blockers.push(`missing key pages: ${missing.join(', ')}`);
        if (ctx.avgConfidence < 0.65) blockers.push(`avg confidence ${(ctx.avgConfidence * 100).toFixed(1)}% < 65%`);
        return `- Current: Phase 3 (Depth & Guides)\n- Blocked by: ${blockers.join('; ') || 'none (advancing soon)'}`;
      }

      case Phase.Polish: {
        const blockers = [];
        if (ctx.lowConfidenceRatio > 0.10) blockers.push(`low confidence ratio ${(ctx.lowConfidenceRatio * 100).toFixed(1)}% > 10%`);
        if (ctx.openFindings > 5) blockers.push(`open findings (${ctx.openFindings}) > 5`);
        return `- Current: Phase 4 (Polish)\n- Blocked by: ${blockers.join('; ') || 'none (advancing soon)'}`;
      }

      case Phase.Maintenance:
        return `- Current: Phase 5 (Maintenance) - wiki is mature\n- Status: Active maintenance mode, processing new commits and quality improvements`;

      default:
        return `- Current: Phase ${phase}`;
    }
  }

  /**
   * Get the undocumented ratio threshold for a phase.
   * Returns the max undocumentedRatio to consider a directory "done" for that phase.
   */
  private getPhaseThreshold(phase: Phase): number {
    switch (phase) {
      case Phase.Skeleton:
      case Phase.Breadth:
        return 0.70; // 30% coverage target
      case Phase.DepthAndGuides:
        return 0.40; // 60% coverage target
      case Phase.Polish:
      case Phase.Maintenance:
        return 0.20; // 80% coverage target
      default:
        return 1.0; // No threshold for reconnaissance
    }
  }

  /**
   * Summarize work items by agent type.
   */
  private summarizeWorkItems(workItems: WorkItem[]): string {
    const counts: Record<string, number> = {};
    for (const item of workItems) {
      counts[item.agentType] = (counts[item.agentType] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([agent, count]) => `${count} ${agent}`)
      .join(', ');
  }

  /**
   * Record an orchestrator run for provenance tracking.
   */
  private async recordOrchestratorRun(
    repoId: string,
    context: OrchestratorContext,
    phase: Phase,
    phaseCtx: PhaseContext | null,
    reasoning: string,
    workItems: WorkItem[],
    startTime: number
  ): Promise<void> {
    try {
      const runId = uuid();

      // Build work item details for the decision record
      const workItemDetails = workItems.map(item => {
        const detail: {
          agentType: string;
          targetCommitId?: string;
          targetPath?: string;
          reason: string;
        } = {
          agentType: item.agentType,
          reason: this.getWorkItemReason(item, phase),
        };
        if (item.target.type === 'commit') {
          detail.targetCommitId = item.target.commitId;
        } else if (item.target.type === 'path') {
          detail.targetPath = item.target.path;
        }
        return detail;
      });

      const orchestratorRun = createOrchestratorRun({
        id: runId,
        repoId,
        context,
        promptSent: `[phased orchestrator - Phase ${phase} (${Phase[phase]})]`,
      });

      orchestratorRun.rawResponse = reasoning;
      orchestratorRun.decision = {
        reasoning,
        workItems: workItemDetails,
      };
      orchestratorRun.workItemsCreated = workItems.map(w => w.id);
      orchestratorRun.model = `phased-orchestrator:${Phase[phase]}`;
      orchestratorRun.costUsd = 0; // No LLM cost for phased orchestrator
      orchestratorRun.durationMs = Date.now() - startTime;
      orchestratorRun.usedLLM = false;

      // Link work items back to this orchestrator run
      for (const item of workItems) {
        item.orchestratorRunId = runId;
      }

      await this.repos.orchestratorRuns.save(orchestratorRun);
    } catch (error) {
      // Don't fail work generation if recording fails
      console.warn('Failed to record orchestrator run:', error);
    }
  }

  /**
   * Get a reason description for a work item based on phase context.
   */
  private getWorkItemReason(item: WorkItem, phase: Phase): string {
    const phaseName = Phase[phase];

    switch (item.agentType) {
      case 'bootstrap':
        return 'Initialize wiki with project structure';
      case 'codebase-explorer':
        if (item.target.type === 'path') {
          return `${phaseName}: Explore undocumented path ${item.target.path}`;
        }
        return `${phaseName}: Explore codebase`;
      case 'code-change':
        if (item.target.type === 'commit') {
          return `${phaseName}: Analyze commit ${item.target.commitId.slice(0, 8)}`;
        }
        return `${phaseName}: Analyze code changes`;
      case 'project-overview':
      case 'getting-started':
      case 'testing-guide':
      case 'extension-guide':
        return `${phaseName}: Create missing key page`;
      case 'quality':
      case 'consistency':
      case 'writer':
      case 'consolidation':
        return `${phaseName}: Improve wiki quality`;
      case 'wiki-index':
      case 'overview':
      case 'link':
        return `${phaseName}: Improve wiki structure`;
      default:
        return `${phaseName}: ${item.agentType} task`;
    }
  }

  /**
   * Build phase context from orchestrator context.
   */
  private async buildPhaseContext(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext
  ): Promise<PhaseContext> {
    // Count directories we know about
    // For phase detection, we care about "directories explored" rather than "directories fully documented"
    // If we have directory info, count total directories (even if undocumented)
    // If no directory info, estimate from page count
    const hasDirectoryInfo = context.undocumentedDirectories.length > 0;

    // For phase detection: count directories where we have SOME coverage (not 100% undocumented)
    // But also consider: if we have many pages, we've likely explored even if coverage calc can't see it
    const dirsWithSomeCoverage = hasDirectoryInfo
      ? context.undocumentedDirectories.filter(d => d.undocumentedRatio < 1.0).length
      : 0;

    // Estimate explored dirs based on page count as a fallback
    const estimatedDirs = Math.min(Math.floor(context.wikiPages / 3), 10);

    // Use the higher of actual coverage or estimate
    const dirsWithCoverage = Math.max(dirsWithSomeCoverage, estimatedDirs);

    // Find lowest coverage among ALL directories (including fully undocumented ones)
    // This fixes a bug where ratio=1.0 directories were excluded from the calculation
    const lowestCoverage = calculateLowestDirectoryCoverage(
      context.undocumentedDirectories,
      context.wikiPages
    );

    // Get open findings count
    const findingsQuery = createListOpenFindingsQuery(wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, this.repos);
    const openFindings = findingsResult.data?.length || 0;

    // Calculate low confidence ratio
    const lowConfidenceRatio = context.wikiPages > 0
      ? context.lowConfidencePages / context.wikiPages
      : 0;

    // Calculate touched files ratio for Phase 2 transition
    // A file is "touched" if it has any documentation score > 0
    const touchedFilesRatio = context.totalSourceFiles > 0
      ? context.touchedFiles / context.totalSourceFiles
      : 0;

    return {
      pages: context.wikiPages,
      directoriesWithAnyCoverage: dirsWithCoverage,
      lowestDirectoryCoverage: lowestCoverage,
      touchedFilesRatio,
      avgConfidence: context.avgConfidence,
      hasProjectOverview: context.hasProjectOverview,
      hasGettingStarted: context.hasGettingStarted,
      hasTestingGuide: context.hasTestingGuide,
      hasExtensionGuide: context.hasExtensionGuide,
      lowConfidenceRatio,
      openFindings,
    };
  }

  /**
   * Generate work items for a specific phase.
   */
  private async generatePhaseWork(
    phase: Phase,
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    switch (phase) {
      case Phase.Reconnaissance:
        return this.generateReconnaissanceWork(repoId, context, existingWorkKeys, maxItems);
      case Phase.Skeleton:
        return this.generateSkeletonWork(repoId, context, existingWorkKeys, maxItems);
      case Phase.Breadth:
        return this.generateBreadthWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.DepthAndGuides:
        return this.generateDepthAndGuidesWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.Polish:
        return this.generatePolishWork(repoId, wikiId, context, existingWorkKeys, maxItems);
      case Phase.Maintenance:
        return this.generateMaintenanceWork(repoId, context, existingWorkKeys, maxItems);
      default:
        return [];
    }
  }

  /**
   * Phase 0: Reconnaissance - Analyze recent commits before exploration.
   */
  private async generateReconnaissanceWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Analyze recent commits with code-change and narrative
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, 5);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const target = { type: 'commit' as const, commitId: commit.id };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', target),
        repoId,
        agentType: 'code-change',
        target,
      }));
    }

    // Also analyze with narrative agent
    const narrativeUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('narrative')
    ).slice(0, 3);

    for (const commit of narrativeUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `narrative:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const target = { type: 'commit' as const, commitId: commit.id };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, 'narrative', target),
        repoId,
        agentType: 'narrative',
        target,
      }));
    }

    return workItems;
  }

  /**
   * Phase 1: Skeleton - Build navigable structure.
   * Focus on MAX_FOCUS_DIRECTORIES at a time, plus commits and structure.
   */
  private async generateSkeletonWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Phase 1→2 requires 30% coverage (undocumentedRatio <= 0.70)
    const phaseThreshold = 0.70;

    // Prioritize in-progress directories, limit to MAX_FOCUS_DIRECTORIES
    const prioritizedDirs = prioritizeDirectoriesForPhase(
      context.undocumentedDirectories,
      phaseThreshold
    ).slice(0, MAX_FOCUS_DIRECTORIES);

    for (const dir of prioritizedDirs) {
      if (workItems.length >= maxItems - 2) break; // Reserve slots for commits/structure

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      // Use helper that includes priorityFiles for coverage-aware exploration
      workItems.push(createExplorationWorkItem(
        dir.path,
        repoId,
        context.lowCoverageFiles
      ));
    }

    // 20% recent commits
    const commitSlots = Math.ceil(maxItems * 0.2);
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, commitSlots);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const commitTarget = { type: 'commit' as const, commitId: commit.id };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', commitTarget),
        repoId,
        agentType: 'code-change',
        target: commitTarget,
      }));
    }

    // 10% structure - wiki-index if pages >= 5
    if (workItems.length < maxItems && context.wikiPages >= 5) {
      const key = 'wiki-index:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'wiki-index', wikiTarget),
          repoId,
          agentType: 'wiki-index',
          target: wikiTarget,
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 2: Breadth - Cover all directories using BFS traversal.
   *
   * Uses breadth-first search to:
   * 1. Process directories level-by-level (siblings before children)
   * 2. Descend into covered directories to find uncovered children
   * 3. Naturally avoid the "round-robin" problem without complex prioritization
   */
  private async generateBreadthWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Use BFS to select directories for exploration
    const selectedPaths = selectDirectoriesForBreadthWork(
      context.undocumentedDirectories,
      MAX_FOCUS_DIRECTORIES
    );

    // Debug: Show BFS selection results
    if (isDebugEnabled()) {
      debugSection('Phase 2 (Breadth) BFS Directory Selection');
      debugLog(`Total directories in context: ${context.undocumentedDirectories.length}`);
      debugLog(`Coverage threshold: >50% files touched = covered`);
      debugLog(`\nSelected directories via BFS (max ${MAX_FOCUS_DIRECTORIES}):`);

      for (let i = 0; i < selectedPaths.length; i++) {
        const dirPath = selectedPaths[i]!;
        const dir = context.undocumentedDirectories.find(d => d.path === dirPath);
        const coveragePct = dir ? ((1 - dir.undocumentedRatio) * 100).toFixed(1) : '?';
        debugLog(`  ${i + 1}. ${dirPath} → ${coveragePct}% coverage`);

        // Show priority files for this directory
        const dirFiles = context.lowCoverageFiles
          .filter(f => f.directory === dirPath)
          .slice(0, 5);
        if (dirFiles.length > 0) {
          for (const file of dirFiles) {
            debugLog(`       └─ ${file.coverage.toFixed(0)}% ${file.path.split('/').pop()}`);
          }
          const remaining = context.lowCoverageFiles.filter(f => f.directory === dirPath).length - 5;
          if (remaining > 0) {
            debugLog(`       └─ ... and ${remaining} more files`);
          }
        }
      }
    }

    // Create exploration work items for selected directories
    for (const dirPath of selectedPaths) {
      if (workItems.length >= maxItems - 2) break; // Reserve slots for commits/structure

      const key = `codebase-explorer:path:${dirPath}`;
      if (existingWorkKeys.has(key)) {
        if (isDebugEnabled()) {
          debugLog(`SKIPPED (already pending): ${key}`);
        }
        continue;
      }
      existingWorkKeys.add(key);

      // Use helper that includes priorityFiles for coverage-aware exploration
      const workItem = createExplorationWorkItem(
        dirPath,
        repoId,
        context.lowCoverageFiles
      );
      workItems.push(workItem);

      if (isDebugEnabled()) {
        const priorityFiles = workItem.target.type === 'path' && 'priorityFiles' in workItem.target
          ? (workItem.target as { priorityFiles?: string[] }).priorityFiles ?? []
          : [];
        debugLog(`CREATED: codebase-explorer → ${dirPath} (${priorityFiles.length} priority files)`);
      }
    }

    // 20% commits
    const commitSlots = Math.ceil(maxItems * 0.2);
    const recentUnprocessed = context.recentCommits.filter(
      c => !c.processedBy.includes('code-change')
    ).slice(0, commitSlots);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maxItems - 2) break; // Reserve 2 slots

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const commitTarget = { type: 'commit' as const, commitId: commit.id };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', commitTarget),
        repoId,
        agentType: 'code-change',
        target: commitTarget,
      }));
    }

    // 10% overview - for categories with 3+ pages
    if (workItems.length < maxItems && context.categoriesWithoutOverview.length > 0) {
      const key = 'overview:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'overview', wikiTarget),
          repoId,
          agentType: 'overview',
          target: wikiTarget,
        }));
      }
    }

    // 10% link
    if (workItems.length < maxItems && context.pagesWithoutLinks > 3) {
      const key = 'link:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'link', wikiTarget),
          repoId,
          agentType: 'link',
          target: wikiTarget,
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 3: Depth and Guides.
   * Deepen coverage to 60%, create synthesis pages, process commits.
   */
  private async generateDepthAndGuidesWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Phase 3 targets 60% coverage (undocumentedRatio <= 0.40)
    const phaseThreshold = 0.40;

    // Prioritize in-progress directories, limit to MAX_FOCUS_DIRECTORIES
    const prioritizedDirs = prioritizeDirectoriesForPhase(
      context.undocumentedDirectories,
      phaseThreshold
    ).slice(0, MAX_FOCUS_DIRECTORIES);

    for (const dir of prioritizedDirs) {
      if (workItems.length >= maxItems - 3) break; // Reserve slots for synthesis/quality

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      // Use helper that includes priorityFiles for coverage-aware exploration
      workItems.push(createExplorationWorkItem(
        dir.path,
        repoId,
        context.lowCoverageFiles
      ));
    }

    // 25% synthesis - key pages in priority order
    const synthesisSlots = Math.ceil(maxItems * 0.25);
    const synthesisAgents: Array<{ agent: string; check: boolean }> = [
      { agent: 'project-overview', check: !context.hasProjectOverview },
      { agent: 'getting-started', check: !context.hasGettingStarted },
      { agent: 'testing-guide', check: !context.hasTestingGuide },
      { agent: 'extension-guide', check: !context.hasExtensionGuide },
    ];

    let synthesisAdded = 0;
    for (const { agent, check } of synthesisAgents) {
      if (synthesisAdded >= synthesisSlots) break;
      if (!check) continue;

      const key = `${agent}:wiki`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const wikiTarget = { type: 'wiki' as const };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, agent as AgentType, wikiTarget),
        repoId,
        agentType: agent as AgentType,
        target: wikiTarget,
      }));
      synthesisAdded++;
    }

    // 20% commits - expand to more agent types
    const commitAgents: AgentType[] = ['code-change', 'security', 'dependency'];

    for (const agentType of commitAgents) {
      if (workItems.length >= maxItems - 1) break; // Reserve 1 slot

      const unprocessed = context.recentCommits.filter(
        c => !c.processedBy.includes(agentType)
      ).slice(0, 2);

      for (const commit of unprocessed) {
        if (workItems.length >= maxItems - 1) break;

        const key = `${agentType}:commit:${commit.id}`;
        if (existingWorkKeys.has(key)) continue;
        existingWorkKeys.add(key);

        const commitTarget = { type: 'commit' as const, commitId: commit.id };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, agentType, commitTarget),
          repoId,
          agentType,
          target: commitTarget,
        }));
      }
    }

    // 15% quality
    if (workItems.length < maxItems && context.lowConfidencePages > 0) {
      const key = 'quality:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'quality', wikiTarget),
          repoId,
          agentType: 'quality',
          target: wikiTarget,
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 4: Polish - Quality-focused.
   * 50% meta agents, 30% coverage gaps, 20% commits.
   */
  private async generatePolishWork(
    repoId: string,
    wikiId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // 50% meta/quality agents
    const qualityAgents: AgentType[] = ['quality', 'consistency', 'writer', 'consolidation'];
    const qualitySlots = Math.ceil(maxItems * 0.5);

    for (const agentType of qualityAgents) {
      if (workItems.length >= qualitySlots) break;

      const key = `${agentType}:wiki`;
      if (existingWorkKeys.has(key)) continue;

      // Skip writer if no pages need rewrite
      if (agentType === 'writer' && context.pagesNeedingRewrite === 0) continue;

      existingWorkKeys.add(key);
      const wikiTarget = { type: 'wiki' as const };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, agentType, wikiTarget),
        repoId,
        agentType,
        target: wikiTarget,
      }));
    }

    // Coverage gaps - target 80% coverage (undocumentedRatio <= 0.20)
    const phaseThreshold = 0.20;

    // Prioritize in-progress directories, limit to MAX_FOCUS_DIRECTORIES
    const prioritizedDirs = prioritizeDirectoriesForPhase(
      context.undocumentedDirectories,
      phaseThreshold
    ).slice(0, MAX_FOCUS_DIRECTORIES);

    for (const dir of prioritizedDirs) {
      if (workItems.length >= maxItems - 2) break; // Reserve slots for commits

      const key = `codebase-explorer:path:${dir.path}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      // Use helper that includes priorityFiles for coverage-aware exploration
      workItems.push(createExplorationWorkItem(
        dir.path,
        repoId,
        context.lowCoverageFiles
      ));
    }

    // 20% remaining commits
    for (const agentType of ANALYSIS_AGENTS) {
      if (workItems.length >= maxItems) break;

      const unprocessed = context.recentCommits.filter(
        c => !c.processedBy.includes(agentType)
      ).slice(0, 1);

      for (const commit of unprocessed) {
        if (workItems.length >= maxItems) break;

        const key = `${agentType}:commit:${commit.id}`;
        if (existingWorkKeys.has(key)) continue;
        existingWorkKeys.add(key);

        const commitTarget = { type: 'commit' as const, commitId: commit.id };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, agentType, commitTarget),
          repoId,
          agentType,
          target: commitTarget,
        }));
      }
    }

    return workItems;
  }

  /**
   * Phase 5: Maintenance - Active maintenance with lighter workload.
   *
   * Unlike earlier phases, Maintenance focuses on:
   * 1. Processing new commits (reactive)
   * 2. Quality improvements for existing pages
   * 3. Filling remaining coverage gaps
   * 4. Consistency checks
   *
   * This ensures the wiki continues improving even when coverage is high.
   */
  private async generateMaintenanceWork(
    repoId: string,
    context: OrchestratorContext,
    existingWorkKeys: Set<string>,
    maxItems: number
  ): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];
    const maintenanceMax = Math.min(5, maxItems); // Allow up to 5 items

    // 1. Process new commits (highest priority - reactive to changes)
    const recentUnprocessed = context.recentCommits.filter(
      c => c.processedBy.length === 0
    ).slice(0, 2);

    for (const commit of recentUnprocessed) {
      if (workItems.length >= maintenanceMax) break;

      const key = `code-change:commit:${commit.id}`;
      if (existingWorkKeys.has(key)) continue;
      existingWorkKeys.add(key);

      const commitTarget = { type: 'commit' as const, commitId: commit.id };
      workItems.push(createWorkItem({
        id: generateWorkItemId(repoId, 'code-change', commitTarget),
        repoId,
        agentType: 'code-change',
        target: commitTarget,
      }));
    }

    // 2. Quality improvements for low-confidence pages
    if (workItems.length < maintenanceMax && context.lowConfidencePages > 0) {
      const key = 'quality:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'quality', wikiTarget),
          repoId,
          agentType: 'quality',
          target: wikiTarget,
        }));
      }
    }

    // 3. Fill remaining coverage gaps (any undocumented directories)
    if (workItems.length < maintenanceMax && context.undocumentedDirectories.length > 0) {
      // Target directories with highest undocumented ratio first
      const sortedDirs = [...context.undocumentedDirectories]
        .sort((a, b) => b.undocumentedRatio - a.undocumentedRatio);

      for (const dir of sortedDirs.slice(0, 2)) {
        if (workItems.length >= maintenanceMax) break;

        const key = `codebase-explorer:path:${dir.path}`;
        if (existingWorkKeys.has(key)) continue;
        existingWorkKeys.add(key);

        workItems.push(createExplorationWorkItem(
          dir.path,
          repoId,
          context.lowCoverageFiles
        ));
      }
    }

    // 4. Consistency check if no other work and pages need it
    if (workItems.length < maintenanceMax && context.pagesNeedingRewrite > 0) {
      const key = 'consistency:wiki';
      if (!existingWorkKeys.has(key)) {
        existingWorkKeys.add(key);
        const wikiTarget = { type: 'wiki' as const };
        workItems.push(createWorkItem({
          id: generateWorkItemId(repoId, 'consistency', wikiTarget),
          repoId,
          agentType: 'consistency',
          target: wikiTarget,
        }));
      }
    }

    return workItems;
  }

  /**
   * Check if bootstrap is needed for an empty wiki.
   */
  private async checkBootstrapNeeded(
    repoId: string,
    wikiId: string
  ): Promise<WorkItem | null> {
    const pagesQuery = createListWikiPagesQuery(wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, this.repos);
    const wikiPages = pagesResult.data || [];

    if (wikiPages.length > 0) {
      return null;
    }

    // Check if bootstrap already pending, claimed, or completed
    const runsQuery = createListAgentRunsQuery(repoId);
    const runsResult = await handleListAgentRuns(runsQuery, this.repos);
    const recentRuns = runsResult.data || [];

    const bootstrapRun = recentRuns.find(r => r.agentType === 'bootstrap');
    if (bootstrapRun) {
      return null;
    }

    // Check pending work
    const keysQuery = createGetPendingWorkKeysQuery(repoId);
    const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
    const existingWorkKeys = keysResult.data || new Set<string>();

    if (existingWorkKeys.has('bootstrap:wiki')) {
      return null;
    }

    const target = { type: 'wiki' as const };
    return createWorkItem({
      id: generateWorkItemId(repoId, 'bootstrap', target),
      repoId,
      agentType: 'bootstrap',
      target,
    });
  }

  /**
   * Check if there's more work to do.
   */
  async hasMoreWork(repoId: string, wikiId: string): Promise<boolean> {
    // Check for pending work
    const pendingQuery = createCountPendingWorkQuery(repoId);
    const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
    const pendingCount = pendingResult.data || 0;
    if (pendingCount > 0) return true;

    // Check for unprocessed commits
    for (const agentType of ANALYSIS_AGENTS) {
      const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, agentType);
      const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
      const unprocessedCommits = unprocessedResult.data || [];
      if (unprocessedCommits.length > 0) return true;
    }

    // Check for open conflicts
    const conflictsQuery = createListOpenConflictsQuery(wikiId);
    const conflictsResult = await handleListOpenConflicts(conflictsQuery, this.repos);
    const openConflicts = conflictsResult.data || [];
    if (openConflicts.length > 0) return true;

    // Check for low-confidence pages
    const lowConfQuery = createListLowConfidencePagesQuery(wikiId, 0.5);
    const lowConfResult = await handleListLowConfidencePages(lowConfQuery, this.repos);
    const lowConfidencePages = lowConfResult.data || [];
    if (lowConfidencePages.length > 0) return true;

    // Check for open findings
    const findingsQuery = createListOpenFindingsQuery(wikiId);
    const findingsResult = await handleListOpenFindings(findingsQuery, this.repos);
    const openFindings = findingsResult.data || [];
    if (openFindings.length > 0) return true;

    return false;
  }

  /**
   * Get a summary of the current work state.
   */
  async getWorkSummary(repoId: string, wikiId: string): Promise<WorkSummary> {
    const [
      totalCommitsResult,
      pendingWorkResult,
      wikiPagesResult,
      openConflictsResult,
      openFindingsResult,
    ] = await Promise.all([
      handleCountCommitsByRepo(createCountCommitsByRepoQuery(repoId), this.repos),
      handleCountPendingWork(createCountPendingWorkQuery(repoId), this.repos),
      handleListWikiPages(createListWikiPagesQuery(wikiId), this.repos),
      handleListOpenConflicts(createListOpenConflictsQuery(wikiId), this.repos),
      handleListOpenFindings(createListOpenFindingsQuery(wikiId), this.repos),
    ]);

    const totalCommits = totalCommitsResult.data || 0;
    const pendingWork = pendingWorkResult.data || 0;
    const wikiPages = wikiPagesResult.data || [];
    const openConflicts = openConflictsResult.data || [];
    const openFindings = openFindingsResult.data || [];

    // Get per-agent coverage
    const agentCoverage: Record<string, number> = {};
    for (const agentType of ANALYSIS_AGENTS) {
      const processedQuery = createCountProcessedByAgentQuery(repoId, agentType);
      const processedResult = await handleCountProcessedByAgent(processedQuery, this.repos);
      const processed = processedResult.data || 0;
      agentCoverage[agentType] = totalCommits > 0 ? (processed / totalCommits) * 100 : 0;
    }

    const codeChangeProcessedQuery = createCountProcessedByAgentQuery(repoId, 'code-change');
    const codeChangeProcessedResult = await handleCountProcessedByAgent(
      codeChangeProcessedQuery,
      this.repos
    );
    const processedCommits = codeChangeProcessedResult.data || 0;

    const avgConfidence =
      wikiPages.length > 0
        ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
        : 0;

    // Calculate file documentation coverage using tracked file relationships
    // Counts files that appear in filesAccessed OR filesReferenced (or both).
    // Uses calculateFileCoverage for ancestor inheritance (files inherit coverage
    // from documented parent directories).
    let fileDocCoverage = 0;
    let totalSourceFiles = 0;
    let documentedFiles = 0;

    if (this.repoAccessFactory) {
      try {
        const repoAccess = await this.repoAccessFactory.create(repoId);
        const allFiles = await repoAccess.getFileTree();
        const sourceFiles = allFiles.filter(f => this.isSourceFile(f));

        if (sourceFiles.length > 0) {
          // Build a combined set of all documented files from both filesAccessed AND filesReferenced
          // Note: buildFileDocumentationScores uses either/or for scoring depth, but for coverage
          // we want to count files touched in ANY way.
          const documentedFileSet = new Set<string>();
          for (const page of wikiPages) {
            // Add all files accessed (read by agents)
            for (const file of page.filesAccessed ?? []) {
              if (!file.endsWith('/')) { // Skip directory paths
                documentedFileSet.add(file);
              }
            }
            // Add all files referenced (mentioned in content)
            for (const file of page.filesReferenced ?? []) {
              if (!file.endsWith('/')) { // Skip directory paths
                documentedFileSet.add(file);
              }
            }
          }

          // Build scores map for ancestor inheritance lookup
          const documentationScores = new Map<string, number>();
          for (const file of documentedFileSet) {
            documentationScores.set(file, 1); // Binary: documented or not
          }

          // Count files with any coverage (direct or inherited from parent directories)
          let coveredCount = 0;
          for (const filePath of sourceFiles) {
            const coverage = calculateFileCoverage(filePath, documentationScores, 1);
            if (coverage > 0) {
              coveredCount++;
            }
          }

          totalSourceFiles = sourceFiles.length;
          documentedFiles = coveredCount;
          fileDocCoverage = (documentedFiles / totalSourceFiles) * 100;
        }
      } catch (error) {
        // If file coverage calculation fails, continue with zeros
        console.warn('Failed to calculate file documentation coverage:', error);
      }
    }

    return {
      totalCommits,
      processedCommits,
      coveragePercent: totalCommits > 0 ? (processedCommits / totalCommits) * 100 : 0,
      agentCoverage,
      pendingWork,
      wikiPages: wikiPages.length,
      avgConfidence,
      openConflicts: openConflicts.length,
      openFindings: openFindings.length,
      fileDocCoverage,
      totalSourceFiles,
      documentedFiles,
    };
  }

  /**
   * Check if a file path is a source file (for coverage calculation).
   */
  private isSourceFile(filePath: string): boolean {
    // Include TypeScript and JavaScript files
    if (!filePath.match(/\.(ts|js|tsx|jsx)$/)) {
      return false;
    }
    // Exclude test files
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      return false;
    }
    // Exclude type definition files
    if (filePath.endsWith('.d.ts')) {
      return false;
    }
    // Exclude common non-source directories
    if (
      filePath.includes('node_modules/') ||
      filePath.includes('dist/') ||
      filePath.includes('build/') ||
      filePath.includes('__pycache__/')
    ) {
      return false;
    }
    return true;
  }
}
