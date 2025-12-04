/**
 * Unit tests for GitHub authentication service.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createGitHubAuthService,
  type GitHubAuthService,
  type GitHubAuthConfig,
} from '../../src/services/github/github-auth-service.js';

describe('GitHub Auth Service', () => {
  let authService: GitHubAuthService;
  const testConfig: GitHubAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    appName: 'test-app',
    redirectUri: 'http://localhost:3000/auth/github/callback',
  };

  beforeEach(() => {
    authService = createGitHubAuthService(testConfig);
  });

  describe('getAuthorizationUrl', () => {
    it('generates a valid GitHub authorization URL', () => {
      const state = 'random-state-123';
      const url = authService.getAuthorizationUrl(state);

      assert.ok(url.startsWith('https://github.com/login/oauth/authorize'));
      assert.ok(url.includes(`client_id=${testConfig.clientId}`));
      assert.ok(url.includes(`state=${state}`));
    });

    it('includes redirect_uri parameter', () => {
      const state = 'test-state';
      const url = authService.getAuthorizationUrl(state);

      assert.ok(url.includes(`redirect_uri=${encodeURIComponent(testConfig.redirectUri)}`));
    });

    it('uses different states for different calls', () => {
      const url1 = authService.getAuthorizationUrl('state-1');
      const url2 = authService.getAuthorizationUrl('state-2');

      assert.ok(url1.includes('state=state-1'));
      assert.ok(url2.includes('state=state-2'));
      assert.notStrictEqual(url1, url2);
    });
  });

  describe('getInstallationUrl', () => {
    it('generates GitHub App installation URL', () => {
      const url = authService.getInstallationUrl();

      assert.strictEqual(url, `https://github.com/apps/${testConfig.appName}/installations/new`);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('makes POST request to GitHub OAuth endpoint', async () => {
      // Mock fetch
      const mockResponse = {
        access_token: 'ghu_test123',
        refresh_token: 'ghr_test456',
        expires_in: 28800,
        token_type: 'bearer',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('github.com/login/oauth/access_token'));
        assert.strictEqual(options.method, 'POST');
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const tokens = await authService.exchangeCodeForTokens('auth-code-123');

        assert.ok(tokens);
        assert.strictEqual(tokens.accessToken, 'ghu_test123');
        assert.strictEqual(tokens.refreshToken, 'ghr_test456');
        assert.ok(tokens.expiresAt instanceof Date);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws error on failed token exchange', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify({ error: 'bad_verification_code' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        await assert.rejects(
          () => authService.exchangeCodeForTokens('invalid-code'),
          /Failed to exchange code|bad_verification_code/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes token using refresh token', async () => {
      const mockResponse = {
        access_token: 'ghu_new123',
        refresh_token: 'ghr_new456',
        expires_in: 28800,
        token_type: 'bearer',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('github.com/login/oauth/access_token'));
        const body = options.body as string;
        assert.ok(body.includes('grant_type=refresh_token'));
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const tokens = await authService.refreshAccessToken('ghr_old_refresh');

        assert.ok(tokens);
        assert.strictEqual(tokens.accessToken, 'ghu_new123');
        assert.strictEqual(tokens.refreshToken, 'ghr_new456');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getUserProfile', () => {
    it('fetches user profile from GitHub API', async () => {
      const mockUser = {
        id: 12345,
        login: 'testuser',
        avatar_url: 'https://avatars.githubusercontent.com/u/12345',
        name: 'Test User',
        email: 'test@example.com',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('api.github.com/user'));
        assert.ok((options.headers as Record<string, string>)['Authorization']?.includes('Bearer'));
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const profile = await authService.getUserProfile('ghu_test_token');

        assert.strictEqual(profile.id, 12345);
        assert.strictEqual(profile.login, 'testuser');
        assert.strictEqual(profile.avatarUrl, 'https://avatars.githubusercontent.com/u/12345');
        assert.strictEqual(profile.name, 'Test User');
        assert.strictEqual(profile.email, 'test@example.com');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws error for invalid token', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        await assert.rejects(
          () => authService.getUserProfile('invalid-token'),
          /invalid or expired|Unauthorized|Bad credentials|Failed to fetch/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getAccessibleRepos', () => {
    it('fetches repositories accessible via the GitHub App', async () => {
      const mockRepos = {
        total_count: 2,
        repositories: [
          {
            id: 1,
            name: 'repo-1',
            full_name: 'owner/repo-1',
            private: false,
            html_url: 'https://github.com/owner/repo-1',
            clone_url: 'https://github.com/owner/repo-1.git',
            default_branch: 'main',
          },
          {
            id: 2,
            name: 'repo-2',
            full_name: 'owner/repo-2',
            private: true,
            html_url: 'https://github.com/owner/repo-2',
            clone_url: 'https://github.com/owner/repo-2.git',
            default_branch: 'master',
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async (url: string) => {
        assert.ok(url.includes('api.github.com/user/installations'));
        return new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const repos = await authService.getAccessibleRepos('ghu_test_token');

        assert.strictEqual(repos.length, 2);
        assert.strictEqual(repos[0].fullName, 'owner/repo-1');
        assert.strictEqual(repos[0].isPrivate, false);
        assert.strictEqual(repos[1].fullName, 'owner/repo-2');
        assert.strictEqual(repos[1].isPrivate, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns empty array when no repos accessible', async () => {
      const mockRepos = {
        total_count: 0,
        repositories: [],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const repos = await authService.getAccessibleRepos('ghu_test_token');

        assert.strictEqual(repos.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('generateState', () => {
    it('generates random state string', () => {
      const state1 = authService.generateState();
      const state2 = authService.generateState();

      assert.ok(state1);
      assert.ok(state2);
      assert.strictEqual(typeof state1, 'string');
      assert.ok(state1.length >= 16);
      assert.notStrictEqual(state1, state2);
    });
  });
});
