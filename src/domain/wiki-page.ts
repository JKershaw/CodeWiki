/**
 * Represents a page in the generated wiki.
 */
export interface WikiPage {
  id: string;
  /** Reference to the repo this wiki belongs to */
  repoId: string;
  /** Page path/slug, e.g., "architecture/cqrs" */
  path: string;
  /** Page title */
  title: string;
  /** Markdown content */
  content: string;
  /** Confidence score from 0-1 based on analysis depth */
  confidence: number;
  /** Commits that contributed to this page's content */
  sourceCommits: string[];
  /** Links to other wiki pages */
  links: string[];
  /** Pages that link to this page */
  backlinks: string[];
  /** When the page was created */
  createdAt: Date;
  /** When the page was last updated */
  updatedAt: Date;
}

export interface WikiPageUpdate {
  /** Type of update */
  type: 'create' | 'update' | 'merge';
  /** Target page path */
  path: string;
  /** New or updated content */
  content: string;
  /** Commit that triggered this update */
  sourceCommitId: string;
  /** Agent that requested this update */
  agentRunId: string;
  /** Suggested confidence adjustment */
  confidenceDelta: number;
}

export function createWikiPage(params: {
  id: string;
  repoId: string;
  path: string;
  title: string;
  content: string;
  sourceCommitId: string;
}): WikiPage {
  return {
    id: params.id,
    repoId: params.repoId,
    path: params.path,
    title: params.title,
    content: params.content,
    confidence: 0.5, // Start at medium confidence
    sourceCommits: [params.sourceCommitId],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Calculate confidence score based on various factors.
 */
export function calculateConfidence(page: WikiPage, factors: {
  commitsAnalyzed: number;
  totalCommits: number;
  agentVerifications: number;
  daysSinceUpdate: number;
}): number {
  const coverageScore = Math.min(factors.commitsAnalyzed / Math.max(factors.totalCommits, 1), 1);
  const verificationScore = Math.min(factors.agentVerifications / 3, 1); // 3+ verifications = full score
  const freshnessScore = Math.max(0, 1 - (factors.daysSinceUpdate / 30)); // Decays over 30 days

  // Weighted average
  return (coverageScore * 0.4) + (verificationScore * 0.4) + (freshnessScore * 0.2);
}
