/**
 * Unit tests for JWT session service.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createJwtService,
  type JwtService,
  type SessionPayload,
} from '../../src/services/auth/jwt-service.js';

describe('JWT Service', () => {
  let jwtService: JwtService;
  const testSecret = 'test-secret-key-for-testing-purposes-only';

  beforeEach(() => {
    jwtService = createJwtService(testSecret);
  });

  describe('createSessionToken', () => {
    it('creates a valid JWT token', () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      assert.ok(token);
      assert.strictEqual(typeof token, 'string');
      // JWT has 3 parts separated by dots
      assert.strictEqual(token.split('.').length, 3);
    });

    it('creates tokens that can be verified', () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const payload = jwtService.verifySessionToken(token);
      assert.ok(payload);
      assert.strictEqual(payload.userId, 'user-123');
      assert.strictEqual(payload.githubLogin, 'testuser');
    });

    it('includes expiration in the token', () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const payload = jwtService.verifySessionToken(token);
      assert.ok(payload);
      assert.ok(payload.exp);
      // Expiration should be in the future
      assert.ok(payload.exp > Math.floor(Date.now() / 1000));
    });

    it('respects custom expiry time', () => {
      const shortExpiryService = createJwtService(testSecret, { expiresIn: '1h' });
      const token = shortExpiryService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const payload = shortExpiryService.verifySessionToken(token);
      assert.ok(payload);
      // Should expire in about 1 hour (3600 seconds +/- some margin)
      const expiresIn = payload.exp! - Math.floor(Date.now() / 1000);
      assert.ok(expiresIn > 3500 && expiresIn <= 3600, `Expected ~3600 seconds, got ${expiresIn}`);
    });
  });

  describe('verifySessionToken', () => {
    it('returns payload for valid token', () => {
      const token = jwtService.createSessionToken({
        userId: 'user-456',
        githubLogin: 'anotheruser',
      });

      const payload = jwtService.verifySessionToken(token);
      assert.ok(payload);
      assert.strictEqual(payload.userId, 'user-456');
      assert.strictEqual(payload.githubLogin, 'anotheruser');
    });

    it('returns null for invalid token', () => {
      const payload = jwtService.verifySessionToken('invalid.token.here');
      assert.strictEqual(payload, null);
    });

    it('returns null for malformed token', () => {
      const payload = jwtService.verifySessionToken('not-a-jwt');
      assert.strictEqual(payload, null);
    });

    it('returns null for empty token', () => {
      const payload = jwtService.verifySessionToken('');
      assert.strictEqual(payload, null);
    });

    it('returns null for token signed with different secret', () => {
      const otherService = createJwtService('different-secret');
      const token = otherService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Verify with original service (different secret)
      const payload = jwtService.verifySessionToken(token);
      assert.strictEqual(payload, null);
    });

    it('returns null for expired token', async () => {
      // Create service with 1 second expiry (minimum supported)
      const shortExpiryService = createJwtService(testSecret, { expiresIn: '1s' });
      const token = shortExpiryService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Wait for token to expire (slightly over 1 second)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const payload = shortExpiryService.verifySessionToken(token);
      assert.strictEqual(payload, null);
    });
  });

  describe('refreshSessionToken', () => {
    it('creates a new valid token with same user data', () => {
      const originalToken = jwtService.createSessionToken({
        userId: 'user-789',
        githubLogin: 'refreshuser',
      });

      const newToken = jwtService.refreshSessionToken(originalToken);
      assert.ok(newToken);
      assert.strictEqual(typeof newToken, 'string');

      const payload = jwtService.verifySessionToken(newToken!);
      assert.ok(payload);
      assert.strictEqual(payload.userId, 'user-789');
      assert.strictEqual(payload.githubLogin, 'refreshuser');
    });

    it('returns new token with fresh expiration', async () => {
      const originalToken = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const originalPayload = jwtService.verifySessionToken(originalToken);

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 50));

      const newToken = jwtService.refreshSessionToken(originalToken);
      const newPayload = jwtService.verifySessionToken(newToken!);

      assert.ok(originalPayload);
      assert.ok(newPayload);
      // New token should have same or later expiration
      assert.ok(newPayload.exp! >= originalPayload.exp!);
    });

    it('returns null for invalid token', () => {
      const newToken = jwtService.refreshSessionToken('invalid.token');
      assert.strictEqual(newToken, null);
    });

    it('returns null for expired token', async () => {
      // Create service with 1 second expiry (minimum supported)
      const shortExpiryService = createJwtService(testSecret, { expiresIn: '1s' });
      const token = shortExpiryService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Wait for token to expire (slightly over 1 second)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const newToken = shortExpiryService.refreshSessionToken(token);
      assert.strictEqual(newToken, null);
    });
  });

  describe('decodeToken (without verification)', () => {
    it('decodes token payload without verifying signature', () => {
      const token = jwtService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      const payload = jwtService.decodeToken(token);
      assert.ok(payload);
      assert.strictEqual(payload.userId, 'user-123');
      assert.strictEqual(payload.githubLogin, 'testuser');
    });

    it('decodes token even with wrong secret', () => {
      const otherService = createJwtService('different-secret');
      const token = otherService.createSessionToken({
        userId: 'user-123',
        githubLogin: 'testuser',
      });

      // Decode with original service (different secret) - should still work
      const payload = jwtService.decodeToken(token);
      assert.ok(payload);
      assert.strictEqual(payload.userId, 'user-123');
    });

    it('returns null for malformed token', () => {
      const payload = jwtService.decodeToken('not-a-jwt');
      assert.strictEqual(payload, null);
    });
  });
});
