import { v4 as uuid } from 'uuid';
import type { Repositories } from '../../repositories/index.js';
import type { WorkItem } from '../../domain/work-item.js';
import { createWorkItem, Priority } from '../../domain/work-item.js';
import type { AgentType, AgentRun } from '../../domain/agent-run.js';
import type { LLMService } from '../../services/llm/llm-service.js';
import { ContextGatherer } from './context-gatherer.js';
import { ORCHESTRATOR_SYSTEM_PROMPT, buildUserPrompt, parseOrchestratorResponse } from './prompts.js';
import { createOrchestratorRun } from '../../domain/orchestrator-run.js';

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
 * Meta agents that process the wiki (not commits).
 * These run after analysis agents have created content.
 */
const META_AGENTS: AgentType[] = [
  'link',          // Cross-reference management
  'structure',     // Wiki organization analysis
  'quality',       // Content quality review
  'consistency',   // Cross-page consistency check
];

/**
 * Orchestrator configuration.
 */
export interface OrchestratorConfig {
  /** Use LLM for decision making (default: true) */
  useLLM?: boolean;
  /** Model to use for orchestration (default: anthropic/claude-haiku-4.5) */
  model?: string;
}

/**
 * Orchestrator - The decision-maker that produces prioritized work lists.
 *
 * Can operate in two modes:
 * - Deterministic: Uses fixed strategies (default, faster, predictable)
 * - LLM-powered: Uses an LLM to make intelligent decisions (smarter, adapts to context)
 *
 * The LLM mode falls back to deterministic if the LLM call fails.
 */
export class Orchestrator {
  private contextGatherer: ContextGatherer;
  private config: OrchestratorConfig;

  constructor(
    private readonly repos: Repositories,
    private readonly llm?: LLMService,
    config?: OrchestratorConfig
  ) {
    this.contextGatherer = new ContextGatherer(repos);
    this.config = {
      useLLM: config?.useLLM ?? true,
      model: config?.model ?? 'anthropic/claude-haiku-4.5',
    };
  }

  /**
   * Run the orchestrator to produce a prioritized work list.
   *
   * @param repoId - The repository to orchestrate
   * @param wikiId - The wiki to update
   * @param maxItems - Maximum number of work items to generate
   * @returns Work items to be processed
   */
  async generateWorkList(repoId: string, wikiId: string, maxItems: number = 10): Promise<WorkItem[]> {
    // Strategy 0: Bootstrap ALWAYS runs first on empty wikis (regardless of LLM mode)
    const bootstrapWork = await this.checkBootstrapNeeded(repoId, wikiId);
    if (bootstrapWork) {
      return [bootstrapWork];
    }

    // Check if we should use LLM
    if (this.config.useLLM && this.llm) {
      try {
        return await this.generateWithLLM(repoId, wikiId, maxItems);
      } catch (error) {
        console.warn('LLM orchestration failed, falling back to deterministic:', error);
        // Fall through to deterministic
      }
    }

    return this.generateDeterministic(repoId, wikiId, maxItems);
  }

  /**
   * Check if bootstrap is needed for an empty wiki.
   * Returns a bootstrap work item if needed, null otherwise.
   */
  private async checkBootstrapNeeded(repoId: string, wikiId: string): Promise<WorkItem | null> {
    const wikiPages = await this.repos.wikiPages.findByWiki(wikiId);

    // Only bootstrap empty wikis
    if (wikiPages.length > 0) {
      return null;
    }

    // Check if bootstrap work already pending
    const bootstrapWorkExists = await this.repos.workQueue.findByRepo(repoId, {
      agentType: 'bootstrap',
      status: 'pending',
    });

    if (bootstrapWorkExists.length > 0) {
      return null; // Already pending, let it run
    }

    // Check if bootstrap has already completed
    const recentRuns = await this.repos.agentRuns.findByRepo(repoId);
    const bootstrapCompleted = recentRuns.some(
      r => r.agentType === 'bootstrap' && r.status === 'completed'
    );

    if (bootstrapCompleted) {
      return null; // Already done
    }

    // Need to bootstrap
    return createWorkItem({
      id: uuid(),
      repoId,
      agentType: 'bootstrap',
      priority: Priority.USER_REQUEST, // Highest priority
    });
  }

