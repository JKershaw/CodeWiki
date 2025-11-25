/**
 * Represents a connected Git repository being processed by CodeWiki.
 */
export interface Repo {
  id: string;
  /** GitHub owner/name format, e.g., "anthropics/codewiki" */
  fullName: string;
  /** URL for cloning */
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
}

export type RepoStatus =
  | 'pending'      // Connected but not yet processed
  | 'processing'   // Currently being processed
  | 'paused'       // Processing paused by user
  | 'error';       // Processing encountered an error

export interface RepoConfig {
  /** Max concurrent agents */
  maxConcurrency: number;
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

export function createRepo(params: {
  id: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}): Repo {
  return {
    id: params.id,
    fullName: params.fullName,
    cloneUrl: params.cloneUrl,
    defaultBranch: params.defaultBranch,
    status: 'pending',
    config: {
      maxConcurrency: 1,
      throttle: {
        maxCallsPerMinute: 10,
        maxCostPerHour: 1.0,
      },
      enabledAgents: ['code-change'],
    },
    createdAt: new Date(),
    lastProcessedAt: null,
  };
}
