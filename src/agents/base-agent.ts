import type { AgentType, AgentResult, AgentFinding, ToolMetrics } from '../domain/agent-run.js';
import type { WikiPageUpdate } from '../domain/wiki-page.js';
import type { LLMService, ToolUseResult } from '../services/llm/llm-service.js';
import type { Repositories } from '../repositories/index.js';
import type { UnifiedRepoAccess } from '../services/repository/unified-repo-access.js';
import type { WorkTarget, CommitTarget, PathTarget, WikiTarget } from '../domain/work-target.js';
import { isCommitTarget, isPathTarget, isWikiTarget } from '../domain/work-target.js';

// Re-export WorkTarget types for agent convenience
export type { WorkTarget, CommitTarget, PathTarget, WikiTarget };
export { isCommitTarget, isPathTarget, isWikiTarget };

// Re-export ToolMetrics from domain for backwards compatibility
export type { ToolMetrics };

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
   * Unified repository access for file and commit operations.
   * Works with both local filesystem and GitHub API repositories.
   */
  repoAccess?: UnifiedRepoAccess;
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
