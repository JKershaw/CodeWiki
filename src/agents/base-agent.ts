import type { AgentType, AgentResult, AgentFinding } from '../domain/agent-run.js';
import type { WikiPageUpdate } from '../domain/wiki-page.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { Repositories } from '../repositories/index.js';
import type { GitService } from '../services/git/git-service.js';

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
   * Run the agent on a specific commit.
   */
  runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult>;

  /**
   * Run the agent on the wiki (for meta/synthesis agents).
   * Not all agents support this.
   */
  runOnWiki?(context: AgentContext): Promise<AgentRunResult>;

  /**
   * Run the agent on a specific path (directory or file) for exploration.
   * Used by exploration agents to document undocumented parts of the codebase.
   * @param targetPath - The path to explore (e.g., "src/services/llm" or "src/utils/helpers.ts")
   * @param context - Agent execution context
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
