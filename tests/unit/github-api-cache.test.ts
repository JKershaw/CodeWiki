/**
 * Unit tests for GitHub API Cache.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createGitHubApiCache,
  makeCacheKey,
  createCachedGitHubRepoService,
  type GitHubApiCache,
} from '../../src/services/github/github-api-cache.js';
import type { GitHubRepoService, RepoInfo, DirectoryEntry, TreeEntry } from '../../src/services/github/github-repo-service.js';
import type { Commit } from '../../src/domain/commit.js';

describe('GitHub API Cache', () => {
  let cache: GitHubApiCache;

  beforeEach(() => {
    cache = createGitHubApiCache();
  });

  describe('makeCacheKey', () => {
    it('creates key with owner/repo', () => {
      const key = makeCacheKey('repoInfo', 'owner', 'repo');
      assert.strictEqual(key, 'repoInfo:owner/repo');
    });

    it('creates key with additional parts', () => {
      const key = makeCacheKey('fileContent', 'owner', 'repo', 'src/index.ts', 'main');
      assert.strictEqual(key, 'fileContent:owner/repo:src/index.ts:main');
    });

    it('ignores undefined parts', () => {
      const key = makeCacheKey('fileContent', 'owner', 'repo', 'file.ts', undefined);
      assert.strictEqual(key, 'fileContent:owner/repo:file.ts');
    });
  });

  describe('basic operations', () => {
    it('stores and retrieves values', () => {
      cache.set('key1', 'value1');
      assert.strictEqual(cache.get('key1'), 'value1');
    });

    it('returns undefined for missing keys', () => {
      assert.strictEqual(cache.get('nonexistent'), undefined);
    });

    it('deletes values', () => {
      cache.set('key1', 'value1');
      assert.strictEqual(cache.delete('key1'), true);
      assert.strictEqual(cache.get('key1'), undefined);
    });

    it('returns false when deleting nonexistent key', () => {
      assert.strictEqual(cache.delete('nonexistent'), false);
    });

    it('clears all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      assert.strictEqual(cache.size(), 0);
    });

    it('reports size correctly', () => {
      assert.strictEqual(cache.size(), 0);
      cache.set('key1', 'value1');
      assert.strictEqual(cache.size(), 1);
      cache.set('key2', 'value2');
      assert.strictEqual(cache.size(), 2);
    });

    it('has() returns true for existing keys', () => {
      cache.set('key1', 'value1');
      assert.strictEqual(cache.has('key1'), true);
    });

    it('has() returns false for missing keys', () => {
      assert.strictEqual(cache.has('nonexistent'), false);
    });
  });

  describe('TTL expiration', () => {
    it('expires entries after TTL', async () => {
      cache.set('key1', 'value1', 10); // 10ms TTL
      assert.strictEqual(cache.get('key1'), 'value1');

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.strictEqual(cache.get('key1'), undefined);
    });

    it('has() returns false for expired keys', async () => {
      cache.set('key1', 'value1', 10);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(cache.has('key1'), false);
    });
  });

  describe('getOrSet', () => {
    it('returns cached value without calling factory', async () => {
      cache.set('key1', 'cached');
      let factoryCalled = false;

      const result = await cache.getOrSet('key1', async () => {
        factoryCalled = true;
        return 'new';
      });

      assert.strictEqual(result, 'cached');
      assert.strictEqual(factoryCalled, false);
    });

    it('calls factory for missing keys', async () => {
      let factoryCalled = false;

      const result = await cache.getOrSet('key1', async () => {
        factoryCalled = true;
        return 'new';
      });

      assert.strictEqual(result, 'new');
      assert.strictEqual(factoryCalled, true);
    });

    it('caches the factory result', async () => {
      await cache.getOrSet('key1', async () => 'value1');
      assert.strictEqual(cache.get('key1'), 'value1');
    });

    it('uses provided TTL', async () => {
      await cache.getOrSet('key1', async () => 'value1', 10);
      assert.strictEqual(cache.get('key1'), 'value1');

      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(cache.get('key1'), undefined);
    });
  });

  describe('getTtl', () => {
    it('returns TTL for repoInfo', () => {
      const ttl = cache.getTtl('repoInfo');
      assert.strictEqual(ttl, 5 * 60 * 1000); // 5 minutes
    });

    it('returns TTL for commits', () => {
      const ttl = cache.getTtl('commits');
      assert.strictEqual(ttl, 1 * 60 * 1000); // 1 minute
    });

    it('returns TTL for diff', () => {
      const ttl = cache.getTtl('diff');
      assert.strictEqual(ttl, 10 * 60 * 1000); // 10 minutes
    });
  });

  describe('max entries', () => {
    it('respects max entries limit', () => {
      const smallCache = createGitHubApiCache({ maxEntries: 10 });

      // Add more than max entries
      for (let i = 0; i < 15; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      // Size should be reduced after cleanup (triggered at 110% of max)
      // The cleanup happens lazily, so we trigger it by adding more
      for (let i = 15; i < 20; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      // Should have cleaned up old entries
      assert.ok(smallCache.size() <= 12); // Allow some buffer
    });
  });
});

describe('Cached GitHub Repo Service', () => {
  let cache: GitHubApiCache;
  let mockService: GitHubRepoService;
  let cachedService: GitHubRepoService;
  let callCounts: Record<string, number>;

  beforeEach(() => {
    cache = createGitHubApiCache();
    callCounts = {
      getRepository: 0,
      listCommits: 0,
      getCommitDiff: 0,
      getFileContent: 0,
      getDirectoryContents: 0,
      getTree: 0,
      getDefaultBranch: 0,
    };

    mockService = {
      async getRepository(owner: string, repo: string): Promise<RepoInfo> {
        callCounts.getRepository++;
        return {
          id: 1,
          name: repo,
          fullName: `${owner}/${repo}`,
          defaultBranch: 'main',
          isPrivate: false,
          description: null,
        };
      },

      async listCommits(): Promise<Commit[]> {
        callCounts.listCommits++;
        return [];
      },

      async getCommitDiff(_owner: string, _repo: string, sha: string): Promise<string> {
        callCounts.getCommitDiff++;
        return `diff for ${sha}`;
      },

      async getFileContent(_owner: string, _repo: string, path: string): Promise<string> {
        callCounts.getFileContent++;
        return `content of ${path}`;
      },

      async getDirectoryContents(): Promise<DirectoryEntry[]> {
        callCounts.getDirectoryContents++;
        return [];
      },

      async getTree(): Promise<TreeEntry[]> {
        callCounts.getTree++;
        return [];
      },

      async getDefaultBranch(): Promise<string> {
        callCounts.getDefaultBranch++;
        return 'main';
      },
    };

    cachedService = createCachedGitHubRepoService(mockService, cache);
  });

  it('caches getRepository calls', async () => {
    await cachedService.getRepository('owner', 'repo');
    await cachedService.getRepository('owner', 'repo');
    await cachedService.getRepository('owner', 'repo');

    assert.strictEqual(callCounts.getRepository, 1);
  });

  it('does not cache listCommits (changes frequently)', async () => {
    await cachedService.listCommits('owner', 'repo', 'repo-id');
    await cachedService.listCommits('owner', 'repo', 'repo-id');

    assert.strictEqual(callCounts.listCommits, 2);
  });

  it('caches getCommitDiff calls', async () => {
    await cachedService.getCommitDiff('owner', 'repo', 'sha123');
    await cachedService.getCommitDiff('owner', 'repo', 'sha123');

    assert.strictEqual(callCounts.getCommitDiff, 1);
  });

  it('caches getFileContent calls', async () => {
    await cachedService.getFileContent('owner', 'repo', 'src/index.ts');
    await cachedService.getFileContent('owner', 'repo', 'src/index.ts');

    assert.strictEqual(callCounts.getFileContent, 1);
  });

  it('caches getFileContent with different refs separately', async () => {
    await cachedService.getFileContent('owner', 'repo', 'file.ts', 'main');
    await cachedService.getFileContent('owner', 'repo', 'file.ts', 'develop');

    assert.strictEqual(callCounts.getFileContent, 2);
  });

  it('caches getDirectoryContents calls', async () => {
    await cachedService.getDirectoryContents('owner', 'repo', 'src');
    await cachedService.getDirectoryContents('owner', 'repo', 'src');

    assert.strictEqual(callCounts.getDirectoryContents, 1);
  });

  it('caches getTree calls', async () => {
    await cachedService.getTree('owner', 'repo', 'sha123');
    await cachedService.getTree('owner', 'repo', 'sha123');

    assert.strictEqual(callCounts.getTree, 1);
  });

  it('caches different repositories separately', async () => {
    await cachedService.getRepository('owner1', 'repo1');
    await cachedService.getRepository('owner2', 'repo2');

    assert.strictEqual(callCounts.getRepository, 2);
  });
});
