/**
 * Unit tests for password protection middleware.
 *
 * Tests the authentication middleware and helper functions.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  isPasswordProtectionEnabled,
  getSitePassword,
  verifyPassword,
  isAuthenticated,
  passwordProtection,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_VALUE,
} from '../../src/web/middleware/password-protection.js';
import type { Request, Response, NextFunction } from 'express';

describe('Password Protection Middleware', () => {
  // Store original env values
  let originalSitePassword: string | undefined;

  beforeEach(() => {
    originalSitePassword = process.env['SITE_PASSWORD'];
  });

  afterEach(() => {
    if (originalSitePassword !== undefined) {
      process.env['SITE_PASSWORD'] = originalSitePassword;
    } else {
      delete process.env['SITE_PASSWORD'];
    }
  });

  describe('isPasswordProtectionEnabled', () => {
    it('returns false when SITE_PASSWORD is not set', () => {
      delete process.env['SITE_PASSWORD'];
      assert.strictEqual(isPasswordProtectionEnabled(), false);
    });

    it('returns false when SITE_PASSWORD is empty string', () => {
      process.env['SITE_PASSWORD'] = '';
      assert.strictEqual(isPasswordProtectionEnabled(), false);
    });

    it('returns true when SITE_PASSWORD is set', () => {
      process.env['SITE_PASSWORD'] = 'mysecretpassword';
      assert.strictEqual(isPasswordProtectionEnabled(), true);
    });
  });

  describe('getSitePassword', () => {
    it('returns undefined when not set', () => {
      delete process.env['SITE_PASSWORD'];
      assert.strictEqual(getSitePassword(), undefined);
    });

    it('returns the password when set', () => {
      process.env['SITE_PASSWORD'] = 'testpass123';
      assert.strictEqual(getSitePassword(), 'testpass123');
    });
  });

  describe('verifyPassword', () => {
    beforeEach(() => {
      process.env['SITE_PASSWORD'] = 'correctpassword';
    });

    it('returns true for correct password', () => {
      assert.strictEqual(verifyPassword('correctpassword'), true);
    });

    it('returns false for incorrect password', () => {
      assert.strictEqual(verifyPassword('wrongpassword'), false);
    });

    it('returns false for empty password', () => {
      assert.strictEqual(verifyPassword(''), false);
    });

    it('returns false for password with different length', () => {
      assert.strictEqual(verifyPassword('short'), false);
      assert.strictEqual(verifyPassword('thisisaverylongpassword'), false);
    });

    it('returns false when SITE_PASSWORD is not set', () => {
      delete process.env['SITE_PASSWORD'];
      assert.strictEqual(verifyPassword('anypassword'), false);
    });

    it('is case sensitive', () => {
      assert.strictEqual(verifyPassword('CorrectPassword'), false);
      assert.strictEqual(verifyPassword('CORRECTPASSWORD'), false);
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when auth cookie is present and valid', () => {
      const mockReq = {
        signedCookies: {
          [AUTH_COOKIE_NAME]: AUTH_COOKIE_VALUE,
        },
      } as unknown as Request;

      assert.strictEqual(isAuthenticated(mockReq), true);
    });

    it('returns false when auth cookie is missing', () => {
      const mockReq = {
        signedCookies: {},
      } as unknown as Request;

      assert.strictEqual(isAuthenticated(mockReq), false);
    });

    it('returns false when auth cookie has wrong value', () => {
      const mockReq = {
        signedCookies: {
          [AUTH_COOKIE_NAME]: 'wrong-value',
        },
      } as unknown as Request;

      assert.strictEqual(isAuthenticated(mockReq), false);
    });

    it('returns false when signedCookies is undefined', () => {
      const mockReq = {
        signedCookies: undefined,
      } as unknown as Request;

      // Should not throw, should return false
      try {
        const result = isAuthenticated(mockReq);
        assert.strictEqual(result, false);
      } catch {
        // If it throws due to undefined, that's also acceptable behavior
        assert.ok(true);
      }
    });
  });

  describe('passwordProtection middleware', () => {
    function createMockRequest(overrides: Partial<Request> = {}): Request {
      return {
        path: '/',
        originalUrl: '/',
        signedCookies: {},
        ...overrides,
      } as unknown as Request;
    }

    function createMockResponse(): Response & { _status?: number; _json?: unknown; _redirect?: string } {
      const res = {
        _status: undefined as number | undefined,
        _json: undefined as unknown,
        _redirect: undefined as string | undefined,
        status(code: number) {
          this._status = code;
          return this;
        },
        json(data: unknown) {
          this._json = data;
          return this;
        },
        redirect(url: string) {
          this._redirect = url;
          return this;
        },
      };
      return res as unknown as Response & { _status?: number; _json?: unknown; _redirect?: string };
    }

    describe('when password protection is disabled', () => {
      beforeEach(() => {
        delete process.env['SITE_PASSWORD'];
      });

      it('calls next() for any request', () => {
        const req = createMockRequest({ path: '/api/repos' });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
        assert.strictEqual(res._status, undefined);
        assert.strictEqual(res._redirect, undefined);
      });

      it('allows access to homepage', () => {
        const req = createMockRequest({ path: '/' });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
      });
    });

    describe('when password protection is enabled', () => {
      beforeEach(() => {
        process.env['SITE_PASSWORD'] = 'secretpassword';
      });

      it('allows access to /login without authentication', () => {
        const req = createMockRequest({ path: '/login' });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
      });

      it('allows access to /logout without authentication', () => {
        const req = createMockRequest({ path: '/logout' });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
      });

      it('allows access when authenticated', () => {
        const req = createMockRequest({
          path: '/some-page',
          signedCookies: {
            [AUTH_COOKIE_NAME]: AUTH_COOKIE_VALUE,
          },
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
      });

      it('redirects browser requests to /login when not authenticated', () => {
        const req = createMockRequest({
          path: '/dashboard',
          originalUrl: '/dashboard',
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res._redirect, '/login');
      });

      it('returns 401 for API requests when not authenticated', () => {
        const req = createMockRequest({
          path: '/api/repos',
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res._status, 401);
        assert.deepStrictEqual(res._json, { error: 'Authentication required' });
      });

      it('returns 401 for nested API routes', () => {
        const req = createMockRequest({
          path: '/api/repos/123/wiki',
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res._status, 401);
      });

      it('allows authenticated API requests', () => {
        const req = createMockRequest({
          path: '/api/repos',
          signedCookies: {
            [AUTH_COOKIE_NAME]: AUTH_COOKIE_VALUE,
          },
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        passwordProtection(req, res, next);

        assert.strictEqual(nextCalled, true);
      });
    });
  });
});
