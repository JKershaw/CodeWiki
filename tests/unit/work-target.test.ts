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
  legacyToWorkTarget,
  workTargetToLegacy,
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

  describe('legacyToWorkTarget', () => {
    it('converts targetCommitId to commit target', () => {
      const target = legacyToWorkTarget('abc123', null);
      assert.strictEqual(target.type, 'commit');
      if (isCommitTarget(target)) {
        assert.strictEqual(target.commitId, 'abc123');
      }
    });

    it('converts targetPath to path target', () => {
      const target = legacyToWorkTarget(null, 'src/foo');
      assert.strictEqual(target.type, 'path');
      if (isPathTarget(target)) {
        assert.strictEqual(target.path, 'src/foo');
      }
    });

    it('converts null/null to wiki target', () => {
      const target = legacyToWorkTarget(null, null);
      assert.strictEqual(target.type, 'wiki');
    });

    it('prefers commitId when both are provided', () => {
      // This shouldn't happen in practice, but commitId takes precedence
      const target = legacyToWorkTarget('abc123', 'src/foo');
      assert.strictEqual(target.type, 'commit');
    });
  });

  describe('workTargetToLegacy', () => {
    it('converts commit target to legacy format', () => {
      const target = createCommitTarget('abc123');
      const legacy = workTargetToLegacy(target);
      assert.strictEqual(legacy.targetCommitId, 'abc123');
      assert.strictEqual(legacy.targetPath, null);
    });

    it('converts path target to legacy format', () => {
      const target = createPathTarget('src/foo');
      const legacy = workTargetToLegacy(target);
      assert.strictEqual(legacy.targetCommitId, null);
      assert.strictEqual(legacy.targetPath, 'src/foo');
    });

    it('converts wiki target to legacy format', () => {
      const target = createWikiTarget();
      const legacy = workTargetToLegacy(target);
      assert.strictEqual(legacy.targetCommitId, null);
      assert.strictEqual(legacy.targetPath, null);
    });

    it('round-trips through legacy conversion', () => {
      // Commit
      const commit = createCommitTarget('abc123');
      const commitLegacy = workTargetToLegacy(commit);
      const commitBack = legacyToWorkTarget(commitLegacy.targetCommitId, commitLegacy.targetPath);
      assert.deepStrictEqual(commitBack, commit);

      // Path
      const path = createPathTarget('src/foo');
      const pathLegacy = workTargetToLegacy(path);
      const pathBack = legacyToWorkTarget(pathLegacy.targetCommitId, pathLegacy.targetPath);
      assert.deepStrictEqual(pathBack, path);

      // Wiki
      const wiki = createWikiTarget();
      const wikiLegacy = workTargetToLegacy(wiki);
      const wikiBack = legacyToWorkTarget(wikiLegacy.targetCommitId, wikiLegacy.targetPath);
      assert.deepStrictEqual(wikiBack, wiki);
    });
  });
});
