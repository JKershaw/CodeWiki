/**
 * Unified Repository Service.
 *
 * Provides a common interface for accessing repository data,
 * abstracting whether the repository is accessed via GitHub API
 * or the local filesystem.
 */

import type { Commit } from '../../domain/commit.js';
import type { Repo } from '../../domain/repo.js';
import type { GitHubRepoService, DirectoryEntry, TreeEntry } from '../github/github-repo-service.js';
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
        limit: options?.limit,
        since: options?.since,
        sha: options?.branch,
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
      const sha = ref ?? await githubService.getDefaultBranch(owner, repoName);
      const tree = await githubService.getTree(owner, repoName, sha, true);
      return tree
        .filter(entry => entry.type === 'blob')
        .map(entry => entry.path);
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
        limit: options?.limit,
        since: options?.since,
        branch: options?.branch,
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
   */
  getService(repo: Repo): RepositoryService;
}

/**
 * Create a repository service factory.
 */
export function createRepositoryServiceFactory(deps: {
  githubRepoService?: GitHubRepoService;
  gitService?: GitService;
}): RepositoryServiceFactory {
  const serviceCache = new Map<string, RepositoryService>();

  return {
    getService(repo: Repo): RepositoryService {
      // Check cache
      let service = serviceCache.get(repo.id);
      if (service) {
        return service;
      }

      // Create new service
      service = createRepositoryService(repo, deps);
      serviceCache.set(repo.id, service);

      return service;
    },
  };
}
