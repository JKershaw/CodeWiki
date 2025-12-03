/**
 * User domain type for GitHub-authenticated users.
 */

/**
 * Represents a user authenticated via GitHub OAuth.
 */
export interface User {
  /** Unique identifier for the user in our system */
  id: string;
  /** GitHub user ID */
  githubId: number;
  /** GitHub username */
  login: string;
  /** GitHub avatar URL */
  avatarUrl: string;
  /** Optional display name from GitHub profile */
  name?: string;
  /** Optional email from GitHub profile */
  email?: string;
  /** GitHub OAuth access token */
  accessToken: string;
  /** GitHub OAuth refresh token */
  refreshToken: string;
  /** When the access token expires */
  tokenExpiresAt: Date;
  /** When the user first authenticated */
  createdAt: Date;
  /** When the user last logged in */
  lastLoginAt: Date;
}

/**
 * Token data for updating user authentication.
 */
export interface GitHubTokens {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}

/**
 * Parameters for creating a new user.
 */
export interface CreateUserParams {
  id: string;
  githubId: number;
  login: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  name?: string;
  email?: string;
}

/**
 * Create a new user from GitHub profile and tokens.
 */
export function createUser(params: CreateUserParams): User {
  const now = new Date();
  const user: User = {
    id: params.id,
    githubId: params.githubId,
    login: params.login,
    avatarUrl: params.avatarUrl,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    tokenExpiresAt: params.tokenExpiresAt,
    createdAt: now,
    lastLoginAt: now,
  };

  // Only add optional properties if they have values
  if (params.name !== undefined) {
    user.name = params.name;
  }
  if (params.email !== undefined) {
    user.email = params.email;
  }

  return user;
}

/**
 * Update user's OAuth tokens after refresh.
 * Returns a new user object without mutating the original.
 */
export function updateUserTokens(user: User, tokens: GitHubTokens): User {
  return {
    ...user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.tokenExpiresAt,
    lastLoginAt: new Date(),
  };
}

/**
 * Default buffer time before token expiry to consider it expired (5 minutes).
 */
const DEFAULT_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check if the user's access token is expired or about to expire.
 *
 * @param user - The user to check
 * @param bufferMs - Time buffer before actual expiry to consider expired (default: 5 minutes)
 * @returns true if the token is expired or will expire within the buffer period
 */
export function isTokenExpired(user: User, bufferMs: number = DEFAULT_EXPIRY_BUFFER_MS): boolean {
  const now = Date.now();
  const expiresAt = user.tokenExpiresAt.getTime();
  return now >= expiresAt - bufferMs;
}
