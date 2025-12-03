/**
 * Unit tests for GitHub URL validation and extraction functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isValidGitHubUrl,
  extractRepoNameFromUrl,
  normalizeGitHubUrl,
} from '../../src/web/routes/repos.js';

describe('GitHub URL Validation', () => {
  describe('isValidGitHubUrl', () => {
    it('accepts valid https github.com URLs', () => {
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/repo'), true);
      assert.strictEqual(isValidGitHubUrl('https://github.com/octocat/hello-world'), true);
      assert.strictEqual(isValidGitHubUrl('https://github.com/facebook/react'), true);
    });

    it('accepts URLs with .git extension', () => {
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/repo.git'), true);
      assert.strictEqual(isValidGitHubUrl('https://github.com/octocat/hello-world.git'), true);
    });

    it('accepts http URLs', () => {
      assert.strictEqual(isValidGitHubUrl('http://github.com/owner/repo'), true);
      assert.strictEqual(isValidGitHubUrl('http://github.com/owner/repo.git'), true);
    });

    it('rejects non-github.com URLs', () => {
      assert.strictEqual(isValidGitHubUrl('https://gitlab.com/owner/repo'), false);
      assert.strictEqual(isValidGitHubUrl('https://bitbucket.org/owner/repo'), false);
      assert.strictEqual(isValidGitHubUrl('https://example.com/owner/repo'), false);
    });

    it('rejects invalid URL formats', () => {
      assert.strictEqual(isValidGitHubUrl('not-a-url'), false);
      assert.strictEqual(isValidGitHubUrl('github.com/owner/repo'), false);
      assert.strictEqual(isValidGitHubUrl(''), false);
    });

    it('rejects URLs without owner/repo path', () => {
      assert.strictEqual(isValidGitHubUrl('https://github.com'), false);
      assert.strictEqual(isValidGitHubUrl('https://github.com/'), false);
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner'), false);
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/'), false);
    });

    it('rejects URLs with extra path segments', () => {
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/repo/tree/main'), false);
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/repo/blob/main/file.txt'), false);
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner/repo/issues'), false);
    });

    it('handles edge cases', () => {
      // Repos with hyphens and underscores
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner-name/repo-name'), true);
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner_name/repo_name'), true);
      // Repos with numbers
      assert.strictEqual(isValidGitHubUrl('https://github.com/owner123/repo456'), true);
      // Single character names
      assert.strictEqual(isValidGitHubUrl('https://github.com/a/b'), true);
    });
  });

  describe('extractRepoNameFromUrl', () => {
    it('extracts owner/repo from valid URLs', () => {
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner/repo'), 'owner/repo');
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/octocat/hello-world'), 'octocat/hello-world');
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/facebook/react'), 'facebook/react');
    });

    it('extracts owner/repo from URLs with .git extension', () => {
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner/repo.git'), 'owner/repo');
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/octocat/hello-world.git'), 'octocat/hello-world');
    });

    it('extracts owner/repo from http URLs', () => {
      assert.strictEqual(extractRepoNameFromUrl('http://github.com/owner/repo'), 'owner/repo');
    });

    it('returns null for invalid URLs', () => {
      assert.strictEqual(extractRepoNameFromUrl('not-a-url'), null);
      assert.strictEqual(extractRepoNameFromUrl('https://github.com'), null);
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner'), null);
      assert.strictEqual(extractRepoNameFromUrl(''), null);
    });

    it('handles repos with special characters', () => {
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner-name/repo-name'), 'owner-name/repo-name');
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner_name/repo_name'), 'owner_name/repo_name');
      assert.strictEqual(extractRepoNameFromUrl('https://github.com/owner.name/repo.name'), 'owner.name/repo.name');
    });
  });

  describe('normalizeGitHubUrl', () => {
    it('normalizes URLs to https with .git extension', () => {
      assert.strictEqual(normalizeGitHubUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo.git');
      assert.strictEqual(normalizeGitHubUrl('http://github.com/owner/repo'), 'https://github.com/owner/repo.git');
    });

    it('preserves already normalized URLs', () => {
      assert.strictEqual(normalizeGitHubUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo.git');
    });

    it('handles complex repo names', () => {
      assert.strictEqual(normalizeGitHubUrl('https://github.com/owner-name/repo-name'), 'https://github.com/owner-name/repo-name.git');
      assert.strictEqual(normalizeGitHubUrl('https://github.com/facebook/react'), 'https://github.com/facebook/react.git');
    });
  });
});
