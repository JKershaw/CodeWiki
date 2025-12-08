import type { AgentType, AgentResult, AgentFinding } from '../domain/agent-run.js';
import type { WikiPageUpdate } from '../domain/wiki-page.js';
import type { LLMService, ToolUseResult } from '../services/llm/llm-service.js';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
import type { RepositoryService } from '../services/repository/repository-service.js';
import type { UnifiedRepoAccess } from '../services/repository/unified-repo-access.js';
import type { Repo } from '../domain/repo.js';
import type { WorkTarget, CommitTarget, PathTarget, WikiTarget } from '../domain/work-target.js';
import { isCommitTarget, isPathTarget, isWikiTarget } from '../domain/work-target.js';

// Re-export WorkTarget types for agent convenience
export type { WorkTarget, CommitTarget, PathTarget, WikiTarget };
export { isCommitTarget, isPathTarget, isWikiTarget };

/**
 * Context provided to agents when they run.
 */
export interface AgentContext {
  /** Repository ID (for git access) */
  repoId: string;
  /** Wiki ID being updated */
  wikiId: string;
  /** All repositories for data access */
  repos: Repositories;
  /** LLM service for AI completions */
  llm: LLMService;

  /**
   * Unified repository access - the preferred way to access repository files and commits.
   * Works with both local filesystem and GitHub API repositories.
   * Use this instead of git, repoService, or repo.
   */
  repoAccess?: UnifiedRepoAccess;

  /**
   * Git service for local repository access.
   * @deprecated Use repoAccess instead - it works with both GitHub and local repos.
   */
  git: GitService;
  /**
   * Unified repository service for file/commit access.
   * @deprecated Use repoAccess instead - it provides the same functionality with a simpler API.
   */
  repoService?: RepositoryService;
  /**
   * The repository entity with metadata (owner, repoName, isGitHubRepo).
   * @deprecated Use repoAccess.isLocal() and repoAccess.getLocalPath() instead.
   */
  repo?: Repo;
}

/**
 * Metrics about tool usage during an agent run.
 * Used to validate that agents properly verify claims against source code.
 */
export interface ToolMetrics {
  /** Total number of tool calls made */
  toolCallCount: number;
  /** Map of tool name to usage count */
  toolsUsed: Record<string, number>;
  /** List of files read (for read_file calls) */
  filesRead: string[];
}

/**
 * Result of running an agent.
 */
export interface AgentRunResult {
  /** The analysis result */
  result: AgentResult;
  /** Wiki page updates requested by the agent */
  updates: WikiPageUpdate[];
  /** Cost of this run in USD */
  costUsd: number;
  /** Tool usage metrics (optional, for enforcement validation) */
  toolMetrics?: ToolMetrics;
}

/**
 * Extract tool metrics from a ToolUseResult.
 * Agents should call this to populate toolMetrics in their result.
 */
export function extractToolMetrics(completion: ToolUseResult): ToolMetrics {
  const toolsUsed: Record<string, number> = {};
  const filesRead: string[] = [];

  for (const call of completion.toolCalls) {
    toolsUsed[call.name] = (toolsUsed[call.name] ?? 0) + 1;

    if (call.name === 'read_file' && typeof call.input['path'] === 'string') {
      filesRead.push(call.input['path']);
    }
  }

  return {
    toolCallCount: completion.toolCalls.length,
    toolsUsed,
    filesRead,
  };
}

/**
 * Base interface for all agents.
 *
 * Agents implement a polymorphic interface using WorkTarget:
 * - canHandle(target) - returns true if agent can process this target type
 * - run(target, context) - unified entry point for all target types
 *
 * Legacy methods (runOnCommit, runOnWiki, runOnPath) are deprecated.
 */
export interface Agent {
  /** The type of this agent */
  readonly type: AgentType;

  /**
   * Get the system prompt used by this agent, if any.
   * Returns null for agents that don't use an LLM (pure computation).
   * This enables introspection of agent prompts for self-improvement analysis.
   */
  getSystemPrompt(): string | null;

  /**
   * Check if this agent can handle the given work target.
   * @param target - The work target (commit, path, or wiki)
   * @returns true if the agent can process this target type
   */
  canHandle(target: WorkTarget): boolean;

  /**
   * Run the agent on the given work target.
   * @param target - The work target (commit, path, or wiki)
   * @param context - Agent execution context
   * @throws Error if the agent cannot handle the target type
   */
  run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult>;

  /**
   * @deprecated Use run() with CommitTarget instead
   * Run the agent on a specific commit.
   */
  runOnCommit?(commitId: string, context: AgentContext): Promise<AgentRunResult>;

  /**
   * @deprecated Use run() with WikiTarget instead
   * Run the agent on the wiki (for meta/synthesis agents).
   */
  runOnWiki?(context: AgentContext): Promise<AgentRunResult>;

  /**
   * @deprecated Use run() with PathTarget instead
   * Run the agent on a specific path (directory or file) for exploration.
   */
  runOnPath?(targetPath: string, context: AgentContext): Promise<AgentRunResult>;
}

/**
 * Helper to create a finding.
 */
export function createFinding(params: {
  type: string;
  description: string;
  relatedPaths?: string[];
  importance?: 'low' | 'medium' | 'high';
}): AgentFinding {
  return {
    type: params.type,
    description: params.description,
    relatedPaths: params.relatedPaths ?? [],
    importance: params.importance ?? 'medium',
  };
}

/**
 * Helper to create an agent result.
 */
export function createAgentResult(params: {
  summary: string;
  findings: AgentFinding[];
  confidence?: number;
}): AgentResult {
  return {
    summary: params.summary,
    findings: params.findings,
    confidence: params.confidence ?? 0.7,
  };
}
