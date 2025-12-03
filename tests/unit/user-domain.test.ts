/**
 * Unit tests for User domain types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createUser,
  updateUserTokens,
  isTokenExpired,
  type User,
  type GitHubTokens,
} from '../../src/domain/user.js';

describe('User Domain', () => {
  describe('createUser', () => {
    it('creates a user with GitHub profile data', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: new Date('2024-01-01T08:00:00Z'),
      });

      assert.strictEqual(user.id, 'user-1');
      assert.strictEqual(user.githubId, 12345);
      assert.strictEqual(user.login, 'testuser');
      assert.strictEqual(user.avatarUrl, 'https://avatars.githubusercontent.com/u/12345');
      assert.strictEqual(user.accessToken, 'ghu_abc123');
      assert.strictEqual(user.refreshToken, 'ghr_xyz789');
      assert.strictEqual(user.tokenExpiresAt.toISOString(), '2024-01-01T08:00:00.000Z');
      assert.ok(user.createdAt instanceof Date);
      assert.ok(user.lastLoginAt instanceof Date);
    });

    it('sets createdAt and lastLoginAt to the same time on creation', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: new Date(),
      });

      assert.strictEqual(
        user.createdAt.getTime(),
        user.lastLoginAt.getTime()
      );
    });

    it('handles optional name and email', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: new Date(),
        name: 'Test User',
        email: 'test@example.com',
      });

      assert.strictEqual(user.name, 'Test User');
      assert.strictEqual(user.email, 'test@example.com');
    });
  });

  describe('updateUserTokens', () => {
    it('updates tokens and expiry', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_old',
        refreshToken: 'ghr_old',
        tokenExpiresAt: new Date('2024-01-01T00:00:00Z'),
      });

      const newExpiry = new Date('2024-01-01T08:00:00Z');
      const updated = updateUserTokens(user, {
        accessToken: 'ghu_new',
        refreshToken: 'ghr_new',
        tokenExpiresAt: newExpiry,
      });

      assert.strictEqual(updated.accessToken, 'ghu_new');
      assert.strictEqual(updated.refreshToken, 'ghr_new');
      assert.strictEqual(updated.tokenExpiresAt.toISOString(), newExpiry.toISOString());
    });

    it('updates lastLoginAt timestamp', async () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_old',
        refreshToken: 'ghr_old',
        tokenExpiresAt: new Date(),
      });

      const originalLastLogin = user.lastLoginAt;

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = updateUserTokens(user, {
        accessToken: 'ghu_new',
        refreshToken: 'ghr_new',
        tokenExpiresAt: new Date(),
      });

      assert.ok(updated.lastLoginAt.getTime() >= originalLastLogin.getTime());
    });

    it('does not mutate the original user', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_old',
        refreshToken: 'ghr_old',
        tokenExpiresAt: new Date(),
      });

      updateUserTokens(user, {
        accessToken: 'ghu_new',
        refreshToken: 'ghr_new',
        tokenExpiresAt: new Date(),
      });

      // Original should be unchanged
      assert.strictEqual(user.accessToken, 'ghu_old');
      assert.strictEqual(user.refreshToken, 'ghr_old');
    });

    it('preserves other user properties', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_old',
        refreshToken: 'ghr_old',
        tokenExpiresAt: new Date(),
        name: 'Test User',
        email: 'test@example.com',
      });

      const updated = updateUserTokens(user, {
        accessToken: 'ghu_new',
        refreshToken: 'ghr_new',
        tokenExpiresAt: new Date(),
      });

      assert.strictEqual(updated.id, 'user-1');
      assert.strictEqual(updated.githubId, 12345);
      assert.strictEqual(updated.login, 'testuser');
      assert.strictEqual(updated.name, 'Test User');
      assert.strictEqual(updated.email, 'test@example.com');
    });
  });

  describe('isTokenExpired', () => {
    it('returns true for expired tokens', () => {
      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: new Date('2020-01-01T00:00:00Z'), // Past date
      });

      assert.strictEqual(isTokenExpired(user), true);
    });

    it('returns false for valid tokens', () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 8); // 8 hours from now

      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: futureDate,
      });

      assert.strictEqual(isTokenExpired(user), false);
    });

    it('returns true when token expires within buffer period', () => {
      const almostExpired = new Date();
      almostExpired.setMinutes(almostExpired.getMinutes() + 2); // Only 2 minutes left

      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: almostExpired,
      });

      // With 5-minute buffer, 2 minutes left should be considered expired
      assert.strictEqual(isTokenExpired(user, 5 * 60 * 1000), true);
    });

    it('uses default buffer of 5 minutes', () => {
      const almostExpired = new Date();
      almostExpired.setMinutes(almostExpired.getMinutes() + 4); // 4 minutes left

      const user = createUser({
        id: 'user-1',
        githubId: 12345,
        login: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        accessToken: 'ghu_abc123',
        refreshToken: 'ghr_xyz789',
        tokenExpiresAt: almostExpired,
      });

      // Default 5-minute buffer means 4 minutes left is expired
      assert.strictEqual(isTokenExpired(user), true);
    });
  });
});
