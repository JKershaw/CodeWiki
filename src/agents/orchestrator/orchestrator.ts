import { v4 as uuid } from "uuid";
import type { Repositories } from "../../repositories/index.js";
import type { WorkItem } from "../../domain/work-item.js";
import { createWorkItem, Priority } from "../../domain/work-item.js";
import type { AgentType, AgentRun } from "../../domain/agent-run.js";
import type { LLMService } from "../../services/llm/llm-service.js";
import type { GitService } from "../../services/git/git-service.js";
import { ContextGatherer } from "./context-gatherer.js";
import {
	ORCHESTRATOR_SYSTEM_PROMPT,
	buildUserPrompt,
	parseOrchestratorResponse,
} from "./prompts.js";
import { createOrchestratorRun } from "../../domain/orchestrator-run.js";

// Import CQRS queries
import {
	createListWikiPagesQuery,
	handleListWikiPages,
	createListWorkItemsQuery,
	handleListWorkItems,
	createGetPendingWorkKeysQuery,
	handleGetPendingWorkKeys,
	createCountPendingWorkQuery,
	handleCountPendingWork,
	createListAgentRunsQuery,
	handleListAgentRuns,
	createListCommitsQuery,
	handleListCommits,
	createListUnprocessedCommitsQuery,
	handleListUnprocessedCommits,
	createCountCommitsByRepoQuery,
	handleCountCommitsByRepo,
	createCountProcessedByAgentQuery,
	handleCountProcessedByAgent,
	createListOpenConflictsQuery,
	handleListOpenConflicts,
	createListOpenFindingsQuery,
	handleListOpenFindings,
	createListLowConfidencePagesQuery,
	handleListLowConfidencePages,
} from "../../queries/index.js";

/**
 * Analysis agents that process commits.
 * Order matters - code-change runs first to establish base wiki content,
 * then specialized agents add their perspectives.
 */
const ANALYSIS_AGENTS: AgentType[] = [
	"code-change", // General code analysis - runs first
	"narrative", // Detects ADRs, planning docs, READMEs
	"security", // Security audit
	"technical-debt", // Technical debt indicators, TODOs, code smells
	"pattern", // Design patterns and conventions
	"dependency", // Dependency changes
];

/**
 * Meta agents that process the wiki (not commits).
 * These run after analysis agents have created content.
 */
