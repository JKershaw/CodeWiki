/**
 * Unified Repository Service.
 *
 * Provides a common interface for accessing repository data,
 * abstracting whether the repository is accessed via GitHub API
 * or the local filesystem.
 */

import type { Commit } from '../../domain/commit.js';
import type { Repo } from '../../domain/repo.js';
import type { GitHubRepoService } from '../github/github-repo-service.js';
import type { GitService } from '../git/git-service.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, sep } from 'path';

/**
 * Options for listing commits.
 */
export interface CommitListOptions {
  /** Maximum number of commits to return */
  limit?: number;
  /** Only include commits after this date */
  since?: Date;
  /** Branch or commit SHA to start from */
  branch?: string;
}

/**
 * File entry in a directory listing.
 */
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

/**
 * Unified Repository Service interface.
 *
 * Provides repository access methods that work with both
 * GitHub API and local filesystem repositories.
 */
export interface RepositoryService {
  /**
   * Load commits from the repository.
   */
  loadCommits(repo: Repo, options?: CommitListOptions): Promise<Commit[]>;

  /**
   * Get the unified diff for a specific commit.
   */
  getCommitDiff(repo: Repo, sha: string): Promise<string>;

  /**
   * Get file content at a specific ref (branch, tag, or commit SHA).
   * For local repos, ref is ignored (always reads current state).
   */
  getFileContent(repo: Repo, path: string, ref?: string): Promise<string>;

  /**
   * List files in a directory.
   */
  listDirectory(repo: Repo, path: string, ref?: string): Promise<FileEntry[]>;

  /**
   * Get all files in the repository (recursive tree listing).
   * Returns file paths relative to the repository root.
   */
  getFileTree(repo: Repo, ref?: string): Promise<string[]>;

  /**
   * Check if a file exists.
   */
  fileExists(repo: Repo, path: string, ref?: string): Promise<boolean>;

  /**
   * Get the default branch name.
   */
  getDefaultBranch(repo: Repo): Promise<string>;
}

/**
 * Create a repository service for a specific repository.
 *
 * Returns either a GitHub API-based or filesystem-based service
 * depending on the repository type.
 */
export function createRepositoryService(
  repo: Repo,
  deps: {
    githubRepoService?: GitHubRepoService;
    gitService?: GitService;
  }
): RepositoryService {
  if (repo.isGitHubRepo) {
    if (!deps.githubRepoService) {
      throw new Error('GitHub repo service required for GitHub repositories');
    }
    if (!repo.owner || !repo.repoName) {
      throw new Error('GitHub repositories require owner and repoName');
    }
    return createGitHubRepositoryService(repo.owner, repo.repoName, repo.id, deps.githubRepoService);
  } else {
    if (!deps.gitService) {
      throw new Error('Git service required for local repositories');
    }
    return createLocalRepositoryService(repo.id, repo.fullName, deps.gitService);
  }
}

/**
 * Create a repository service backed by GitHub API.
 */
function createGitHubRepositoryService(
  owner: string,
  repoName: string,
  repoId: string,
  githubService: GitHubRepoService
): RepositoryService {
  return {
    async loadCommits(repo: Repo, options?: CommitListOptions): Promise<Commit[]> {
      return githubService.listCommits(owner, repoName, repoId, {
        ...(options?.limit !== undefined && { limit: options.limit }),
        ...(options?.since && { since: options.since }),
        ...(options?.branch && { sha: options.branch }),
      });
    },

    async getCommitDiff(_repo: Repo, sha: string): Promise<string> {
      return githubService.getCommitDiff(owner, repoName, sha);
    },

    async getFileContent(_repo: Repo, path: string, ref?: string): Promise<string> {
      return githubService.getFileContent(owner, repoName, path, ref);
    },

    async listDirectory(_repo: Repo, path: string, ref?: string): Promise<FileEntry[]> {
      const entries = await githubService.getDirectoryContents(owner, repoName, path, ref);
      return entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === 'dir' ? 'dir' : 'file',
        size: entry.size,
      }));
    },

    async getFileTree(_repo: Repo, ref?: string): Promise<string[]> {
      // Get the default branch (or use provided ref)
      let treeRef = ref;
      if (!treeRef) {
        try {
          treeRef = await githubService.getDefaultBranch(owner, repoName);
        } catch (branchError) {
          console.warn(`getFileTree: getDefaultBranch failed for ${owner}/${repoName}: ${branchError}`);
          throw branchError;
        }
      }

      // Get the tree
      try {
        const tree = await githubService.getTree(owner, repoName, treeRef, true);
        return tree
          .filter(entry => entry.type === 'blob')
          .map(entry => entry.path);
      } catch (treeError) {
        console.warn(`getFileTree: getTree failed for ${owner}/${repoName} at ref '${treeRef}': ${treeError}`);
        throw treeError;
      }
    },

    async fileExists(_repo: Repo, path: string, ref?: string): Promise<boolean> {
      try {
        await githubService.getFileContent(owner, repoName, path, ref);
        return true;
      } catch {
        return false;
      }
    },

    async getDefaultBranch(_repo: Repo): Promise<string> {
      return githubService.getDefaultBranch(owner, repoName);
    },
  };
}

/**
 * Create a repository service backed by local filesystem.
 */
