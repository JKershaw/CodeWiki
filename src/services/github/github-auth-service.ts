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
      let response: Response;
      try {
        response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
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
      } catch (error) {
        console.error('GitHub OAuth: Network error during token exchange:', error);
        throw new Error('Network error contacting GitHub');
      }

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (data.error || !data.access_token) {
        const errorMsg = data.error_description || data.error || 'Unknown error';
        console.error(`GitHub OAuth: Token exchange failed - ${errorMsg} (error: ${data.error})`);
        throw new Error(`Failed to exchange code: ${errorMsg}`);
      }

      const expiresIn = data.expires_in || 28800; // Default 8 hours
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      console.log('GitHub OAuth: Token exchange successful');
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt,
      };
    },

    async refreshAccessToken(refreshToken: string): Promise<GitHubTokens> {
      let response: Response;
      try {
        response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
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
      } catch (error) {
        console.error('GitHub OAuth: Network error during token refresh:', error);
        throw new Error('Network error contacting GitHub');
      }

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };

      if (data.error || !data.access_token) {
        const errorMsg = data.error_description || data.error || 'Unknown error';
        console.error(`GitHub OAuth: Token refresh failed - ${errorMsg} (error: ${data.error})`);
        throw new Error(`Failed to refresh token: ${errorMsg}`);
      }

      const expiresIn = data.expires_in || 28800;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      console.log('GitHub OAuth: Token refresh successful');
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt,
      };
    },

    async getUserProfile(accessToken: string): Promise<GitHubUserProfile> {
      let response: Response;
      try {
        response = await fetch(`${GITHUB_API_URL}/user`, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
      } catch (error) {
        console.error('GitHub API: Network error fetching user profile:', error);
        throw new Error('Network error contacting GitHub');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        console.error(`GitHub API: Failed to fetch user profile - ${response.status} ${response.statusText}`, {
          message: error.message,
          rateLimitRemaining,
        });
        if (response.status === 401) {
          throw new Error('GitHub access token is invalid or expired');
        }
        if (response.status === 403 && rateLimitRemaining === '0') {
          throw new Error('GitHub API rate limit exceeded');
        }
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

      console.log(`GitHub API: Fetched profile for user ${data.login} (ID: ${data.id})`);
      return profile;
    },

    async getAccessibleRepos(accessToken: string): Promise<GitHubRepo[]> {
      let response: Response;
      try {
        response = await fetch(`${GITHUB_API_URL}/user/installations/repositories`, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
      } catch (error) {
        console.error('GitHub API: Network error fetching repositories:', error);
        throw new Error('Network error contacting GitHub');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        console.error(`GitHub API: Failed to fetch repositories - ${response.status} ${response.statusText}`, {
          message: error.message,
          rateLimitRemaining,
        });
        if (response.status === 401) {
          throw new Error('GitHub access token is invalid or expired');
        }
        if (response.status === 403 && rateLimitRemaining === '0') {
          throw new Error('GitHub API rate limit exceeded');
        }
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

      console.log(`GitHub API: Fetched ${data.total_count} accessible repositories`);
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
