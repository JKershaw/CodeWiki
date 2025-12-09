/**
 * Represents a page in the generated wiki.
 */
export interface WikiPage {
  id: string;
  /** Reference to the wiki this page belongs to */
  wikiId: string;
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
  /** Agent runs that contributed to this page's content (for provenance tracking) */
  sourceAgentRunIds: string[];
  /** Links to other wiki pages */
  links: string[];
  /** Pages that link to this page */
  backlinks: string[];
  /** Inferred category for the page (e.g., "architecture", "security") */
  category?: string;
  /** Confidence score for the category assignment (0-1) */
  categoryConfidence?: number;
  /** When the page was created */
  createdAt: Date;
  /** When the page was last updated */
  updatedAt: Date;
}

export interface WikiPageUpdate {
  /** Type of update */
  type: 'create' | 'update' | 'merge' | 'delete';
  /** Target page path */
  path: string;
  /** Page title (optional, extracted from content if not provided) */
  title?: string;
  /** New or updated content (not required for delete) */
  content: string;
  /** Commit that triggered this update (optional for exploration agents) */
  sourceCommitId?: string;
  /** Agent that requested this update */
  agentRunId: string;
  /** Suggested confidence adjustment */
  confidenceDelta: number;
  /** For delete: optional redirect to another page after deletion */
  redirectTo?: string;
  /** For consolidation: ID of finding that triggered this update */
  findingId?: string;
  /** Links to other wiki pages (paths) to set on this page */
  links?: string[];
  /** Skip content validation (for tests and programmatic updates) */
  skipValidation?: boolean;
}

export function createWikiPage(params: {
  id: string;
  wikiId: string;
  path: string;
  title: string;
  content: string;
  sourceCommitId?: string;
  sourceAgentRunId?: string;
}): WikiPage {
  return {
    id: params.id,
    wikiId: params.wikiId,
    path: params.path,
    title: params.title,
    content: params.content,
    confidence: 0.5, // Start at medium confidence
    sourceCommits: params.sourceCommitId ? [params.sourceCommitId] : [],
    sourceAgentRunIds: params.sourceAgentRunId ? [params.sourceAgentRunId] : [],
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
