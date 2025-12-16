/**
 * Unit tests for ConflictRepository implementations.
 * Tests that both MongoDB and file-based repos handle conflict resolution status correctly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRepositories, type RepositoryConnection } from '../../src/repositories/index.js';
import { createConflict, type Conflict, type ConflictResolution } from '../../src/domain/conflict.js';

describe('ConflictRepository', () => {
  let connection: RepositoryConnection;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'conflict-repo-test-'));
    connection = await createRepositories({ fileBasePath: tempDir });
  });

  afterEach(async () => {
    await connection.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a test conflict.
   */
  function createTestConflict(overrides: Partial<{
    id: string;
    wikiId: string;
    pagePath: string;
  }> = {}): Conflict {
    return createConflict({
      id: overrides.id ?? uuid(),
      wikiId: overrides.wikiId ?? 'wiki-1',
      pagePath: overrides.pagePath ?? 'test-page.md',
      type: 'factual',
      description: 'Test conflict',
      assertions: [
        {
          content: 'Assertion 1',
          sourceCommitId: 'commit-1',
          assertedAt: new Date('2024-01-01'),
          agentRunId: 'run-1',
        },
        {
          content: 'Assertion 2',
          sourceCommitId: 'commit-2',
          assertedAt: new Date('2024-01-02'),
          agentRunId: 'run-2',
        },
      ],
    });
  }

  describe('resolve()', () => {
    it('sets status to "manual" when resolution method is "manual"', async () => {
      const repo = connection.repositories.conflicts;
      const conflict = createTestConflict({ id: 'conflict-1' });
      await repo.save(conflict);

      const resolution: ConflictResolution = {
        winningAssertionIndex: 0,
        reason: 'Manual selection',
        method: 'manual',
      };

      await repo.resolve('conflict-1', resolution);

      const resolved = await repo.findById('conflict-1');
      assert.ok(resolved, 'Conflict should exist');
      assert.strictEqual(resolved.status, 'manual', 'Status should be "manual" for manual resolution');
      assert.deepStrictEqual(resolved.resolution, resolution);
      assert.ok(resolved.resolvedAt instanceof Date, 'resolvedAt should be set');
    });

    it('sets status to "auto-resolved" when resolution method is "timestamp"', async () => {
      const repo = connection.repositories.conflicts;
      const conflict = createTestConflict({ id: 'conflict-2' });
      await repo.save(conflict);

      const resolution: ConflictResolution = {
        winningAssertionIndex: 1,
        reason: 'Most recent wins',
        method: 'timestamp',
      };

      await repo.resolve('conflict-2', resolution);

      const resolved = await repo.findById('conflict-2');
      assert.ok(resolved, 'Conflict should exist');
      assert.strictEqual(resolved.status, 'auto-resolved', 'Status should be "auto-resolved" for timestamp resolution');
      assert.deepStrictEqual(resolved.resolution, resolution);
      assert.ok(resolved.resolvedAt instanceof Date, 'resolvedAt should be set');
    });

    it('sets status to "auto-resolved" when resolution method is "confidence"', async () => {
      const repo = connection.repositories.conflicts;
      const conflict = createTestConflict({ id: 'conflict-3' });
      await repo.save(conflict);

      const resolution: ConflictResolution = {
        winningAssertionIndex: 0,
        reason: 'Higher confidence score',
        method: 'confidence',
      };

      await repo.resolve('conflict-3', resolution);

      const resolved = await repo.findById('conflict-3');
      assert.ok(resolved, 'Conflict should exist');
      assert.strictEqual(resolved.status, 'auto-resolved', 'Status should be "auto-resolved" for confidence resolution');
      assert.deepStrictEqual(resolved.resolution, resolution);
      assert.ok(resolved.resolvedAt instanceof Date, 'resolvedAt should be set');
    });

    it('updates existing conflict when resolved', async () => {
      const repo = connection.repositories.conflicts;
      const conflict = createTestConflict({ id: 'conflict-4' });
      await repo.save(conflict);

      // Verify initial state
      const initial = await repo.findById('conflict-4');
      assert.ok(initial);
      assert.strictEqual(initial.status, 'open');
      assert.strictEqual(initial.resolution, null);
      assert.strictEqual(initial.resolvedAt, null);

      // Resolve the conflict
      const resolution: ConflictResolution = {
        winningAssertionIndex: 1,
        reason: 'Timestamp wins',
        method: 'timestamp',
      };
      await repo.resolve('conflict-4', resolution);

      // Verify it was updated
      const resolved = await repo.findById('conflict-4');
      assert.ok(resolved);
      assert.strictEqual(resolved.status, 'auto-resolved');
      assert.deepStrictEqual(resolved.resolution, resolution);
      assert.ok(resolved.resolvedAt instanceof Date);
    });
  });

  describe('countByStatus()', () => {
    it('counts conflicts by status including resolved conflicts', async () => {
      const repo = connection.repositories.conflicts;
      const wikiId = 'wiki-test';

      // Create conflicts with different statuses
      const openConflict = createTestConflict({ wikiId });
      await repo.save(openConflict);

      const manualConflict = createTestConflict({ wikiId });
      await repo.save(manualConflict);
      await repo.resolve(manualConflict.id, {
        winningAssertionIndex: 0,
        reason: 'Manual',
        method: 'manual',
      });

      const autoConflict = createTestConflict({ wikiId });
      await repo.save(autoConflict);
      await repo.resolve(autoConflict.id, {
        winningAssertionIndex: 0,
        reason: 'Auto',
        method: 'timestamp',
      });

      const counts = await repo.countByStatus(wikiId);
      assert.strictEqual(counts.open, 1, 'Should have 1 open conflict');
      assert.strictEqual(counts.manual, 1, 'Should have 1 manual conflict');
      assert.strictEqual(counts['auto-resolved'], 1, 'Should have 1 auto-resolved conflict');
      assert.strictEqual(counts.deferred, 0, 'Should have 0 deferred conflicts');
    });
  });
});
