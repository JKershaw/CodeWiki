/**
 * Unit tests for EditSource domain model.
 * Tests the polymorphic edit source abstraction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createCommitEditSource,
  createStoryEditSource,
  createManualEditSource,
  isCommitEditSource,
  isStoryEditSource,
  isManualEditSource,
  getEditSourceTimestamp,
  type EditSource,
} from '../../src/domain/edit-source.js';

describe('EditSource', () => {
  describe('createCommitEditSource', () => {
    it('creates a commit edit source with correct type', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createCommitEditSource('abc123', timestamp);

      assert.strictEqual(source.type, 'commit');
      assert.strictEqual(source.commitSha, 'abc123');
      assert.strictEqual(source.commitTimestamp.getTime(), timestamp.getTime());
    });
  });

  describe('createStoryEditSource', () => {
    it('creates a story edit source with correct type', () => {
      const source = createStoryEditSource('story-1', 'write');

      assert.strictEqual(source.type, 'story');
      assert.strictEqual(source.storyId, 'story-1');
      assert.strictEqual(source.phase, 'write');
      assert.ok(source.timestamp instanceof Date);
    });

    it('accepts custom timestamp', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createStoryEditSource('story-1', 'learn', timestamp);

      assert.strictEqual(source.timestamp.getTime(), timestamp.getTime());
    });
  });

  describe('createManualEditSource', () => {
    it('creates a manual edit source with correct type', () => {
      const source = createManualEditSource('user-123', 'Fix typo');

      assert.strictEqual(source.type, 'manual');
      assert.strictEqual(source.userId, 'user-123');
      assert.strictEqual(source.reason, 'Fix typo');
      assert.ok(source.timestamp instanceof Date);
    });

    it('handles optional fields', () => {
      const source = createManualEditSource();

      assert.strictEqual(source.type, 'manual');
      assert.strictEqual(source.userId, undefined);
      assert.strictEqual(source.reason, undefined);
    });
  });

  describe('type guards', () => {
    it('isCommitEditSource returns true for commit sources', () => {
      const source = createCommitEditSource('abc', new Date());
      assert.strictEqual(isCommitEditSource(source), true);
      assert.strictEqual(isStoryEditSource(source), false);
      assert.strictEqual(isManualEditSource(source), false);
    });

    it('isStoryEditSource returns true for story sources', () => {
      const source = createStoryEditSource('s1', 'write');
      assert.strictEqual(isCommitEditSource(source), false);
      assert.strictEqual(isStoryEditSource(source), true);
      assert.strictEqual(isManualEditSource(source), false);
    });

    it('isManualEditSource returns true for manual sources', () => {
      const source = createManualEditSource();
      assert.strictEqual(isCommitEditSource(source), false);
      assert.strictEqual(isStoryEditSource(source), false);
      assert.strictEqual(isManualEditSource(source), true);
    });
  });

  describe('getEditSourceTimestamp', () => {
    it('returns commitTimestamp for commit sources', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createCommitEditSource('abc', timestamp);
      assert.strictEqual(getEditSourceTimestamp(source).getTime(), timestamp.getTime());
    });

    it('returns timestamp for story sources', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createStoryEditSource('s1', 'write', timestamp);
      assert.strictEqual(getEditSourceTimestamp(source).getTime(), timestamp.getTime());
    });

    it('returns timestamp for manual sources', () => {
      const before = Date.now();
      const source = createManualEditSource();
      const after = Date.now();

      const ts = getEditSourceTimestamp(source);
      assert.ok(ts.getTime() >= before);
      assert.ok(ts.getTime() <= after);
    });
  });
});