  /**
   * Generate work list using LLM reasoning.
   */
  private async generateWithLLM(repoId: string, wikiId: string, maxItems: number): Promise<WorkItem[]> {
    const startTime = Date.now();

    // Gather context
    const context = await this.contextGatherer.gather(repoId, wikiId);
    const contextString = this.contextGatherer.formatForPrompt(context);

    // Build prompt
    const userPrompt = buildUserPrompt(context, contextString, maxItems);

    // Create tracking record
    const runId = uuid();
    const orchestratorRun = createOrchestratorRun({
      id: runId,
      repoId,
      context,
      promptSent: userPrompt,
    });

    // Call LLM
    const completion = await this.llm!.complete({
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2000,
      temperature: 0.3,
    });

    // Get valid commit SHAs for validation (use sha, not internal id)
    const commits = await this.repos.commits.findByRepo(repoId, { limit: 100 });
    const validCommitIds = new Set(commits.map(c => c.sha));

    // Parse response
    const decision = parseOrchestratorResponse(completion.content, validCommitIds);

    // Update tracking record
    orchestratorRun.rawResponse = completion.content;
    orchestratorRun.decision = decision;
    orchestratorRun.model = completion.model;
    orchestratorRun.costUsd = completion.costUsd;
    orchestratorRun.durationMs = Date.now() - startTime;
    orchestratorRun.usedLLM = true;

    // Convert to work items
    const workItems: WorkItem[] = [];
    for (const item of decision.workItems) {
      if (workItems.length >= maxItems) break;

      // Check if work already exists (only for items with commit targets)
      if (item.targetCommitId) {
        const exists = await this.repos.workQueue.exists(
          repoId,
          item.agentType as AgentType,
          item.targetCommitId
        );
        if (exists) continue;
      }

      const workItem = createWorkItem({
        id: uuid(),
        repoId,
        agentType: item.agentType as AgentType,
        priority: this.getPriority(item.agentType),
        ...(item.targetCommitId ? { targetCommitId: item.targetCommitId } : {}),
      });

      workItems.push(workItem);
    }

    // Save tracking record
    orchestratorRun.workItemsCreated = workItems.map(w => w.id);
    await this.repos.orchestratorRuns.save(orchestratorRun);

    console.log(`🤖 LLM Orchestrator: "${decision.reasoning}" (${workItems.length} items, $${completion.costUsd.toFixed(4)})`);

    return workItems;
  }

  /**
   * Get priority for an agent type.
   */
  private getPriority(agentType: string): number {
    if (ANALYSIS_AGENTS.includes(agentType as AgentType)) {
      return Priority.RECENT_COMMIT;
    }
    if (META_AGENTS.includes(agentType as AgentType)) {
      return Priority.META;
    }
    return Priority.SYNTHESIS;
  }

  /**
   * Generate work list using deterministic strategies.
   * This is the fallback when LLM is not available or fails.
   */
  private async generateDeterministic(repoId: string, wikiId: string, maxItems: number): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    // Get current state
    const [
      wikiPages,
      pendingWork,
      openConflicts,
      commits,
    ] = await Promise.all([
      this.repos.wikiPages.findByWiki(wikiId),
      this.repos.workQueue.countPending(repoId),
      this.repos.conflicts.findOpen(wikiId),
      this.repos.commits.findByRepo(repoId, { limit: 100 }),
    ]);

    // If there's already pending work, don't add more
    if (pendingWork >= maxItems) {
      return [];
    }

    const remainingSlots = maxItems - pendingWork;

