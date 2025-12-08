/**
 * Unit tests for WorkTarget domain model.
 * Tests the polymorphic work target abstraction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createCommitTarget,
  createPathTarget,
  createWikiTarget,
  isCommitTarget,
  isPathTarget,
  isWikiTarget,
  getWorkTargetKey,
  type WorkTarget,
} from '../../src/domain/work-target.js';

describe('WorkTarget', () => {
  describe('createCommitTarget', () => {
    it('creates a commit target with the correct type', () => {
      const target = createCommitTarget('abc123');
      assert.strictEqual(target.type, 'commit');
      assert.strictEqual(target.commitId, 'abc123');
    });
  });

  describe('createPathTarget', () => {
    it('creates a path target with the correct type', () => {
      const target = createPathTarget('src/services/llm');
      assert.strictEqual(target.type, 'path');
      assert.strictEqual(target.path, 'src/services/llm');
    });
  });

  describe('createWikiTarget', () => {
    it('creates a wiki target with the correct type', () => {
      const target = createWikiTarget();
      assert.strictEqual(target.type, 'wiki');
    });
  });

  describe('type guards', () => {
    it('isCommitTarget returns true for commit targets', () => {
      const target = createCommitTarget('abc123');
      assert.strictEqual(isCommitTarget(target), true);
      assert.strictEqual(isPathTarget(target), false);
      assert.strictEqual(isWikiTarget(target), false);
    });

    it('isPathTarget returns true for path targets', () => {
      const target = createPathTarget('src/foo');
      assert.strictEqual(isCommitTarget(target), false);
      assert.strictEqual(isPathTarget(target), true);
      assert.strictEqual(isWikiTarget(target), false);
    });

    it('isWikiTarget returns true for wiki targets', () => {
      const target = createWikiTarget();
      assert.strictEqual(isCommitTarget(target), false);
      assert.strictEqual(isPathTarget(target), false);
      assert.strictEqual(isWikiTarget(target), true);
    });
  });

  describe('getWorkTargetKey', () => {
    it('returns commit:sha for commit targets', () => {
      const target = createCommitTarget('abc123def');
      assert.strictEqual(getWorkTargetKey(target), 'commit:abc123def');
    });

    it('returns path:dir for path targets', () => {
      const target = createPathTarget('src/services/llm');
      assert.strictEqual(getWorkTargetKey(target), 'path:src/services/llm');
    });

    it('returns wiki for wiki targets', () => {
      const target = createWikiTarget();
      assert.strictEqual(getWorkTargetKey(target), 'wiki');
    });
  });
});
