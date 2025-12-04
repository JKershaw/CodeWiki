/**
 * Unit tests for GitHub authentication routes.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Request, Response } from 'express';
import {
  createGitHubAuthRoutes,
  type GitHubAuthRoutesConfig,
} from '../../src/web/routes/github-auth.js';
import { createJwtService } from '../../src/services/auth/jwt-service.js';
import { createGitHubAuthService } from '../../src/services/github/github-auth-service.js';
import { createUser } from '../../src/domain/user.js';
import type { UserRepository } from '../../src/repositories/interfaces/user-repository.js';
import type { User, GitHubTokens } from '../../src/domain/user.js';
import { v4 as uuid } from 'uuid';

describe('GitHub Auth Routes', () => {
  const testSecret = 'test-jwt-secret';
  let config: GitHubAuthRoutesConfig;
  let mockUserRepo: UserRepository;
  let users: Map<string, User>;

  beforeEach(() => {
    users = new Map();

    mockUserRepo = {
      async findById(id: string) {
        return users.get(id) ?? null;
      },
      async findByGitHubId(githubId: number) {
        for (const user of users.values()) {
          if (user.githubId === githubId) return user;
        }
        return null;
      },
      async findByLogin(login: string) {
        for (const user of users.values()) {
          if (user.login === login) return user;
        }
        return null;
      },
      async findAll() {
        return Array.from(users.values());
      },
      async save(user: User) {
        users.set(user.id, user);
      },
      async updateTokens(id: string, tokens: GitHubTokens) {
        const user = users.get(id);
        if (user) {
          user.accessToken = tokens.accessToken;
          user.refreshToken = tokens.refreshToken;
          user.tokenExpiresAt = tokens.tokenExpiresAt;
        }
      },
      async delete(id: string) {
        users.delete(id);
      },
    };

    config = {
      jwtService: createJwtService(testSecret),
      githubAuth: createGitHubAuthService({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        appName: 'test-app',
        redirectUri: 'http://localhost:3000/auth/github/callback',
      }),
      userRepository: mockUserRepo,
      sessionSecret: testSecret,
    };
  });

  /**
   * Create a mock request.
   */
  function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
      query: {},
      body: {},
      signedCookies: {},
      cookies: {},
      path: '/auth/github',
      ...overrides,
    } as unknown as Request;
  }

  /**
   * Create a mock response with tracking.
   */
  function createMockResponse(): Response & {
    statusCode: number;
    jsonData: unknown;
    redirectUrl: string | null;
    cookiesSet: Array<{ name: string; value: string; options: unknown }>;
    cookiesCleared: string[];
  } {
    const res = {
      statusCode: 200,
      jsonData: null as unknown,
      redirectUrl: null as string | null,
      cookiesSet: [] as Array<{ name: string; value: string; options: unknown }>,
      cookiesCleared: [] as string[],
      status: function(code: number) {
        this.statusCode = code;
        return this;
      },
      json: function(data: unknown) {
        this.jsonData = data;
        return this;
      },
      redirect: function(url: string) {
        this.redirectUrl = url;
        return this;
      },
      cookie: function(name: string, value: string, options: unknown) {
        this.cookiesSet.push({ name, value, options });
        return this;
      },
      clearCookie: function(name: string) {
        this.cookiesCleared.push(name);
        return this;
      },
    } as unknown as Response & {
      statusCode: number;
      jsonData: unknown;
      redirectUrl: string | null;
      cookiesSet: Array<{ name: string; value: string; options: unknown }>;
      cookiesCleared: string[];
    };
    return res;
  }

  describe('GET /auth/github', () => {
    it('redirects to GitHub authorization URL', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.initiateAuth(req, res);

      assert.ok(res.redirectUrl);
      assert.ok(res.redirectUrl.includes('github.com/login/oauth/authorize'));
      assert.ok(res.redirectUrl.includes('client_id=test-client-id'));
    });

    it('sets state cookie for CSRF protection', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.initiateAuth(req, res);

      assert.strictEqual(res.cookiesSet.length, 1);
      assert.strictEqual(res.cookiesSet[0]!.name, 'github_oauth_state');
      assert.ok(res.cookiesSet[0]!.value.length > 0);
    });
  });

  describe('GET /auth/github/callback', () => {
    it('redirects to OAuth flow when GitHub App installation callback is received', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        query: {
          code: 'auth-code',
          installation_id: '12345678',
          setup_action: 'install',
        },
        // No state cookie - this is an installation flow
        signedCookies: {},
      });
      const res = createMockResponse();

      await routes.handleCallback(req, res);

      // Should redirect to OAuth flow, not return an error
      assert.strictEqual(res.redirectUrl, '/auth/github');
      assert.strictEqual(res.statusCode, 200); // No error status set
      assert.strictEqual(res.jsonData, null); // No error JSON
    });

    it('redirects to OAuth flow for GitHub App update callback', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        query: {
          code: 'auth-code',
          installation_id: '12345678',
          setup_action: 'update',
        },
        signedCookies: {},
      });
      const res = createMockResponse();

      await routes.handleCallback(req, res);

      assert.strictEqual(res.redirectUrl, '/auth/github');
    });

    it('returns error when state is missing', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        query: { code: 'auth-code' },
        signedCookies: { github_oauth_state: 'expected-state' },
      });
      const res = createMockResponse();

      await routes.handleCallback(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.ok((res.jsonData as { error: string }).error.includes('state'));
    });

    it('returns error when state does not match', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        query: { code: 'auth-code', state: 'wrong-state' },
        signedCookies: { github_oauth_state: 'expected-state' },
      });
      const res = createMockResponse();

      await routes.handleCallback(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.ok((res.jsonData as { error: string }).error.includes('state'));
    });

    it('returns error when code is missing', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        query: { state: 'valid-state' },
        signedCookies: { github_oauth_state: 'valid-state' },
      });
      const res = createMockResponse();

      await routes.handleCallback(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.ok((res.jsonData as { error: string }).error.includes('code'));
    });
  });

  describe('GET /auth/me', () => {
    it('returns user info when authenticated', async () => {
      const routes = createGitHubAuthRoutes(config);
      const token = config.jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Create the user in repository
      const user = createUser({
        id: 'user-123',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_test',
        refreshToken: 'ghr_test',
        tokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        name: 'Test User',
      });
      await mockUserRepo.save(user);

      const req = createMockRequest({
        signedCookies: { github_session: token },
      });
      const res = createMockResponse();

      await routes.getCurrentUser(req, res);

      assert.strictEqual(res.statusCode, 200);
      const data = res.jsonData as { user: { id: string; login: string } };
      assert.ok(data.user);
      assert.strictEqual(data.user.id, 'user-123');
      assert.strictEqual(data.user.login, 'testuser');
    });

    it('returns 401 when not authenticated', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.getCurrentUser(req, res);

      assert.strictEqual(res.statusCode, 401);
    });

    it('returns 401 when token is invalid', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest({
        signedCookies: { github_session: 'invalid.token' },
      });
      const res = createMockResponse();

      await routes.getCurrentUser(req, res);

      assert.strictEqual(res.statusCode, 401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears session cookie', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.logout(req, res);

      assert.ok(res.cookiesCleared.includes('github_session'));
    });

    it('redirects to home page', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.logout(req, res);

      assert.strictEqual(res.redirectUrl, '/');
    });
  });

  describe('GET /auth/github/installation', () => {
    it('returns GitHub App installation URL', async () => {
      const routes = createGitHubAuthRoutes(config);
      const req = createMockRequest();
      const res = createMockResponse();

      await routes.getInstallationUrl(req, res);

      assert.strictEqual(res.statusCode, 200);
      const data = res.jsonData as { url: string };
      assert.ok(data.url);
      assert.ok(data.url.includes('github.com/apps/test-app/installations'));
    });
  });
});