    // Strategy 0: Bootstrap empty wikis FIRST
    // This must run before any commit processing to establish foundation pages
    if (wikiPages.length === 0) {
      const bootstrapWorkExists = await this.repos.workQueue.findByRepo(repoId, {
        agentType: 'bootstrap',
        status: 'pending',
      });

      if (bootstrapWorkExists.length === 0) {
        // Check if bootstrap has already run (by looking for completed runs)
        const recentRuns = await this.repos.agentRuns.findByRepo(repoId);
        const bootstrapCompleted = recentRuns.some(
          r => r.agentType === 'bootstrap' && r.status === 'completed'
        );

        if (!bootstrapCompleted) {
          workItems.push(createWorkItem({
            id: uuid(),
            repoId,
            agentType: 'bootstrap',
            priority: Priority.USER_REQUEST, // Highest priority
          }));
          // Return immediately - bootstrap must complete before other work
          return workItems;
        }
      } else {
        // Bootstrap is already pending, don't add other work
        return [];
      }
    }

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
          targetCommitId: commit.sha,  // Use SHA, not internal ID - executor looks up by SHA
        }));
      }
    }

    // Strategy 2: Address open conflicts (high priority)
    if (workItems.length < remainingSlots && openConflicts.length > 0) {
      // TODO: Add conflict resolution work items when we have a conflict resolution agent
    }

    // Strategy 3: Improve low-confidence pages
    if (workItems.length < remainingSlots) {
      const lowConfidencePages = await this.repos.wikiPages.findLowConfidence(wikiId, 0.5);
      // TODO: Add quality improvement work items when we have meta agents
    }

    // Strategy 4: Meta agents (run on wiki after analysis is complete)
    // Only run meta agents when all commits have been analyzed by code-change
    if (workItems.length < remainingSlots && wikiPages.length >= 2) {
      const unprocessedByCodeChange = await this.repos.commits.findUnprocessedByAgent(repoId, 'code-change');

      // Only run meta agents when analysis is mostly complete
      if (unprocessedByCodeChange.length === 0) {
        // Fetch recent agent runs for checking if meta agents ran recently
        const recentRuns = await this.repos.agentRuns.findByRepo(repoId);

        // Check for pages without links (need link agent)
        const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);

        if (pagesWithoutLinks.length > 0) {
          // Check if link agent work already exists
          const linkWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'link',
            status: 'pending',
          });

          if (linkWorkExists.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'link',
              priority: Priority.META,
            }));
          }
        }

        // Run structure agent periodically (when wiki has at least 5 pages)
        if (workItems.length < remainingSlots && wikiPages.length >= 5) {
          const recentStructureRuns = recentRuns
            .filter(r => r.agentType === 'structure' && r.status === 'completed')
            .slice(0, 1);

          const structureWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'structure',
            status: 'pending',
          });

          if (structureWorkExists.length === 0 && recentStructureRuns.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'structure',
              priority: Priority.META,
            }));
          }
        }

        // Run quality agent for low-confidence pages
        if (workItems.length < remainingSlots && wikiPages.length >= 3) {
          const lowConfidencePages = wikiPages.filter(p => p.confidence < 0.7);

          if (lowConfidencePages.length > 0) {
            const qualityWorkExists = await this.repos.workQueue.findByRepo(repoId, {
              agentType: 'quality',
              status: 'pending',
            });

            // Check if quality agent ran recently
            const recentQualityRuns = recentRuns
              .filter(r => r.agentType === 'quality' && r.status === 'completed')
              .slice(0, 1);

            if (qualityWorkExists.length === 0 && recentQualityRuns.length === 0) {
              workItems.push(createWorkItem({
                id: uuid(),
                repoId,
                agentType: 'quality',
                priority: Priority.META,
              }));
            }
          }
        }

        // Run consistency agent when wiki has enough pages (5+)
        if (workItems.length < remainingSlots && wikiPages.length >= 5) {
          const consistencyWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'consistency',
            status: 'pending',
          });

          // Check if consistency agent ran recently
          const recentConsistencyRuns = recentRuns
            .filter(r => r.agentType === 'consistency' && r.status === 'completed')
            .slice(0, 1);

          if (consistencyWorkExists.length === 0 && recentConsistencyRuns.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'consistency',
              priority: Priority.META,
            }));
          }
        }
      }
    }

    // Strategy 5: Synthesis work (when we have enough raw material)
    if (workItems.length < remainingSlots && wikiPages.length >= 5) {
      // Fetch recent agent runs for synthesis checks
      const synthRuns = await this.repos.agentRuns.findByRepo(repoId);

      // Group pages by category
      const categories = new Map<string, typeof wikiPages>();
      for (const page of wikiPages) {
        const category = page.path.split('/')[0] ?? 'uncategorized';
        if (!categories.has(category)) {
          categories.set(category, []);
        }
        categories.get(category)!.push(page);
      }

      // Overview Agent: trigger for categories with 3+ pages but no overview
      const skipCategories = ['commits']; // Too granular for overviews
      for (const [category, pages] of categories) {
        if (workItems.length >= remainingSlots) break;
        if (skipCategories.includes(category)) continue;
        if (pages.length < 3) continue;

        // Check if overview exists
        const hasOverview = pages.some(p =>
          p.path === `${category}/overview` || p.path === `${category}/index`
        );

        if (!hasOverview) {
          // Check if overview work already pending
          const overviewWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'overview',
            status: 'pending',
          });

          // Check if overview agent ran recently
          const recentOverviewRuns = synthRuns
            .filter((r: AgentRun) => r.agentType === 'overview' && r.status === 'completed')
            .slice(0, 1);

          if (overviewWorkExists.length === 0 && recentOverviewRuns.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'overview',
              priority: Priority.SYNTHESIS,
            }));
            break; // Only add one overview at a time
          }
        }
      }

      // Project Overview Agent: trigger when 10+ pages but no architecture/overview
      if (workItems.length < remainingSlots && wikiPages.length >= 10) {
        const hasProjectOverview = wikiPages.some(p =>
          p.path === 'architecture/overview' || p.path === 'architecture/index'
        );

        if (!hasProjectOverview) {
          const projectOverviewWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'project-overview',
            status: 'pending',
          });

          const recentProjectOverviewRuns = synthRuns
            .filter((r: AgentRun) => r.agentType === 'project-overview' && r.status === 'completed')
            .slice(0, 1);

          if (projectOverviewWorkExists.length === 0 && recentProjectOverviewRuns.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'project-overview',
              priority: Priority.SYNTHESIS,
            }));
          }
        }
      }

      // Getting Started Agent: trigger when 10+ pages but no guides/getting-started
      if (workItems.length < remainingSlots && wikiPages.length >= 10) {
        const hasGettingStarted = wikiPages.some(p =>
          p.path === 'guides/getting-started' || p.path === 'guides/quickstart' || p.path === 'guides/index'
        );

        if (!hasGettingStarted) {
          const gettingStartedWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'getting-started',
            status: 'pending',
          });

          const recentGettingStartedRuns = synthRuns
            .filter((r: AgentRun) => r.agentType === 'getting-started' && r.status === 'completed')
            .slice(0, 1);

          if (gettingStartedWorkExists.length === 0 && recentGettingStartedRuns.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'getting-started',
              priority: Priority.SYNTHESIS,
            }));
          }
        }
      }

      // Writer Agent: trigger for pages with commit-style content that needs rewriting
      if (workItems.length < remainingSlots) {
        // Check for pages that need rewriting (have "This commit..." style)
        const pagesNeedingRewrite = wikiPages.filter(page => {
          const category = page.path.split('/')[0] ?? '';
          // Skip commits and security - those are inherently commit-focused
          if (['commits', 'security'].includes(category)) return false;
          // Skip overview pages
          if (page.path.endsWith('/overview') || page.path.endsWith('/index')) return false;

          // Check for commit-style indicators
          const firstPara = page.content.split('\n\n')[1] ?? '';
          const commitIndicators = [
            'this commit ', 'this change ', 'this patch ',
            'this adds ', 'this modifies ', 'this introduces ',
            'commit adds', 'commit modifies',
          ];
          return commitIndicators.some(ind => firstPara.toLowerCase().includes(ind));
        });

        if (pagesNeedingRewrite.length > 0) {
          const writerWorkExists = await this.repos.workQueue.findByRepo(repoId, {
            agentType: 'writer',
            status: 'pending',
          });

          if (writerWorkExists.length === 0) {
            workItems.push(createWorkItem({
              id: uuid(),
              repoId,
              agentType: 'writer',
              priority: Priority.SYNTHESIS,
            }));
          }
        }
      }
    }

    return workItems;
  }

  /**
   * Check if there's more work to do for a repository/wiki.
   */
  async hasMoreWork(repoId: string, wikiId: string): Promise<boolean> {
    // Check for pending work
    const pendingCount = await this.repos.workQueue.countPending(repoId);
    if (pendingCount > 0) return true;

    // Check for unprocessed commits across all analysis agents
    for (const agentType of ANALYSIS_AGENTS) {
      const unprocessedCommits = await this.repos.commits.findUnprocessedByAgent(repoId, agentType);
      if (unprocessedCommits.length > 0) return true;
    }

    // Check for open conflicts
    const openConflicts = await this.repos.conflicts.findOpen(wikiId);
    if (openConflicts.length > 0) return true;

    // Check for low-confidence pages
    const lowConfidencePages = await this.repos.wikiPages.findLowConfidence(wikiId, 0.5);
    if (lowConfidencePages.length > 0) return true;

    return false;
  }

  /**
   * Get a summary of the current work state.
   */
  async getWorkSummary(repoId: string, wikiId: string): Promise<WorkSummary> {
    const [
      totalCommits,
      pendingWork,
      wikiPages,
      openConflicts,
    ] = await Promise.all([
      this.repos.commits.countByRepo(repoId),
      this.repos.workQueue.countPending(repoId),
      this.repos.wikiPages.findByWiki(wikiId),
      this.repos.conflicts.findOpen(wikiId),
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

  /**
   * Enable or disable LLM mode.
   */
  setUseLLM(useLLM: boolean): void {
    this.config.useLLM = useLLM;
  }

  /**
   * Check if LLM mode is enabled.
   */
  isUsingLLM(): boolean {
    return this.config.useLLM ?? false;
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
export function createOrchestrator(
  repos: Repositories,
  llm?: LLMService,
  config?: OrchestratorConfig
): Orchestrator {
  return new Orchestrator(repos, llm, config);
}
