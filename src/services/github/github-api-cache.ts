/**
 * GitHub API Response Cache.
 *
 * Provides an in-memory cache with TTL support to reduce API calls
 * and avoid rate limits.
 */

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache configuration options.
 */
export interface CacheOptions {
  /** Default TTL in milliseconds (default: 5 minutes) */
  defaultTtl?: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number;
}

/**
 * TTL options for different content types.
 */
export interface ContentTtl {
  /** TTL for repository info (default: 5 minutes) */
  repoInfo?: number;
  /** TTL for commit lists (default: 1 minute) */
  commits?: number;
  /** TTL for file content (default: 5 minutes) */
  fileContent?: number;
  /** TTL for directory listings (default: 2 minutes) */
  directory?: number;
  /** TTL for tree listings (default: 5 minutes) */
  tree?: number;
  /** TTL for diffs (default: 10 minutes - diffs don't change) */
  diff?: number;
}

/**
 * Default TTL values in milliseconds.
 */
const DEFAULT_TTL: Required<ContentTtl> = {
  repoInfo: 5 * 60 * 1000,      // 5 minutes
  commits: 1 * 60 * 1000,       // 1 minute
  fileContent: 5 * 60 * 1000,   // 5 minutes
  directory: 2 * 60 * 1000,     // 2 minutes
  tree: 5 * 60 * 1000,          // 5 minutes
  diff: 10 * 60 * 1000,         // 10 minutes
};

/**
 * GitHub API Cache interface.
 */
export interface GitHubApiCache {
  /**
   * Get a cached value by key.
   */
  get<T>(key: string): T | undefined;

  /**
   * Set a cached value with optional TTL.
   */
  set<T>(key: string, value: T, ttl?: number): void;

  /**
   * Delete a cached value.
   */
  delete(key: string): boolean;

  /**
   * Clear all cached values.
   */
  clear(): void;

  /**
   * Get the number of cached entries.
   */
  size(): number;

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean;

  /**
   * Get or set a cached value using a factory function.
   */
  getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>;

  /**
   * Get TTL for a specific content type.
   */
  getTtl(type: keyof ContentTtl): number;
}

/**
 * Generate a cache key for a GitHub API request.
 */
export function makeCacheKey(
  type: keyof ContentTtl,
  owner: string,
  repo: string,
  ...parts: (string | undefined)[]
): string {
  const validParts = parts.filter(p => p !== undefined);
  return `${type}:${owner}/${repo}${validParts.length > 0 ? ':' + validParts.join(':') : ''}`;
}

/**
 * Create a GitHub API cache instance.
 */
export function createGitHubApiCache(options: CacheOptions = {}): GitHubApiCache {
  const maxEntries = options.maxEntries ?? 1000;
  const defaultTtl = options.defaultTtl ?? DEFAULT_TTL.fileContent;
  const ttls: Required<ContentTtl> = { ...DEFAULT_TTL };

  const cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Remove expired entries and enforce max size.
   */
  function cleanup(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }

    // Enforce max entries (remove oldest if over limit)
    if (cache.size > maxEntries) {
      const entriesToRemove = cache.size - maxEntries;
      const iterator = cache.keys();
      for (let i = 0; i < entriesToRemove; i++) {
        const key = iterator.next().value;
        if (key) {
          cache.delete(key);
        }
      }
    }
  }

  return {
    get<T>(key: string): T | undefined {
      const entry = cache.get(key) as CacheEntry<T> | undefined;

      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
      }

      return entry.value;
    },

    set<T>(key: string, value: T, ttl?: number): void {
      const expiresAt = Date.now() + (ttl ?? defaultTtl);
      cache.set(key, { value, expiresAt });

      // Periodically cleanup
      if (cache.size > maxEntries * 1.1) {
        cleanup();
      }
    },

    delete(key: string): boolean {
      return cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },

    size(): number {
      return cache.size;
    },

    has(key: string): boolean {
      const entry = cache.get(key);
      if (!entry) {
        return false;
      }
      if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return false;
      }
      return true;
    },

    async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
      const cached = this.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }

      const value = await factory();
      this.set(key, value, ttl);
      return value;
    },

    getTtl(type: keyof ContentTtl): number {
      return ttls[type];
    },
  };
}

/**
 * Create a cached version of the GitHub repo service.
 */
import type { GitHubRepoService, DirectoryEntry, TreeEntry, RepoInfo } from './github-repo-service.js';
import type { Commit } from '../../domain/commit.js';

export function createCachedGitHubRepoService(
  service: GitHubRepoService,
  cache: GitHubApiCache
): GitHubRepoService {
  return {
    async getRepository(owner: string, repo: string): Promise<RepoInfo> {
      const key = makeCacheKey('repoInfo', owner, repo);
      return cache.getOrSet(key, () => service.getRepository(owner, repo), cache.getTtl('repoInfo'));
    },

    async listCommits(owner: string, repo: string, repoId: string, options = {}): Promise<Commit[]> {
      // Don't cache commit lists as they change frequently
      // and options vary - just pass through
      return service.listCommits(owner, repo, repoId, options);
    },

    async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
      const key = makeCacheKey('diff', owner, repo, sha);
      return cache.getOrSet(key, () => service.getCommitDiff(owner, repo, sha), cache.getTtl('diff'));
    },

    async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
      const key = makeCacheKey('fileContent', owner, repo, path, ref);
      return cache.getOrSet(
        key,
        () => service.getFileContent(owner, repo, path, ref),
        cache.getTtl('fileContent')
      );
    },

    async getDirectoryContents(owner: string, repo: string, path: string, ref?: string): Promise<DirectoryEntry[]> {
      const key = makeCacheKey('directory', owner, repo, path, ref);
      return cache.getOrSet(
        key,
        () => service.getDirectoryContents(owner, repo, path, ref),
        cache.getTtl('directory')
      );
    },

    async getTree(owner: string, repo: string, sha: string, recursive = true): Promise<TreeEntry[]> {
      const key = makeCacheKey('tree', owner, repo, sha, recursive ? 'recursive' : 'shallow');
      return cache.getOrSet(key, () => service.getTree(owner, repo, sha, recursive), cache.getTtl('tree'));
    },

    async getDefaultBranch(owner: string, repo: string): Promise<string> {
      // Uses getRepository which is cached
      return service.getDefaultBranch(owner, repo);
    },
  };
}
