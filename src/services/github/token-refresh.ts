/**
 * Token refresh utility for GitHub OAuth tokens.
 *
 * Provides centralized logic to check token expiry and refresh tokens
 * automatically before they expire.
 */

import type { User, GitHubTokens } from '../../domain/user.js';
import { isTokenExpired } from '../../domain/user.js';
import type { GitHubAuthService } from './github-auth-service.js';
import type { UserRepository } from '../../repositories/interfaces/user-repository.js';

/**
 * Error thrown when token refresh fails and user needs to re-authenticate.
 */
export class TokenRefreshError extends Error {
  constructor(message: string, public readonly requiresReauth: boolean = true) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

/**
 * Result from ensuring a valid token.
 */
export interface ValidTokenResult {
  /** The valid access token to use */
  accessToken: string;
  /** Whether the token was refreshed */
  refreshed: boolean;
  /** The updated user object (if refreshed) */
  user: User;
}

/**
 * In-flight refresh tracking to prevent concurrent refresh requests.
 * Maps user ID to a promise that resolves when refresh completes.
 */
const inFlightRefreshes = new Map<string, Promise<ValidTokenResult>>();

/**
 * Ensure the user has a valid (non-expired) access token.
 *
 * If the token is expired or about to expire (within 5 minute buffer),
 * this will automatically refresh it using the refresh token and
 * persist the new tokens to the database.
 *
 * @param user - The user whose token to validate
 * @param githubAuth - GitHub auth service for token refresh
 * @param userRepository - User repository for persisting refreshed tokens
 * @returns The valid access token and whether it was refreshed
 * @throws TokenRefreshError if the token is expired and refresh fails
 */
export async function ensureValidToken(
  user: User,
  githubAuth: GitHubAuthService,
  userRepository: UserRepository
): Promise<ValidTokenResult> {
  // Check if token is still valid
  if (!isTokenExpired(user)) {
    return {
      accessToken: user.accessToken,
      refreshed: false,
      user,
    };
  }

  // Token is expired or about to expire - need to refresh
  console.log(`GitHub OAuth: Token expired for user ${user.login}, attempting refresh`);

  // Check if there's already an in-flight refresh for this user
  const existingRefresh = inFlightRefreshes.get(user.id);
  if (existingRefresh) {
    console.log(`GitHub OAuth: Waiting for in-flight refresh for user ${user.login}`);
    return existingRefresh;
  }

  // Start the refresh process
  const refreshPromise = performTokenRefresh(user, githubAuth, userRepository);
  inFlightRefreshes.set(user.id, refreshPromise);

  try {
    const result = await refreshPromise;
    return result;
  } finally {
    // Clean up the in-flight tracking
    inFlightRefreshes.delete(user.id);
  }
}

/**
 * Actually perform the token refresh.
 */
async function performTokenRefresh(
  user: User,
  githubAuth: GitHubAuthService,
  userRepository: UserRepository
): Promise<ValidTokenResult> {
  // Check if user has a refresh token
  if (!user.refreshToken) {
    console.error(`GitHub OAuth: No refresh token available for user ${user.login}`);
    throw new TokenRefreshError('No refresh token available. Please log in again.');
  }

  try {
    // Attempt to refresh the token
    const newTokens = await githubAuth.refreshAccessToken(user.refreshToken);

    // Create the GitHubTokens object for persistence
    const tokensForPersistence: GitHubTokens = {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      tokenExpiresAt: newTokens.expiresAt,
    };

    // Persist the new tokens
    await userRepository.updateTokens(user.id, tokensForPersistence);

    // Create updated user object
    const updatedUser: User = {
      ...user,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      tokenExpiresAt: newTokens.expiresAt,
    };

    console.log(`GitHub OAuth: Token refreshed successfully for user ${user.login}`);

    return {
      accessToken: newTokens.accessToken,
      refreshed: true,
      user: updatedUser,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`GitHub OAuth: Token refresh failed for user ${user.login}: ${errorMessage}`);

    // Check for specific refresh failure reasons
    if (errorMessage.includes('bad_refresh_token') ||
        errorMessage.includes('invalid_grant') ||
        errorMessage.includes('The refresh token has expired')) {
      throw new TokenRefreshError(
        'Your session has expired. Please log in again.',
        true
      );
    }

    // Network or other transient errors
    throw new TokenRefreshError(
      `Failed to refresh token: ${errorMessage}`,
      true
    );
  }
}