const META_AGENTS: AgentType[] = [
	"link", // Cross-reference management
	"structure", // Wiki organization analysis
	"quality", // Content quality review
	"consistency", // Cross-page consistency check
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
		config?: OrchestratorConfig,
		private readonly git?: GitService
	) {
		this.contextGatherer = new ContextGatherer(repos, git);
		this.config = {
			useLLM: config?.useLLM ?? true,
			model: config?.model ?? "anthropic/claude-haiku-4.5",
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
	async generateWorkList(
		repoId: string,
		wikiId: string,
		maxItems: number = 10
	): Promise<WorkItem[]> {
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
				console.warn(
					"LLM orchestration failed, falling back to deterministic:",
					error
				);
				// Fall through to deterministic
			}
		}

		return this.generateDeterministic(repoId, wikiId, maxItems);
	}

	/**
	 * Check if bootstrap is needed for an empty wiki.
	 * Returns a bootstrap work item if needed, null otherwise.
	 */
	private async checkBootstrapNeeded(
		repoId: string,
		wikiId: string
	): Promise<WorkItem | null> {
		// Use CQRS query to list wiki pages
		const pagesQuery = createListWikiPagesQuery(wikiId);
		const pagesResult = await handleListWikiPages(pagesQuery, this.repos);
		const wikiPages = pagesResult.data || [];

		// Only bootstrap empty wikis
		if (wikiPages.length > 0) {
			return null;
		}

		// Check if bootstrap work already pending via CQRS query
		const workQuery = createListWorkItemsQuery(repoId, {
			agentType: "bootstrap",
			status: "pending",
		});
		const workResult = await handleListWorkItems(workQuery, this.repos);
		const bootstrapWorkExists = workResult.data || [];

		if (bootstrapWorkExists.length > 0) {
			return null; // Already pending, let it run
		}

		// Check if bootstrap has already completed via CQRS query
		const runsQuery = createListAgentRunsQuery(repoId);
		const runsResult = await handleListAgentRuns(runsQuery, this.repos);
		const recentRuns = runsResult.data || [];
		const bootstrapCompleted = recentRuns.some(
			(r) => r.agentType === "bootstrap" && r.status === "completed"
		);

		if (bootstrapCompleted) {
			return null; // Already done
		}

		// Need to bootstrap
		return createWorkItem({
			id: uuid(),
			repoId,
			agentType: "bootstrap",
			priority: Priority.USER_REQUEST, // Highest priority
		});
	}

	/**
	 * Generate work list using LLM reasoning.
	 */
	private async generateWithLLM(
		repoId: string,
		wikiId: string,
		maxItems: number
	): Promise<WorkItem[]> {
		const startTime = Date.now();

		// Fetch existing work keys upfront for O(1) deduplication via CQRS query
		const keysQuery = createGetPendingWorkKeysQuery(repoId);
		const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
		const existingWorkKeys = keysResult.data || new Set<string>();

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
			messages: [{ role: "user", content: userPrompt }],
			maxTokens: 4000, // Increased from 2000 - large work lists were being truncated
			temperature: 0.3,
		});

		// Get valid commit SHAs for validation (use sha, not internal id) via CQRS query
		const commitsQuery = createListCommitsQuery(repoId, { limit: 100 });
		const commitsResult = await handleListCommits(commitsQuery, this.repos);
		const commits = commitsResult.data || [];
		const validCommitIds = new Set(commits.map((c) => c.sha));

		// Parse response
		const decision = parseOrchestratorResponse(
			completion.content,
			validCommitIds
		);

		// Update tracking record
		orchestratorRun.rawResponse = completion.content;
		orchestratorRun.decision = decision;
		orchestratorRun.model = completion.model;
		orchestratorRun.costUsd = completion.costUsd;
		orchestratorRun.durationMs = Date.now() - startTime;
		orchestratorRun.usedLLM = true;

		// Convert to work items (using Set lookup for deduplication)
		const workItems: WorkItem[] = [];
		for (const item of decision.workItems) {
			if (workItems.length >= maxItems) break;

			// Check if work already exists using O(1) Set lookup
			// For exploration agents, use targetPath instead of targetCommitId
			const key = item.targetPath
				? `${item.agentType}:path:${item.targetPath}`
				: `${item.agentType}:${item.targetCommitId ?? "null"}`;
			if (existingWorkKeys.has(key)) continue;

			// Also track items we're adding in this batch to avoid self-duplicates
			existingWorkKeys.add(key);

			const workItem = createWorkItem({
				id: uuid(),
				repoId,
				agentType: item.agentType as AgentType,
				priority: this.getPriority(item.agentType),
				...(item.targetCommitId ? { targetCommitId: item.targetCommitId } : {}),
				...(item.targetPath ? { targetPath: item.targetPath } : {}),
			});

			workItems.push(workItem);
		}

		// Save tracking record
		orchestratorRun.workItemsCreated = workItems.map((w) => w.id);
		await this.repos.orchestratorRuns.save(orchestratorRun);

		console.log(
			`🤖 LLM Orchestrator: "${decision.reasoning}" (${
				workItems.length
			} items, $${completion.costUsd.toFixed(4)})`
		);

		return workItems;
	}

	/**
	 * Get priority for an agent type.
	 */
	private getPriority(agentType: string): number {
		if (ANALYSIS_AGENTS.includes(agentType as AgentType)) {
			return Priority.RECENT_COMMIT;
		}
		if (agentType === "codebase-explorer") {
			return Priority.EXPLORATION; // Higher than synthesis, documents undocumented code
		}
		if (META_AGENTS.includes(agentType as AgentType)) {
			return Priority.META;
		}
		if (agentType === "consolidation") {
			return Priority.LOW_CONFIDENCE; // High priority - addresses detected issues
		}
		return Priority.SYNTHESIS;
	}

	/**
	 * Generate work list using deterministic strategies.
	 * This is the fallback when LLM is not available or fails.
	 */
	private async generateDeterministic(
		repoId: string,
		wikiId: string,
		maxItems: number
	): Promise<WorkItem[]> {
		const workItems: WorkItem[] = [];

		// Fetch existing work keys upfront for O(1) deduplication via CQRS query
		const keysQuery = createGetPendingWorkKeysQuery(repoId);
		const keysResult = await handleGetPendingWorkKeys(keysQuery, this.repos);
		const existingWorkKeys = keysResult.data || new Set<string>();

		// Get current state via CQRS queries
		const pagesQuery = createListWikiPagesQuery(wikiId);
		const pendingQuery = createCountPendingWorkQuery(repoId);
		const conflictsQuery = createListOpenConflictsQuery(wikiId);
		const commitsQuery = createListCommitsQuery(repoId, { limit: 100 });

		const [pagesResult, pendingResult, conflictsResult, commitsResult] = await Promise.all([
			handleListWikiPages(pagesQuery, this.repos),
			handleCountPendingWork(pendingQuery, this.repos),
			handleListOpenConflicts(conflictsQuery, this.repos),
			handleListCommits(commitsQuery, this.repos),
		]);

		const wikiPages = pagesResult.data || [];
		const pendingWork = pendingResult.data || 0;
		const openConflicts = conflictsResult.data || [];
		const commits = commitsResult.data || [];

		// If there's already pending work, don't add more
		if (pendingWork >= maxItems) {
			return [];
		}

		const remainingSlots = maxItems - pendingWork;

		// Strategy 0: Bootstrap empty wikis FIRST
		// This must run before any commit processing to establish foundation pages
		if (wikiPages.length === 0) {
			// Check if bootstrap work already pending via CQRS query
			const bootstrapWorkQuery = createListWorkItemsQuery(repoId, {
				agentType: "bootstrap",
				status: "pending",
			});
			const bootstrapWorkResult = await handleListWorkItems(bootstrapWorkQuery, this.repos);
			const bootstrapWorkExists = bootstrapWorkResult.data || [];

			if (bootstrapWorkExists.length === 0) {
				// Check if bootstrap has already run (by looking for completed runs) via CQRS query
				const runsQuery = createListAgentRunsQuery(repoId);
				const runsResult = await handleListAgentRuns(runsQuery, this.repos);
				const recentRuns = runsResult.data || [];
				const bootstrapCompleted = recentRuns.some(
					(r) => r.agentType === "bootstrap" && r.status === "completed"
				);

				if (!bootstrapCompleted) {
					workItems.push(
						createWorkItem({
							id: uuid(),
							repoId,
							agentType: "bootstrap",
							priority: Priority.USER_REQUEST, // Highest priority
						})
					);
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

			// Use CQRS query to find unprocessed commits
			const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, agentType);
			const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
			const unprocessedCommits = unprocessedResult.data || [];

			// Sort by date - recent commits first
			unprocessedCommits.sort(
				(a, b) => b.committedAt.getTime() - a.committedAt.getTime()
			);

			for (const commit of unprocessedCommits) {
				if (workItems.length >= remainingSlots) break;

				// Check if work already exists using O(1) Set lookup
				const key = `${agentType}:${commit.sha}`;
				if (existingWorkKeys.has(key)) continue;

				// Track items we're adding to avoid self-duplicates
				existingWorkKeys.add(key);

				const isRecent = commit.committedAt > oneWeekAgo;
				const priority = isRecent
					? Priority.RECENT_COMMIT
					: Priority.HISTORICAL_COMMIT;

				workItems.push(
					createWorkItem({
						id: uuid(),
						repoId,
						agentType,
						priority,
						targetCommitId: commit.sha, // Use SHA, not internal ID - executor looks up by SHA
					})
				);
			}
		}

		// Strategy 2: Address open conflicts (high priority)
		if (workItems.length < remainingSlots && openConflicts.length > 0) {
			// TODO: Add conflict resolution work items when we have a conflict resolution agent
		}

		// Strategy 3: Improve low-confidence pages
		if (workItems.length < remainingSlots) {
			// Use CQRS query to find low confidence pages
			const lowConfQuery = createListLowConfidencePagesQuery(wikiId, 0.5);
			const lowConfResult = await handleListLowConfidencePages(lowConfQuery, this.repos);
			const lowConfidencePages = lowConfResult.data || [];
			// TODO: Add quality improvement work items when we have meta agents
		}

		// Strategy 4: Meta agents (run on wiki after analysis is complete)
		// Only run meta agents when all commits have been analyzed by code-change
		if (workItems.length < remainingSlots && wikiPages.length >= 2) {
			// Use CQRS query to find unprocessed commits
			const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, "code-change");
			const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
			const unprocessedByCodeChange = unprocessedResult.data || [];

			// Only run meta agents when analysis is mostly complete
			if (unprocessedByCodeChange.length === 0) {
				// Fetch recent agent runs for checking if meta agents ran recently via CQRS query
				const runsQuery = createListAgentRunsQuery(repoId);
				const runsResult = await handleListAgentRuns(runsQuery, this.repos);
				const recentRuns = runsResult.data || [];

				// Check for pages without links (need link agent)
				const pagesWithoutLinks = wikiPages.filter((p) => p.links.length === 0);

				if (pagesWithoutLinks.length > 0) {
					// Check if link agent work already exists using O(1) Set lookup
					const linkKey = "link:null";
					if (!existingWorkKeys.has(linkKey)) {
						existingWorkKeys.add(linkKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "link",
								priority: Priority.META,
							})
						);
					}
				}

				// Run structure agent periodically (when wiki has at least 5 pages)
				if (workItems.length < remainingSlots && wikiPages.length >= 5) {
					const recentStructureRuns = recentRuns
						.filter(
							(r) => r.agentType === "structure" && r.status === "completed"
						)
						.slice(0, 1);

					const structureKey = "structure:null";
					if (
						!existingWorkKeys.has(structureKey) &&
						recentStructureRuns.length === 0
					) {
						existingWorkKeys.add(structureKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "structure",
								priority: Priority.META,
							})
						);
					}
				}

				// Run quality agent for low-confidence pages
				if (workItems.length < remainingSlots && wikiPages.length >= 3) {
					const lowConfidencePages = wikiPages.filter(
						(p) => p.confidence < 0.7
					);

					if (lowConfidencePages.length > 0) {
						// Check if quality agent ran recently
						const recentQualityRuns = recentRuns
							.filter(
								(r) => r.agentType === "quality" && r.status === "completed"
							)
							.slice(0, 1);

						const qualityKey = "quality:null";
						if (
							!existingWorkKeys.has(qualityKey) &&
							recentQualityRuns.length === 0
						) {
							existingWorkKeys.add(qualityKey);
							workItems.push(
								createWorkItem({
									id: uuid(),
									repoId,
									agentType: "quality",
									priority: Priority.META,
								})
							);
						}
					}
				}

				// Run consistency agent when wiki has enough pages (5+)
				if (workItems.length < remainingSlots && wikiPages.length >= 5) {
					// Check if consistency agent ran recently
					const recentConsistencyRuns = recentRuns
						.filter(
							(r) => r.agentType === "consistency" && r.status === "completed"
						)
						.slice(0, 1);

					const consistencyKey = "consistency:null";
					if (
						!existingWorkKeys.has(consistencyKey) &&
						recentConsistencyRuns.length === 0
					) {
						existingWorkKeys.add(consistencyKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "consistency",
								priority: Priority.META,
							})
						);
					}
				}

				// Strategy 4b: Consolidation agent - address findings from meta agents
				// Runs when there are open findings that need consolidation
				if (workItems.length < remainingSlots) {
					// Use CQRS query to find open findings
					const findingsQuery = createListOpenFindingsQuery(wikiId);
					const findingsResult = await handleListOpenFindings(findingsQuery, this.repos);
					const openFindings = findingsResult.data || [];

					if (openFindings.length > 0) {
						// Check if consolidation agent ran recently
						const recentConsolidationRuns = recentRuns
							.filter(
								(r) =>
									r.agentType === "consolidation" && r.status === "completed"
							)
							.slice(0, 1);

						const consolidationKey = "consolidation:null";
						// Only add consolidation work if there's none pending and it hasn't run recently
						if (
							!existingWorkKeys.has(consolidationKey) &&
							recentConsolidationRuns.length === 0
						) {
							existingWorkKeys.add(consolidationKey);
							workItems.push(
								createWorkItem({
									id: uuid(),
									repoId,
									agentType: "consolidation",
									priority: Priority.LOW_CONFIDENCE,
								})
							);
						}
					}
				}
			}
		}

		// Strategy 5: Synthesis work (when we have enough raw material)
		if (workItems.length < remainingSlots && wikiPages.length >= 5) {
			// Fetch recent agent runs for synthesis checks via CQRS query
			const synthRunsQuery = createListAgentRunsQuery(repoId);
			const synthRunsResult = await handleListAgentRuns(synthRunsQuery, this.repos);
			const synthRuns = synthRunsResult.data || [];

			// Group pages by category
			const categories = new Map<string, typeof wikiPages>();
			for (const page of wikiPages) {
				const category = page.path.split("/")[0] ?? "uncategorized";
				if (!categories.has(category)) {
					categories.set(category, []);
				}
				categories.get(category)!.push(page);
			}

			// Overview Agent: trigger for categories with 3+ pages but no overview
			const skipCategories = ["commits"]; // Too granular for overviews
			for (const [category, pages] of categories) {
				if (workItems.length >= remainingSlots) break;
				if (skipCategories.includes(category)) continue;
				if (pages.length < 3) continue;

				// Check if overview exists
				const hasOverview = pages.some(
					(p) =>
						p.path === `${category}/overview` || p.path === `${category}/index`
				);

				if (!hasOverview) {
					// Check if overview agent ran recently
					const recentOverviewRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "overview" && r.status === "completed"
						)
						.slice(0, 1);

					const overviewKey = "overview:null";
					if (
						!existingWorkKeys.has(overviewKey) &&
						recentOverviewRuns.length === 0
					) {
						existingWorkKeys.add(overviewKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "overview",
								priority: Priority.SYNTHESIS,
							})
						);
						break; // Only add one overview at a time
					}
				}
			}

			// Project Overview Agent: trigger when 10+ pages but no architecture/overview
			if (workItems.length < remainingSlots && wikiPages.length >= 10) {
				const hasProjectOverview = wikiPages.some(
					(p) =>
						p.path === "architecture/overview" ||
						p.path === "architecture/index"
				);

				if (!hasProjectOverview) {
					const recentProjectOverviewRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "project-overview" && r.status === "completed"
						)
						.slice(0, 1);

					const projectOverviewKey = "project-overview:null";
					if (
						!existingWorkKeys.has(projectOverviewKey) &&
						recentProjectOverviewRuns.length === 0
					) {
						existingWorkKeys.add(projectOverviewKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "project-overview",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// Getting Started Agent: trigger when 10+ pages but no guides/getting-started
			if (workItems.length < remainingSlots && wikiPages.length >= 10) {
				const hasGettingStarted = wikiPages.some(
					(p) =>
						p.path === "guides/getting-started" ||
						p.path === "guides/quickstart" ||
						p.path === "guides/index"
				);

				if (!hasGettingStarted) {
					const recentGettingStartedRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "getting-started" && r.status === "completed"
						)
						.slice(0, 1);

					const gettingStartedKey = "getting-started:null";
					if (
						!existingWorkKeys.has(gettingStartedKey) &&
						recentGettingStartedRuns.length === 0
					) {
						existingWorkKeys.add(gettingStartedKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "getting-started",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// Testing Guide Agent: trigger when 15+ pages but no guides/testing
			if (workItems.length < remainingSlots && wikiPages.length >= 15) {
				const hasTestingGuide = wikiPages.some(
					(p) =>
						p.path === "guides/testing" ||
						p.path === "guides/tests" ||
						p.path === "guides/testing-guide"
				);

				if (!hasTestingGuide) {
					const recentTestingGuideRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "testing-guide" && r.status === "completed"
						)
						.slice(0, 1);

					const testingGuideKey = "testing-guide:null";
					if (
						!existingWorkKeys.has(testingGuideKey) &&
						recentTestingGuideRuns.length === 0
					) {
						existingWorkKeys.add(testingGuideKey);
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "testing-guide",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// Extension Guide Agent: trigger when 15+ pages but no guides/extension-patterns
			if (workItems.length < remainingSlots && wikiPages.length >= 15) {
				const hasExtensionGuide = wikiPages.some(
					(p) =>
						p.path === "guides/extension-patterns" ||
						p.path === "guides/extending" ||
						p.path === "guides/adding-features" ||
						p.path === "guides/patterns"
				);

				if (!hasExtensionGuide) {
					const recentExtensionGuideRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "extension-guide" && r.status === "completed"
						)
						.slice(0, 1);

					if (
						!existingWorkKeys.has("extension-guide:null") &&
						recentExtensionGuideRuns.length === 0
					) {
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "extension-guide",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// Writer Agent: trigger for pages with commit-style content that needs rewriting
			if (workItems.length < remainingSlots) {
				// Check for pages that need rewriting (have "This commit..." style)
				const pagesNeedingRewrite = wikiPages.filter((page) => {
					const category = page.path.split("/")[0] ?? "";
					// Skip commits and security - those are inherently commit-focused
					if (["commits", "security"].includes(category)) return false;
					// Skip overview pages
					if (page.path.endsWith("/overview") || page.path.endsWith("/index"))
						return false;

					// Check for commit-style indicators
					const firstPara = page.content.split("\n\n")[1] ?? "";
					const commitIndicators = [
						"this commit ",
						"this change ",
						"this patch ",
						"this adds ",
						"this modifies ",
						"this introduces ",
						"commit adds",
						"commit modifies",
					];
					return commitIndicators.some((ind) =>
						firstPara.toLowerCase().includes(ind)
					);
				});

				if (pagesNeedingRewrite.length > 0) {
					if (!existingWorkKeys.has("writer:null")) {
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "writer",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// Wiki Index Agent: trigger when 10+ pages but no navigation/wiki-index
			if (workItems.length < remainingSlots && wikiPages.length >= 10) {
				const hasWikiIndex = wikiPages.some(
					(p) =>
						p.path === "navigation/wiki-index" ||
						p.path === "navigation/index" ||
						p.path === "guides/wiki-index"
				);

				if (!hasWikiIndex) {
					// Use CQRS query to check for existing wiki-index work
					const wikiIndexWorkQuery = createListWorkItemsQuery(repoId, {
						agentType: "wiki-index",
						status: "pending",
					});
					const wikiIndexWorkResult = await handleListWorkItems(wikiIndexWorkQuery, this.repos);
					const wikiIndexWorkExists = wikiIndexWorkResult.data || [];

					const recentWikiIndexRuns = synthRuns
						.filter(
							(r: AgentRun) =>
								r.agentType === "wiki-index" && r.status === "completed"
						)
						.slice(0, 1);

					if (
						wikiIndexWorkExists.length === 0 &&
						recentWikiIndexRuns.length === 0
					) {
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "wiki-index",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}

			// TOC Agent: trigger when 5+ pages to add table of contents to long pages
			if (workItems.length < remainingSlots && wikiPages.length >= 5) {
				// Check if there are pages that might need TOC (with multiple headings)
				const pagesNeedingToc = wikiPages.filter((page) => {
					// Skip navigation pages
					if (page.path.includes("navigation/") || page.path.endsWith("/index"))
						return false;
					// Skip low confidence pages
					if (page.confidence < 0.5) return false;
					// Check if page already has TOC
					const lowerContent = page.content.toLowerCase();
					if (
						lowerContent.includes("## table of contents") ||
						lowerContent.includes("## contents") ||
						lowerContent.includes("## toc")
					)
						return false;
					// Count headings (h2 and below)
					const headingCount = (page.content.match(/^#{2,6}\s+/gm) || []).length;
					return headingCount >= 3;
				});

				if (pagesNeedingToc.length > 0) {
					// Use CQRS query to check for existing toc work
					const tocWorkQuery = createListWorkItemsQuery(repoId, {
						agentType: "toc",
						status: "pending",
					});
					const tocWorkResult = await handleListWorkItems(tocWorkQuery, this.repos);
					const tocWorkExists = tocWorkResult.data || [];

					const recentTocRuns = synthRuns
						.filter(
							(r: AgentRun) => r.agentType === "toc" && r.status === "completed"
						)
						.slice(0, 1);

					if (tocWorkExists.length === 0 && recentTocRuns.length === 0) {
						workItems.push(
							createWorkItem({
								id: uuid(),
								repoId,
								agentType: "toc",
								priority: Priority.SYNTHESIS,
							})
						);
					}
				}
			}
		}

		// Strategy 6: Codebase exploration (document undocumented code)
		// Run codebase-explorer when we have directory coverage data showing low coverage
		if (workItems.length < remainingSlots && this.git) {
			// Calculate directory coverage
			const context = await this.contextGatherer.gather(repoId, wikiId);
			const lowCoverageDirs = context.directoryCoverage
				.filter(d => d.coveragePercent < 20)
				.slice(0, 3); // Limit to top 3 most undocumented

			for (const dir of lowCoverageDirs) {
				if (workItems.length >= remainingSlots) break;

				// Check if codebase-explorer work for this path already exists
				const key = `codebase-explorer:path:${dir.path}`;
				if (existingWorkKeys.has(key)) continue;

				existingWorkKeys.add(key);
				workItems.push(
					createWorkItem({
						id: uuid(),
						repoId,
						agentType: "codebase-explorer",
						priority: Priority.EXPLORATION,
						targetPath: dir.path,
					})
				);
			}
		}

		return workItems;
	}

	/**
	 * Check if there's more work to do for a repository/wiki.
	 */
	async hasMoreWork(repoId: string, wikiId: string): Promise<boolean> {
		// Check for pending work via CQRS query
		const pendingQuery = createCountPendingWorkQuery(repoId);
		const pendingResult = await handleCountPendingWork(pendingQuery, this.repos);
		const pendingCount = pendingResult.data || 0;
		if (pendingCount > 0) return true;

		// Check for unprocessed commits across all analysis agents
		for (const agentType of ANALYSIS_AGENTS) {
			// Use CQRS query to find unprocessed commits
			const unprocessedQuery = createListUnprocessedCommitsQuery(repoId, agentType);
			const unprocessedResult = await handleListUnprocessedCommits(unprocessedQuery, this.repos);
			const unprocessedCommits = unprocessedResult.data || [];
			if (unprocessedCommits.length > 0) return true;
		}

		// Check for open conflicts via CQRS query
		const conflictsQuery = createListOpenConflictsQuery(wikiId);
		const conflictsResult = await handleListOpenConflicts(conflictsQuery, this.repos);
		const openConflicts = conflictsResult.data || [];
		if (openConflicts.length > 0) return true;

		// Check for low-confidence pages via CQRS query
		const lowConfQuery = createListLowConfidencePagesQuery(wikiId, 0.5);
		const lowConfResult = await handleListLowConfidencePages(lowConfQuery, this.repos);
		const lowConfidencePages = lowConfResult.data || [];
		if (lowConfidencePages.length > 0) return true;

		// Check for open findings that need consolidation via CQRS query
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
		// Use CQRS queries to get all data
		const totalCommitsQuery = createCountCommitsByRepoQuery(repoId);
		const pendingWorkQuery = createCountPendingWorkQuery(repoId);
		const wikiPagesQuery = createListWikiPagesQuery(wikiId);
		const openConflictsQuery = createListOpenConflictsQuery(wikiId);
		const openFindingsQuery = createListOpenFindingsQuery(wikiId);

		const [
			totalCommitsResult,
			pendingWorkResult,
			wikiPagesResult,
			openConflictsResult,
			openFindingsResult,
		] = await Promise.all([
			handleCountCommitsByRepo(totalCommitsQuery, this.repos),
			handleCountPendingWork(pendingWorkQuery, this.repos),
			handleListWikiPages(wikiPagesQuery, this.repos),
			handleListOpenConflicts(openConflictsQuery, this.repos),
			handleListOpenFindings(openFindingsQuery, this.repos),
		]);

		const totalCommits = totalCommitsResult.data || 0;
		const pendingWork = pendingWorkResult.data || 0;
		const wikiPages = wikiPagesResult.data || [];
		const openConflicts = openConflictsResult.data || [];
		const openFindings = openFindingsResult.data || [];

		// Get per-agent coverage via CQRS queries
		const agentCoverage: Record<string, number> = {};
		for (const agentType of ANALYSIS_AGENTS) {
			const processedQuery = createCountProcessedByAgentQuery(repoId, agentType);
			const processedResult = await handleCountProcessedByAgent(processedQuery, this.repos);
			const processed = processedResult.data || 0;
			agentCoverage[agentType] =
				totalCommits > 0 ? (processed / totalCommits) * 100 : 0;
		}

		// Overall coverage is based on code-change (primary agent) via CQRS query
		const codeChangeProcessedQuery = createCountProcessedByAgentQuery(repoId, "code-change");
		const codeChangeProcessedResult = await handleCountProcessedByAgent(codeChangeProcessedQuery, this.repos);
		const processedCommits = codeChangeProcessedResult.data || 0;

		const avgConfidence =
			wikiPages.length > 0
				? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
				: 0;

		return {
			totalCommits,
			processedCommits,
			coveragePercent:
				totalCommits > 0 ? (processedCommits / totalCommits) * 100 : 0,
			agentCoverage,
			pendingWork,
			wikiPages: wikiPages.length,
			avgConfidence,
			openConflicts: openConflicts.length,
			openFindings: openFindings.length,
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
	openFindings: number;
}

/**
 * Create an orchestrator instance.
 */
export function createOrchestrator(
	repos: Repositories,
	llm?: LLMService,
	config?: OrchestratorConfig,
	git?: GitService
): Orchestrator {
	return new Orchestrator(repos, llm, config, git);
}
