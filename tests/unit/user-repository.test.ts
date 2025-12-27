/**
 * Unit tests for UserRepository.
 * Tests user storage, querying, and token management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection } from '../../src/repositories/index.js';
import type { UserRepository } from '../../src/repositories/interfaces/user-repository.js';
import { createUser, type User } from '../../src/domain/user.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('UserRepository', () => {
  let repo: UserRepository;
  let tempDir: string;
  let connection: RepositoryConnection;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'user-repo-test-'));
    connection = await createRepositories({ fileBasePath: tempDir });
    repo = connection.repositories.users;
  });

  afterEach(async () => {
    await connection.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a user with sensible defaults.
   */
  function createTestUser(overrides: Partial<{
    id: string;
    githubId: number;
    login: string;
    avatarUrl: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
    name: string;
    email: string;
  }> = {}): User {
    return createUser({
      id: overrides.id ?? uuid(),
      githubId: overrides.githubId ?? Math.floor(Math.random() * 1000000),
      login: overrides.login ?? 'testuser',
      avatarUrl: overrides.avatarUrl ?? 'https://avatars.githubusercontent.com/u/12345',
      accessToken: overrides.accessToken ?? 'ghu_test123',
      refreshToken: overrides.refreshToken ?? 'ghr_test456',
      tokenExpiresAt: overrides.tokenExpiresAt ?? new Date(Date.now() + 8 * 60 * 60 * 1000),
      name: overrides.name,
      email: overrides.email,
    });
  }

  describe('save and findById', () => {
    it('saves and retrieves a user by id', async () => {
      const user = createTestUser({ id: 'user-1', login: 'testuser' });

      await repo.save(user);
      const retrieved = await repo.findById('user-1');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, 'user-1');
      assert.strictEqual(retrieved.login, 'testuser');
    });

    it('returns null for non-existent user', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });

    it('preserves date objects after retrieval', async () => {
      const user = createTestUser();

      await repo.save(user);
      const retrieved = await repo.findById(user.id);

      assert.ok(retrieved);
      assert.ok(retrieved.createdAt instanceof Date);
      assert.ok(retrieved.lastLoginAt instanceof Date);
      assert.ok(retrieved.tokenExpiresAt instanceof Date);
    });

    it('preserves optional fields', async () => {
      const user = createTestUser({
        name: 'Test User',
        email: 'test@example.com',
      });

      await repo.save(user);
      const retrieved = await repo.findById(user.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.name, 'Test User');
      assert.strictEqual(retrieved.email, 'test@example.com');
    });

    it('updates existing user on save', async () => {
      const user = createTestUser({ id: 'user-1', login: 'original' });
      await repo.save(user);

      const updated = { ...user, login: 'updated' };
      await repo.save(updated);

      const retrieved = await repo.findById('user-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.login, 'updated');
    });
  });

  describe('findByGitHubId', () => {
    it('finds a user by GitHub ID', async () => {
      const user = createTestUser({ githubId: 12345, login: 'githubuser' });

      await repo.save(user);
      const retrieved = await repo.findByGitHubId(12345);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.githubId, 12345);
      assert.strictEqual(retrieved.login, 'githubuser');
    });

    it('returns null for non-existent GitHub ID', async () => {
      const result = await repo.findByGitHubId(99999);
      assert.strictEqual(result, null);
    });

    it('finds correct user when multiple exist', async () => {
      const user1 = createTestUser({ githubId: 11111, login: 'user1' });
      const user2 = createTestUser({ githubId: 22222, login: 'user2' });
      const user3 = createTestUser({ githubId: 33333, login: 'user3' });

      await repo.save(user1);
      await repo.save(user2);
      await repo.save(user3);

      const retrieved = await repo.findByGitHubId(22222);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.login, 'user2');
    });
  });

  describe('findByLogin', () => {
    it('finds a user by GitHub login', async () => {
      const user = createTestUser({ login: 'uniquelogin' });

      await repo.save(user);
      const retrieved = await repo.findByLogin('uniquelogin');

      assert.ok(retrieved);
      assert.strictEqual(retrieved.login, 'uniquelogin');
    });

    it('returns null for non-existent login', async () => {
      const result = await repo.findByLogin('nonexistent');
      assert.strictEqual(result, null);
    });
  });

  describe('updateTokens', () => {
    it('updates user tokens', async () => {
      const user = createTestUser({
        id: 'user-1',
        accessToken: 'old_token',
        refreshToken: 'old_refresh',
      });
      await repo.save(user);

      const newExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await repo.updateTokens('user-1', {
        accessToken: 'new_token',
        refreshToken: 'new_refresh',
        tokenExpiresAt: newExpiry,
      });

      const retrieved = await repo.findById('user-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.accessToken, 'new_token');
      assert.strictEqual(retrieved.refreshToken, 'new_refresh');
    });

    it('updates lastLoginAt when updating tokens', async () => {
      const user = createTestUser({ id: 'user-1' });
      await repo.save(user);

      const originalLastLogin = user.lastLoginAt;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 10));

      await repo.updateTokens('user-1', {
        accessToken: 'new_token',
        refreshToken: 'new_refresh',
        tokenExpiresAt: new Date(),
      });

      const retrieved = await repo.findById('user-1');
      assert.ok(retrieved);
      assert.ok(retrieved.lastLoginAt.getTime() >= originalLastLogin.getTime());
    });

    it('does nothing if user does not exist', async () => {
      // Should not throw
      await repo.updateTokens('nonexistent', {
        accessToken: 'new_token',
        refreshToken: 'new_refresh',
        tokenExpiresAt: new Date(),
      });

      const retrieved = await repo.findById('nonexistent');
      assert.strictEqual(retrieved, null);
    });
  });

  describe('delete', () => {
    it('deletes a user by id', async () => {
      const user = createTestUser({ id: 'user-1' });
      await repo.save(user);

      await repo.delete('user-1');

      const result = await repo.findById('user-1');
      assert.strictEqual(result, null);
    });

    it('does nothing if user does not exist', async () => {
      // Should not throw
      await repo.delete('nonexistent');
    });
  });

  describe('findAll', () => {
    it('returns all users', async () => {
      const user1 = createTestUser({ login: 'user1' });
      const user2 = createTestUser({ login: 'user2' });
      const user3 = createTestUser({ login: 'user3' });

      await repo.save(user1);
      await repo.save(user2);
      await repo.save(user3);

      const users = await repo.findAll();
      assert.strictEqual(users.length, 3);
    });

    it('returns empty array when no users', async () => {
      const users = await repo.findAll();
      assert.deepStrictEqual(users, []);
    });

    it('sorts by createdAt descending (newest first)', async () => {
      const older = createTestUser({ login: 'older' });
      const newer = createTestUser({ login: 'newer' });

      older.createdAt = new Date('2024-01-01T10:00:00Z');
      newer.createdAt = new Date('2024-01-15T10:00:00Z');

      await repo.save(older);
      await repo.save(newer);

      const users = await repo.findAll();
      assert.strictEqual(users.length, 2);
      assert.strictEqual(users[0]!.login, 'newer');
      assert.strictEqual(users[1]!.login, 'older');
    });
  });
});
