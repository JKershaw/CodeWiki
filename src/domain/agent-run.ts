/**
 * Represents a single execution of an agent.
 */
export interface AgentRun {
  id: string;
  /** Reference to the repo (for git access) */
  repoId: string;
  /** Reference to the wiki being updated */
  wikiId: string;
  /** Type of agent that ran */
  agentType: AgentType;
  /** Target commit (for commit-focused agents) */
  targetCommitId: string | null;
  /** Status of the run */
  status: AgentRunStatus;
  /** What the agent found/decided */
  result: AgentResult | null;
  /** Wiki updates requested by this agent */
  requestedUpdates: string[];
  /** Execution duration in milliseconds */
  durationMs: number | null;
  /** Estimated cost in dollars */
  costUsd: number | null;
  /** Error message if failed */
  error: string | null;
  /** When the run started */
  startedAt: Date;
  /** When the run completed */
  completedAt: Date | null;
}

export type AgentType =
  // Analysis agents - examine commits
  | 'code-change'
  | 'narrative'
  | 'security'
  | 'technical-debt'
  | 'pattern'
  | 'dependency'
  // Meta agents - examine the wiki
  | 'structure'
  | 'link'
  | 'quality'
  | 'consistency'
  // Synthesis agents - create higher-order content
  | 'guide'
  | 'overview'
  | 'project-overview'
  | 'getting-started'
  | 'testing-guide'
  | 'extension-guide'
  | 'history'
  | 'convention'
  // Navigation agents - improve discoverability
  | 'wiki-index'
  | 'toc'
  // Special agents
  | 'orchestrator'
  | 'research'
  | 'writer'
  | 'bootstrap'
  // Consolidation agent - self-healing wiki maintenance
  | 'consolidation';

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface AgentResult {
  /** Summary of what the agent found */
  summary: string;
  /** Detailed findings */
  findings: AgentFinding[];
  /** Confidence in the analysis */
  confidence: number;
}

export interface AgentFinding {
  /** Type of finding */
  type: string;
  /** Description */
  description: string;
  /** Relevant file paths */
  relatedPaths: string[];
  /** Importance level */
  importance: 'low' | 'medium' | 'high';
}

export function createAgentRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  agentType: AgentType;
  targetCommitId?: string | undefined;
}): AgentRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    agentType: params.agentType,
    targetCommitId: params.targetCommitId ?? null,
    status: 'pending',
    result: null,
    requestedUpdates: [],
    durationMs: null,
    costUsd: null,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
}
