/**
 * Unit tests for GitHub authentication middleware.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Request, Response, NextFunction } from 'express';
import {
  createGitHubAuthMiddleware,
  type GitHubAuthMiddleware,
  type AuthenticatedRequest,
} from '../../src/web/middleware/github-auth.js';
import { createJwtService } from '../../src/services/auth/jwt-service.js';

describe('GitHub Auth Middleware', () => {
  const testSecret = 'test-secret-for-middleware';
  let jwtService: ReturnType<typeof createJwtService>;
  let middleware: GitHubAuthMiddleware;

  beforeEach(() => {
    jwtService = createJwtService(testSecret);
    middleware = createGitHubAuthMiddleware(jwtService);
  });

  /**
   * Create a mock request with optional signed cookies.
   */
  function createMockRequest(cookies: Record<string, string> = {}): Request {
    return {
      signedCookies: cookies,
      cookies: {},
      path: '/test',
    } as unknown as Request;
  }

  /**
   * Create a mock response with tracking for calls.
   */
  function createMockResponse(): Response & { statusCode: number; jsonData: unknown } {
    const res = {
      statusCode: 200,
      jsonData: null as unknown,
      status: function(code: number) {
        this.statusCode = code;
        return this;
      },
      json: function(data: unknown) {
        this.jsonData = data;
        return this;
      },
    } as unknown as Response & { statusCode: number; jsonData: unknown };
    return res;
  }

  describe('optionalAuth', () => {
    it('attaches user info when valid token is present', async () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const req = createMockRequest({ github_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.ok(authReq.user);
      assert.strictEqual(authReq.user.userId, 'user-123');
      assert.strictEqual(authReq.user.githubLogin, 'testuser');
    });

    it('continues without user when no token is present', async () => {
      const req = createMockRequest({});
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.strictEqual(authReq.user, undefined);
    });

    it('continues without user when token is invalid', async () => {
      const req = createMockRequest({ github_session: 'invalid.token.here' });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.strictEqual(authReq.user, undefined);
    });

    it('continues without user when token is expired', async () => {
      const shortExpiryJwt = createJwtService(testSecret, { expiresIn: '1s' });
      const token = shortExpiryJwt.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const req = createMockRequest({ github_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.strictEqual(authReq.user, undefined);
    });
  });

  describe('requireAuth', () => {
    it('allows request when valid token is present', async () => {
      const token = jwtService.createSessionToken({
        userId: 'user-456',
        githubLogin: 'authuser',
      });

      const req = createMockRequest({ github_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.requireAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.ok(authReq.user);
      assert.strictEqual(authReq.user.userId, 'user-456');
    });

    it('returns 401 when no token is present', async () => {
      const req = createMockRequest({});
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.requireAuth(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
      assert.ok(res.jsonData);
      assert.strictEqual((res.jsonData as { error: string }).error, 'Authentication required');
    });

    it('returns 401 when token is invalid', async () => {
      const req = createMockRequest({ github_session: 'bad.token' });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.requireAuth(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });

    it('returns 401 when token is expired', async () => {
      const shortExpiryJwt = createJwtService(testSecret, { expiresIn: '1s' });
      const token = shortExpiryJwt.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const req = createMockRequest({ github_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.requireAuth(req, res, next);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });
  });

  describe('cookie name configuration', () => {
    it('uses custom cookie name when provided', async () => {
      const customMiddleware = createGitHubAuthMiddleware(jwtService, {
        cookieName: 'custom_session',
      });

      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const req = createMockRequest({ custom_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await customMiddleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.ok(authReq.user);
      assert.strictEqual(authReq.user.userId, 'user-123');
    });

    it('defaults to github_session cookie name', async () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Should find token in github_session
      const req = createMockRequest({ github_session: token });
      const res = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };

      await middleware.optionalAuth(req, res, next);

      assert.ok(nextCalled);
      const authReq = req as AuthenticatedRequest;
      assert.ok(authReq.user);
    });
  });
});
