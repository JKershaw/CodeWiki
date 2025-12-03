/**
 * GitHub authentication service.
 *
 * Handles OAuth flow, token management, and GitHub API interactions
 * for GitHub App authentication.
 */

import { randomBytes } from 'crypto';

/**
 * Configuration for GitHub OAuth.
 */
export interface GitHubAuthConfig {
  /** GitHub App client ID */
  clientId: string;
  /** GitHub App client secret */
  clientSecret: string;
  /** GitHub App name (URL-safe) */
  appName: string;
  /** OAuth callback URL */
  redirectUri: string;
}

/**
 * OAuth tokens from GitHub.
 */
export interface GitHubTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * GitHub user profile information.
 */
export interface GitHubUserProfile {
  id: number;
  login: string;
  avatarUrl: string;
  name?: string;
  email?: string;
}

/**
 * Repository information from GitHub.
 */
export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  isPrivate: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

/**
 * GitHub auth service interface.
 */
export interface GitHubAuthService {
  /**
   * Generate the GitHub OAuth authorization URL.
   */
  getAuthorizationUrl(state: string): string;

  /**
   * Get the URL for users to install/configure the GitHub App.
   */
  getInstallationUrl(): string;

  /**
   * Exchange an authorization code for access tokens.
   */
  exchangeCodeForTokens(code: string): Promise<GitHubTokens>;

  /**
   * Refresh an expired access token.
   */
  refreshAccessToken(refreshToken: string): Promise<GitHubTokens>;

  /**
   * Get the authenticated user's profile.
   */
  getUserProfile(accessToken: string): Promise<GitHubUserProfile>;

  /**
   * Get repositories accessible to the user via the GitHub App.
   */
  getAccessibleRepos(accessToken: string): Promise<GitHubRepo[]>;

  /**
   * Generate a random state string for OAuth CSRF protection.
   */
  generateState(): string;
}

/**
 * Create a GitHub auth service instance.
 */
export function createGitHubAuthService(config: GitHubAuthConfig): GitHubAuthService {
  const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';
  const GITHUB_API_URL = 'https://api.github.com';

  return {
    getAuthorizationUrl(state: string): string {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state,
      });
      return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
    },

    getInstallationUrl(): string {
      return `https://github.com/apps/${config.appName}/installations/new`;
    },

    async exchangeCodeForTokens(code: string): Promise<GitHubTokens> {
      const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
        }).toString(),
      });

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (data.error || !data.access_token) {
        throw new Error(`Failed to exchange code: ${data.error_description || data.error || 'Unknown error'}`);
      }

      const expiresIn = data.expires_in || 28800; // Default 8 hours
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt,
      };
    },

    async refreshAccessToken(refreshToken: string): Promise<GitHubTokens> {
      const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (data.error || !data.access_token) {
        throw new Error(`Failed to refresh token: ${data.error_description || data.error || 'Unknown error'}`);
      }

      const expiresIn = data.expires_in || 28800;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt,
      };
    },

    async getUserProfile(accessToken: string): Promise<GitHubUserProfile> {
      const response = await fetch(`${GITHUB_API_URL}/user`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(`Failed to fetch user profile: ${error.message || response.statusText}`);
      }

      const data = await response.json() as {
        id: number;
        login: string;
        avatar_url: string;
        name?: string;
        email?: string;
      };

      const profile: GitHubUserProfile = {
        id: data.id,
        login: data.login,
        avatarUrl: data.avatar_url,
      };

      // Only add optional properties if they have values
      if (data.name !== undefined) {
        profile.name = data.name;
      }
      if (data.email !== undefined) {
        profile.email = data.email;
      }

      return profile;
    },

    async getAccessibleRepos(accessToken: string): Promise<GitHubRepo[]> {
      const response = await fetch(`${GITHUB_API_URL}/user/installations/repositories`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(`Failed to fetch repositories: ${error.message || response.statusText}`);
      }

      const data = await response.json() as {
        total_count: number;
        repositories: Array<{
          id: number;
          name: string;
          full_name: string;
          private: boolean;
          html_url: string;
          clone_url: string;
          default_branch: string;
        }>;
      };

      return data.repositories.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        isPrivate: repo.private,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
      }));
    },

    generateState(): string {
      return randomBytes(16).toString('hex');
    },
  };
}
