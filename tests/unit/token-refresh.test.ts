/**
 * Unit tests for GitHub token refresh utility.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  ensureValidToken,
  TokenRefreshError,
} from '../../src/services/github/token-refresh.js';
import { createUser, type User } from '../../src/domain/user.js';
import type { GitHubAuthService } from '../../src/services/github/github-auth-service.js';
import type { UserRepository } from '../../src/repositories/interfaces/user-repository.js';

describe('Token Refresh Utility', () => {
  let mockGithubAuth: GitHubAuthService;
  let mockUserRepository: UserRepository;
  let validUser: User;
  let expiredUser: User;

  beforeEach(() => {
    // Create a valid user (token expires in 8 hours)
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 8);

    validUser = createUser({
      id: 'user-1',
      githubId: 12345,
      login: 'testuser',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
      accessToken: 'ghu_valid_token',
      refreshToken: 'ghr_refresh_token',
      tokenExpiresAt: futureDate,
    });

    // Create an expired user (token expired 1 hour ago)
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);

    expiredUser = createUser({
      id: 'user-2',
      githubId: 67890,
      login: 'expireduser',
      avatarUrl: 'https://avatars.githubusercontent.com/u/67890',
      accessToken: 'ghu_expired_token',
      refreshToken: 'ghr_refresh_token',
      tokenExpiresAt: pastDate,
    });

    // Mock GitHub auth service
    mockGithubAuth = {
      getAuthorizationUrl: mock.fn(() => ''),
      getInstallationUrl: mock.fn(() => ''),
      exchangeCodeForTokens: mock.fn(async () => ({
        accessToken: 'ghu_new',
        refreshToken: 'ghr_new',
        expiresAt: new Date(),
      })),
      refreshAccessToken: mock.fn(async () => {
        const newExpiry = new Date();
        newExpiry.setHours(newExpiry.getHours() + 8);
        return {
          accessToken: 'ghu_refreshed_token',
          refreshToken: 'ghr_new_refresh_token',
          expiresAt: newExpiry,
        };
      }),
      getUserProfile: mock.fn(async () => ({
        id: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
      })),
      getAccessibleRepos: mock.fn(async () => []),
      generateState: mock.fn(() => 'random-state'),
    };

    // Mock user repository
    mockUserRepository = {
      findById: mock.fn(async () => null),
      findByGitHubId: mock.fn(async () => null),
      findByLogin: mock.fn(async () => null),
      findAll: mock.fn(async () => []),
      save: mock.fn(async () => {}),
      updateTokens: mock.fn(async () => {}),
      delete: mock.fn(async () => {}),
    };
  });

  describe('ensureValidToken', () => {
    it('returns existing token when not expired', async () => {
      const result = await ensureValidToken(validUser, mockGithubAuth, mockUserRepository);

      assert.strictEqual(result.accessToken, 'ghu_valid_token');
      assert.strictEqual(result.refreshed, false);
      assert.strictEqual(result.user.id, validUser.id);

      // Should NOT have called refresh
      const refreshCalls = (mockGithubAuth.refreshAccessToken as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(refreshCalls.length, 0);
    });

    it('refreshes token when expired', async () => {
      const result = await ensureValidToken(expiredUser, mockGithubAuth, mockUserRepository);

      assert.strictEqual(result.accessToken, 'ghu_refreshed_token');
      assert.strictEqual(result.refreshed, true);
      assert.strictEqual(result.user.accessToken, 'ghu_refreshed_token');
      assert.strictEqual(result.user.refreshToken, 'ghr_new_refresh_token');

      // Should have called refresh
      const refreshCalls = (mockGithubAuth.refreshAccessToken as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(refreshCalls.length, 1);
      assert.strictEqual(refreshCalls[0].arguments[0], 'ghr_refresh_token');
    });

    it('persists refreshed tokens to repository', async () => {
      await ensureValidToken(expiredUser, mockGithubAuth, mockUserRepository);

      const updateCalls = (mockUserRepository.updateTokens as ReturnType<typeof mock.fn>).mock.calls;
      assert.strictEqual(updateCalls.length, 1);
      assert.strictEqual(updateCalls[0].arguments[0], 'user-2');

      const tokens = updateCalls[0].arguments[1];
      assert.strictEqual(tokens.accessToken, 'ghu_refreshed_token');
      assert.strictEqual(tokens.refreshToken, 'ghr_new_refresh_token');
      assert.ok(tokens.tokenExpiresAt instanceof Date);
    });

    it('throws TokenRefreshError when no refresh token available', async () => {
      const userWithoutRefresh = createUser({
        id: 'user-3',
        githubId: 11111,
        login: 'norefresh',
        avatarUrl: 'https://avatars.githubusercontent.com/u/11111',
        accessToken: 'ghu_expired',
        refreshToken: '', // No refresh token
        tokenExpiresAt: new Date('2020-01-01'),
      });

      await assert.rejects(
        () => ensureValidToken(userWithoutRefresh, mockGithubAuth, mockUserRepository),
        (error: Error) => {
          assert.ok(error instanceof TokenRefreshError);
          assert.ok(error.message.includes('No refresh token'));
          assert.strictEqual((error as TokenRefreshError).requiresReauth, true);
          return true;
        }
      );
    });

    it('throws TokenRefreshError when GitHub refresh fails', async () => {
      mockGithubAuth.refreshAccessToken = mock.fn(async () => {
        throw new Error('bad_refresh_token: The refresh token has expired');
      });

      await assert.rejects(
        () => ensureValidToken(expiredUser, mockGithubAuth, mockUserRepository),
        (error: Error) => {
          assert.ok(error instanceof TokenRefreshError);
          assert.strictEqual((error as TokenRefreshError).requiresReauth, true);
          return true;
        }
      );
    });

    it('considers token expired within 5-minute buffer', async () => {
      // Token expires in 2 minutes (within 5-minute buffer)
      const almostExpired = new Date();
      almostExpired.setMinutes(almostExpired.getMinutes() + 2);

      const almostExpiredUser = createUser({
        id: 'user-4',
        githubId: 22222,
        login: 'almostexpired',
        avatarUrl: 'https://avatars.githubusercontent.com/u/22222',
        accessToken: 'ghu_almost_expired',
        refreshToken: 'ghr_refresh',
        tokenExpiresAt: almostExpired,
      });

      const result = await ensureValidToken(almostExpiredUser, mockGithubAuth, mockUserRepository);

      // Should have refreshed because within buffer
      assert.strictEqual(result.refreshed, true);
      assert.strictEqual(result.accessToken, 'ghu_refreshed_token');
    });

    it('handles concurrent refresh requests for same user', async () => {
      // Create a slow refresh
      let refreshCallCount = 0;
      mockGithubAuth.refreshAccessToken = mock.fn(async () => {
        refreshCallCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        const newExpiry = new Date();
        newExpiry.setHours(newExpiry.getHours() + 8);
        return {
          accessToken: 'ghu_refreshed_token',
          refreshToken: 'ghr_new_refresh_token',
          expiresAt: newExpiry,
        };
      });

      // Start two concurrent refresh requests for the same user
      const [result1, result2] = await Promise.all([
        ensureValidToken(expiredUser, mockGithubAuth, mockUserRepository),
        ensureValidToken(expiredUser, mockGithubAuth, mockUserRepository),
      ]);

      // Both should return the same refreshed token
      assert.strictEqual(result1.accessToken, 'ghu_refreshed_token');
      assert.strictEqual(result2.accessToken, 'ghu_refreshed_token');

      // But refresh should only be called once
      assert.strictEqual(refreshCallCount, 1);
    });
  });

  describe('TokenRefreshError', () => {
    it('has correct properties', () => {
      const error = new TokenRefreshError('Test message', true);

      assert.strictEqual(error.name, 'TokenRefreshError');
      assert.strictEqual(error.message, 'Test message');
      assert.strictEqual(error.requiresReauth, true);
    });

    it('defaults requiresReauth to true', () => {
      const error = new TokenRefreshError('Test message');

      assert.strictEqual(error.requiresReauth, true);
    });

    it('can set requiresReauth to false', () => {
      const error = new TokenRefreshError('Transient error', false);

      assert.strictEqual(error.requiresReauth, false);
    });
  });
});
