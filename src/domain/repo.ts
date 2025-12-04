/**
 * Represents a connected Git repository being processed by CodeWiki.
 */
export interface Repo {
  id: string;
  /** GitHub owner/name format, e.g., "anthropics/codewiki" */
  fullName: string;
  /** GitHub owner (e.g., "anthropics") - only for GitHub repos */
  owner?: string;
  /** GitHub repo name (e.g., "codewiki") - only for GitHub repos */
  repoName?: string;
  /** Whether this is a GitHub repository (vs local filesystem) */
  isGitHubRepo: boolean;
  /** URL for cloning (for GitHub) or local path (for local repos) */
  cloneUrl: string;
  /** Default branch name */
  defaultBranch: string;
  /** Current processing status */
  status: RepoStatus;
  /** Processing configuration */
  config: RepoConfig;
  /** When the repo was connected */
  createdAt: Date;
  /** Last time any processing occurred */
  lastProcessedAt: Date | null;
  /** User ID who added this repo (for GitHub auth) */
  userId?: string;
}

export type RepoStatus =
  | 'pending'      // Connected but not yet processed
  | 'processing'   // Currently being processed
  | 'ready'        // Processing complete, wiki is ready
  | 'paused'       // Processing paused by user
  | 'error';       // Processing encountered an error

export interface RepoConfig {
  /** Throttle settings for rate limiting */
  throttle: ThrottleConfig;
  /** Which agent types are enabled */
  enabledAgents: string[];
}

export interface ThrottleConfig {
  /** Max API calls per minute */
  maxCallsPerMinute: number;
  /** Max cost per hour in dollars */
  maxCostPerHour: number;
}

/**
 * Parameters for creating a repository.
 */
export interface CreateRepoParams {
  id: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  /** GitHub owner - required for GitHub repos */
  owner?: string;
  /** GitHub repo name - required for GitHub repos */
  repoName?: string;
  /** Whether this is a GitHub repo (default: auto-detected from cloneUrl) */
  isGitHubRepo?: boolean;
  /** User ID who added this repo (for GitHub auth) */
  userId?: string;
}

/**
 * Parse owner and repo name from a GitHub URL or fullName.
 */
export function parseGitHubFullName(fullName: string): { owner: string; repoName: string } | null {
  const match = fullName.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repoName: match[2]! };
  }
  return null;
}

export function createRepo(params: CreateRepoParams): Repo {
  // Auto-detect if this is a GitHub repo
  const isGitHubRepo = params.isGitHubRepo ?? params.cloneUrl.includes('github.com');

  // Parse owner/repoName from fullName if not provided
  let owner = params.owner;
  let repoName = params.repoName;

  if (isGitHubRepo && !owner && !repoName) {
    const parsed = parseGitHubFullName(params.fullName);
    if (parsed) {
      owner = parsed.owner;
      repoName = parsed.repoName;
    }
  }

  return {
    id: params.id,
    fullName: params.fullName,
    ...(owner && { owner }),
    ...(repoName && { repoName }),
    isGitHubRepo,
    cloneUrl: params.cloneUrl,
    defaultBranch: params.defaultBranch,
    status: 'pending',
    config: {
      throttle: {
        maxCallsPerMinute: 10,
        maxCostPerHour: 1.0,
      },
      enabledAgents: ['code-change'],
    },
    createdAt: new Date(),
    lastProcessedAt: null,
    ...(params.userId && { userId: params.userId }),
  };
}
