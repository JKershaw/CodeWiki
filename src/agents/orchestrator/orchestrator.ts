import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { WorkItem } from '../../domain/work-item.js';
import { createWorkItem, Priority } from '../../domain/work-item.js';
import type { AgentType } from '../../domain/agent-run.js';

/**
 * Analysis agents that process commits.
 * Order matters - code-change runs first to establish base wiki content,
 * then specialized agents add their perspectives.
 */
const ANALYSIS_AGENTS: AgentType[] = [
  'code-change',   // General code analysis - runs first
  'narrative',     // Detects ADRs, planning docs, READMEs
  'security',      // Security audit
  'pattern',       // Design patterns and conventions
  'dependency',    // Dependency changes
];

/**
 * Orchestrator - The decision-maker that produces prioritized work lists.
 *
 * Runs frequently and stays lightweight (2-3 tool calls typically).
 * It examines wiki state, commit coverage, agent history, confidence scores,
 * and any flagged issues to decide what work should happen next.
 */
export class Orchestrator {
  constructor(private readonly repos: Repositories) {}

  /**
   * Run the orchestrator to produce a prioritized work list.
   *
   * @param repoId - The repository to orchestrate
   * @param maxItems - Maximum number of work items to generate
   * @returns Work items to be processed
   */
  async generateWorkList(repoId: string, maxItems: number = 10): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Get current state
    const [
      wikiPages,
      pendingWork,
      openConflicts,
      commits,
    ] = await Promise.all([
      this.repos.wikiPages.findByRepo(repoId),
      this.repos.workQueue.countPending(repoId),
      this.repos.conflicts.findOpen(repoId),
      this.repos.commits.findByRepo(repoId, { limit: 100 }),
    ]);

    // If there's already pending work, don't add more
    if (pendingWork >= maxItems) {
      return [];
    }

    const remainingSlots = maxItems - pendingWork;

    // Strategy 1: Process unprocessed commits with all analysis agents
    // Each commit should be processed by all analysis agents for comprehensive coverage
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const agentType of ANALYSIS_AGENTS) {
      if (workItems.length >= remainingSlots) break;

      const unprocessedCommits = await this.repos.commits.findUnprocessedByAgent(repoId, agentType);

      // Sort by date - recent commits first
      unprocessedCommits.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());

      for (const commit of unprocessedCommits) {
        if (workItems.length >= remainingSlots) break;

        // Check if work already exists for this commit + agent
        const exists = await this.repos.workQueue.exists(repoId, agentType, commit.id);
        if (exists) continue;

        const isRecent = commit.committedAt > oneWeekAgo;
        const priority = isRecent ? Priority.RECENT_COMMIT : Priority.HISTORICAL_COMMIT;

        workItems.push(createWorkItem({
          id: uuid(),
          repoId,
          agentType,
          priority,
          targetCommitId: commit.id,
        }));
      }
    }

    // Strategy 2: Address open conflicts (high priority)
    if (workItems.length < remainingSlots && openConflicts.length > 0) {
      // TODO: Add conflict resolution work items when we have a conflict resolution agent
    }

    // Strategy 3: Improve low-confidence pages
    if (workItems.length < remainingSlots) {
      const lowConfidencePages = await this.repos.wikiPages.findLowConfidence(repoId, 0.5);
      // TODO: Add quality improvement work items when we have meta agents
    }

    // Strategy 4: Synthesis work (when we have enough raw material)
    if (workItems.length < remainingSlots && wikiPages.length >= 10) {
      // TODO: Add synthesis work items when we have synthesis agents
    }

    return workItems;
  }

  /**
   * Check if there's more work to do for a repository.
   */
  async hasMoreWork(repoId: string): Promise<boolean> {
    // Check for pending work
    const pendingCount = await this.repos.workQueue.countPending(repoId);
    if (pendingCount > 0) return true;

    // Check for unprocessed commits across all analysis agents
    for (const agentType of ANALYSIS_AGENTS) {
      const unprocessedCommits = await this.repos.commits.findUnprocessedByAgent(repoId, agentType);
      if (unprocessedCommits.length > 0) return true;
    }

    // Check for open conflicts
    const openConflicts = await this.repos.conflicts.findOpen(repoId);
    if (openConflicts.length > 0) return true;

    // Check for low-confidence pages
    const lowConfidencePages = await this.repos.wikiPages.findLowConfidence(repoId, 0.5);
    if (lowConfidencePages.length > 0) return true;

    return false;
  }

  /**
   * Get a summary of the current work state.
   */
  async getWorkSummary(repoId: string): Promise<WorkSummary> {
    const [
      totalCommits,
      pendingWork,
      wikiPages,
      openConflicts,
    ] = await Promise.all([
      this.repos.commits.countByRepo(repoId),
      this.repos.workQueue.countPending(repoId),
      this.repos.wikiPages.findByRepo(repoId),
      this.repos.conflicts.findOpen(repoId),
    ]);

    // Get per-agent coverage
    const agentCoverage: Record<string, number> = {};
    for (const agentType of ANALYSIS_AGENTS) {
      const processed = await this.repos.commits.countProcessedByAgent(repoId, agentType);
      agentCoverage[agentType] = totalCommits > 0 ? (processed / totalCommits) * 100 : 0;
    }

    // Overall coverage is based on code-change (primary agent)
    const processedCommits = await this.repos.commits.countProcessedByAgent(repoId, 'code-change');

    const avgConfidence = wikiPages.length > 0
      ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
      : 0;

    return {
      totalCommits,
      processedCommits,
      coveragePercent: totalCommits > 0 ? (processedCommits / totalCommits) * 100 : 0,
      agentCoverage,
      pendingWork,
      wikiPages: wikiPages.length,
      avgConfidence,
      openConflicts: openConflicts.length,
    };
  }
}

export interface WorkSummary {
  totalCommits: number;
  processedCommits: number;
  coveragePercent: number;
  agentCoverage: Record<string, number>;
  pendingWork: number;
  wikiPages: number;
  avgConfidence: number;
  openConflicts: number;
}

/**
 * Create an orchestrator instance.
 */
export function createOrchestrator(repos: Repositories): Orchestrator {
  return new Orchestrator(repos);
}