function createLocalRepositoryService(
  repoId: string,
  repoPath: string,
  gitService: GitService
): RepositoryService {
  // Register the local repo path
  gitService.registerLocalRepo(repoId, repoPath);

  return {
    async loadCommits(_repo: Repo, options?: CommitListOptions): Promise<Commit[]> {
      return gitService.loadCommits(repoId, {
        ...(options?.limit !== undefined && { limit: options.limit }),
        ...(options?.since && { since: options.since }),
        ...(options?.branch && { branch: options.branch }),
      });
    },

    async getCommitDiff(_repo: Repo, sha: string): Promise<string> {
      return gitService.getCommitDiff(repoId, sha);
    },

    async getFileContent(_repo: Repo, path: string, _ref?: string): Promise<string> {
      // For local repos, always read current state
      const fullPath = join(repoPath, path);
      return readFile(fullPath, 'utf-8');
    },

    async listDirectory(_repo: Repo, dirPath: string, _ref?: string): Promise<FileEntry[]> {
      const fullPath = join(repoPath, dirPath);
      const entries = await readdir(fullPath, { withFileTypes: true });

      return Promise.all(
        entries
          .filter(entry => !entry.name.startsWith('.'))
          .map(async entry => {
            const entryPath = join(dirPath, entry.name);
            const fullEntryPath = join(repoPath, entryPath);
            const stats = await stat(fullEntryPath);
            return {
              name: entry.name,
              path: entryPath,
              type: entry.isDirectory() ? 'dir' as const : 'file' as const,
              size: stats.size,
            };
          })
      );
    },

    async getFileTree(_repo: Repo, _ref?: string): Promise<string[]> {
      const files: string[] = [];

      async function walkDir(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;

          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile()) {
            const relativePath = relative(repoPath, fullPath);
            // Normalize path separators for Windows compatibility
            files.push(relativePath.split(sep).join('/'));
          }
        }
      }

      await walkDir(repoPath);
      return files;
    },

    async fileExists(_repo: Repo, path: string, _ref?: string): Promise<boolean> {
      try {
        const fullPath = join(repoPath, path);
        await stat(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async getDefaultBranch(_repo: Repo): Promise<string> {
      // For local repos, just return the configured default
      return _repo.defaultBranch || 'main';
    },
  };
}

/**
 * Factory for creating repository services.
 *
 * This is the main entry point for getting a repository service.
 * It handles caching and proper configuration of services.
 */
export interface RepositoryServiceFactory {
  /**
   * Get a repository service for the given repository.
   * For GitHub repos with a userId, this will use the user's access token.
   */
  getService(repo: Repo): RepositoryService;

  /**
   * Get a repository service with a specific access token.
   * This is used for GitHub repos when we have a user's access token.
   */
  getServiceWithToken(repo: Repo, accessToken: string): RepositoryService;
}

/**
 * User repository interface for looking up access tokens.
 */
interface UserRepository {
  findById(id: string): Promise<{ accessToken?: string } | null>;
}

/**
 * Create a repository service factory.
 *
 * @param deps.githubRepoService - Unauthenticated GitHub service (for public repos)
 * @param deps.gitService - Local git service
 * @param deps.userRepository - Optional user repository for looking up access tokens
 * @param deps.createGitHubService - Optional factory for creating authenticated GitHub services
 */
export function createRepositoryServiceFactory(deps: {
  githubRepoService?: GitHubRepoService;
  gitService?: GitService;
  userRepository?: UserRepository;
  createGitHubService?: (accessToken: string) => GitHubRepoService;
}): RepositoryServiceFactory {
  // Cache keyed by repo ID + access token hash (or 'public' for unauthenticated)
  const serviceCache = new Map<string, RepositoryService>();

  function getCacheKey(repoId: string, accessToken?: string): string {
    if (!accessToken) {
      return `${repoId}:public`;
    }
    // Use a simple hash to avoid storing tokens in cache keys
    const tokenHash = accessToken.slice(-8);
    return `${repoId}:${tokenHash}`;
  }

  return {
    getService(repo: Repo): RepositoryService {
      // For local repos, use the standard path
      if (!repo.isGitHubRepo) {
        const cacheKey = getCacheKey(repo.id);
        let service = serviceCache.get(cacheKey);
        if (service) {
          return service;
        }
        service = createRepositoryService(repo, deps);
        serviceCache.set(cacheKey, service);
        return service;
      }

      // For GitHub repos, use unauthenticated service (for public repos)
      // The executor should call getServiceWithToken for private repos
      const cacheKey = getCacheKey(repo.id);
      let service = serviceCache.get(cacheKey);
      if (service) {
        return service;
      }

      service = createRepositoryService(repo, deps);
      serviceCache.set(cacheKey, service);
      return service;
    },

    getServiceWithToken(repo: Repo, accessToken: string): RepositoryService {
      if (!repo.isGitHubRepo) {
        // Local repos don't need tokens
        return this.getService(repo);
      }

      const cacheKey = getCacheKey(repo.id, accessToken);
      let service = serviceCache.get(cacheKey);
      if (service) {
        return service;
      }

      // Create authenticated GitHub service
      if (!deps.createGitHubService) {
        throw new Error('createGitHubService required for authenticated GitHub access');
      }

      const authGitHubService = deps.createGitHubService(accessToken);
      service = createRepositoryService(repo, {
        ...deps,
        githubRepoService: authGitHubService,
      });
      serviceCache.set(cacheKey, service);
      return service;
    },
  };
}
