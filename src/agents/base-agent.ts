import type { AgentType, AgentResult, AgentFinding } from '../domain/agent-run.js';
import type { WikiPageUpdate } from '../domain/wiki-page.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';
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
  /** Git service for repository access */
  git: GitService;
  /** LLM service for AI completions */
  llm: LLMService;
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
