/**
 * Represents a Git commit from a connected repository.
 */
export interface Commit {
  id: string;
  /** Reference to the parent repo */
  repoId: string;
  /** Git SHA hash */
  sha: string;
  /** Commit message */
  message: string;
  /** Author name */
  authorName: string;
  /** Author email */
  authorEmail: string;
  /** Commit timestamp */
  committedAt: Date;
  /** Summary of files changed */
  diffSummary: DiffSummary;
  /** Which agents have processed this commit */
  processedBy: AgentProcessingRecord[];
  /** When this commit record was created */
  createdAt: Date;
}

export interface DiffSummary {
  /** Number of files added */
  filesAdded: number;
  /** Number of files modified */
  filesModified: number;
  /** Number of files deleted */
  filesDeleted: number;
  /** Total lines added */
  linesAdded: number;
  /** Total lines deleted */
  linesDeleted: number;
  /** List of affected file paths */
  affectedFiles: string[];
}

export interface AgentProcessingRecord {
  /** Agent type that processed this commit */
  agentType: string;
  /** Reference to the agent run record */
  agentRunId: string;
  /** When processing completed */
  processedAt: Date;
}

export function createCommit(params: {
  id: string;
  repoId: string;
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: Date;
  diffSummary: DiffSummary;
}): Commit {
  return {
    id: params.id,
    repoId: params.repoId,
    sha: params.sha,
    message: params.message,
    authorName: params.authorName,
    authorEmail: params.authorEmail,
    committedAt: params.committedAt,
    diffSummary: params.diffSummary,
    processedBy: [],
    createdAt: new Date(),
  };
}
