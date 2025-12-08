/**
 * Unit tests for commit title extraction from code-change-agent.
 * Tests the extractTitleFromMessage function handles various commit message formats.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractTitleFromMessage } from '../../src/agents/analysis/code-change-agent.js';

describe('extractTitleFromMessage', () => {
  describe('merge pull request commits', () => {
    it('extracts readable title from GitHub merge PR message', () => {
      const message = 'Merge pull request #238 from JKershaw/claude/add-openrouter-env-config-011cd1QjbHK9gPkqNhQLhb2B';
      const result = extractTitleFromMessage(message);

      // Should not contain the full PR message
      assert.ok(!result.includes('Merge pull request'), 'Should not contain "Merge pull request"');
      assert.ok(!result.includes('#238'), 'Should not contain PR number');
      assert.ok(!result.includes('011cd1'), 'Should not contain session ID');

      // Should be a readable title
      assert.ok(result.length < 50, 'Title should be reasonably short');
      assert.ok(result.includes('Openrouter') || result.includes('Env') || result.includes('Config'),
        'Should contain meaningful words from branch name');
    });

    it('handles branch with feature prefix', () => {
      const message = 'Merge pull request #123 from user/feature/user-authentication';
      const result = extractTitleFromMessage(message);

      assert.ok(!result.toLowerCase().includes('feature'), 'Should remove feature prefix');
      assert.ok(result.includes('User') || result.includes('Authentication'),
        'Should contain meaningful words');
    });

    it('handles branch with fix prefix', () => {
      const message = 'Merge pull request #456 from user/fix/broken-links';
      const result = extractTitleFromMessage(message);

      assert.ok(result.includes('Broken') || result.includes('Links'),
        'Should contain meaningful words');
    });

    it('handles simple branch names', () => {
      const message = 'Merge pull request #789 from user/add-dark-mode';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Add Dark Mode', 'Should convert to title case');
    });

    it('falls back gracefully for unparseable merge commits', () => {
      const message = 'Merge pull request #100';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Merged Changes', 'Should return fallback title');
    });
  });

  describe('merge branch commits', () => {
    it('extracts title from merge branch format', () => {
      const message = "Merge branch 'feature-xyz' into 'main'";
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Feature Xyz', 'Should convert branch name to title');
    });

    it('handles underscored branch names', () => {
      const message = "Merge branch 'add_new_feature'";
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Add New Feature', 'Should handle underscores');
    });
  });

  describe('conventional commits', () => {
    it('removes feat: prefix', () => {
      const message = 'feat: add user authentication';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Add user authentication');
    });

    it('removes fix: prefix', () => {
      const message = 'fix: resolve memory leak in cache';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Resolve memory leak in cache');
    });

    it('removes scoped prefix like feat(auth):', () => {
      const message = 'feat(auth): implement OAuth flow';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Implement OAuth flow');
    });

    it('handles all conventional commit types', () => {
      const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'build', 'ci', 'perf', 'revert'];

      for (const type of types) {
        const message = `${type}: do something`;
        const result = extractTitleFromMessage(message);

        assert.ok(!result.toLowerCase().startsWith(type),
          `Should remove ${type}: prefix`);
      }
    });
  });

  describe('regular commits', () => {
    it('capitalizes first letter of regular message', () => {
      const message = 'update readme with new instructions';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Update readme with new instructions');
    });

    it('preserves already capitalized messages', () => {
      const message = 'Add new authentication module';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'Add new authentication module');
    });

    it('takes only first line of multi-line message', () => {
      const message = 'First line title\n\nThis is the body with more details.';
      const result = extractTitleFromMessage(message);

      assert.strictEqual(result, 'First line title');
    });
  });
});
