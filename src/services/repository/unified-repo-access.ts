/**
 * Unified Repository Access.
 *
 * Provides a simplified interface for repository access that:
 * 1. Binds to a specific repo (no repo parameter needed on calls)
 * 2. Provides isLocal() and getLocalPath() for cases needing local access
 * 3. Hides the GitHub vs local distinction from consumers
 *
 * This replaces the pattern of checking `context.repoService && context.repo`
 * or falling back to `context.git` throughout the codebase.
 */

import type { Repo } from '../../domain/repo.js';
import type { RepositoryService, RepositoryServiceFactory, FileEntry } from './repository-service.js';
import type { GitService } from '../git/git-service.js';
import type { Repositories } from '../../repositories/index.js';

/**
 * Unified interface for repository access.
 *
 * All methods are bound to a specific repository, eliminating the need
 * to pass repo/repoId on every call.
 */
export interface UnifiedRepoAccess {
  /**
   * Get file content at a specific ref (branch, tag, or commit SHA).
   * For local repos, ref is ignored (always reads current state).
   */
  getFileContent(path: string, ref?: string): Promise<string>;

  /**
   * List files in a directory.
   */
  listDirectory(path: string, ref?: string): Promise<FileEntry[]>;

  /**
   * Get all files in the repository (recursive tree listing).
   * Returns file paths relative to the repository root.
   */
  getFileTree(ref?: string): Promise<string[]>;

  /**
   * Check if a file exists.
   */
  fileExists(path: string, ref?: string): Promise<boolean>;

  /**
   * Get the unified diff for a specific commit.
   */
  getCommitDiff(sha: string): Promise<string>;

  /**
   * Check if this is a local filesystem repository.
   */
  isLocal(): boolean;

  /**
   * Get the local filesystem path if this is a local repo.
   * Returns undefined for GitHub repos.
   */
  getLocalPath(): string | undefined;
}

/**
 * Factory for creating UnifiedRepoAccess instances.
 */
export interface UnifiedRepoAccessFactory {
  /**
   * Create a UnifiedRepoAccess for the given repository ID.
   * Handles looking up the repo, determining type, and authentication.
   */
  create(repoId: string): Promise<UnifiedRepoAccess>;
}

/**
 * Create a UnifiedRepoAccess for a local filesystem repository.
 */
export function createLocalRepoAccess(
  repo: Repo,
  repoService: RepositoryService,
  gitService: GitService
): UnifiedRepoAccess {
  const localPath = gitService.getRepoPath(repo.id);

  return {
    async getFileContent(path: string, ref?: string): Promise<string> {
      return repoService.getFileContent(repo, path, ref);
    },

    async listDirectory(path: string, ref?: string): Promise<FileEntry[]> {
      return repoService.listDirectory(repo, path, ref);
    },

    async getFileTree(ref?: string): Promise<string[]> {
      return repoService.getFileTree(repo, ref);
    },

    async fileExists(path: string, ref?: string): Promise<boolean> {
      return repoService.fileExists(repo, path, ref);
    },

    async getCommitDiff(sha: string): Promise<string> {
      return repoService.getCommitDiff(repo, sha);
    },

    isLocal(): boolean {
      return true;
    },

    getLocalPath(): string | undefined {
      return localPath;
    },
  };
}

/**
 * Create a UnifiedRepoAccess for a GitHub repository.
 */
export function createGitHubRepoAccess(
  repo: Repo,
  repoService: RepositoryService
): UnifiedRepoAccess {
  return {
    async getFileContent(path: string, ref?: string): Promise<string> {
      return repoService.getFileContent(repo, path, ref);
    },

    async listDirectory(path: string, ref?: string): Promise<FileEntry[]> {
      return repoService.listDirectory(repo, path, ref);
    },

    async getFileTree(ref?: string): Promise<string[]> {
      return repoService.getFileTree(repo, ref);
    },

    async fileExists(path: string, ref?: string): Promise<boolean> {
      return repoService.fileExists(repo, path, ref);
    },

    async getCommitDiff(sha: string): Promise<string> {
      return repoService.getCommitDiff(repo, sha);
    },

    isLocal(): boolean {
      return false;
    },

    getLocalPath(): string | undefined {
      return undefined;
    },
  };
}

/**
 * Dependencies for creating UnifiedRepoAccessFactory.
 */
export interface UnifiedRepoAccessFactoryDeps {
  repos: Repositories;
  repoServiceFactory?: RepositoryServiceFactory;
  gitService?: GitService;
}

/**
 * Create a factory for UnifiedRepoAccess instances.
 *
 * The factory handles:
 * - Looking up repo metadata
 * - Determining if repo is local or GitHub
 * - Authenticating GitHub access when user token is available
 */
export function createUnifiedRepoAccessFactory(
  deps: UnifiedRepoAccessFactoryDeps
): UnifiedRepoAccessFactory {
  const { repos, repoServiceFactory, gitService } = deps;

  return {
    async create(repoId: string): Promise<UnifiedRepoAccess> {
      // Look up the repository
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        throw new Error(`Repository not found: ${repoId}`);
      }

      // Get the appropriate repository service
      if (!repoServiceFactory) {
        throw new Error('RepositoryServiceFactory required for repository access');
      }

      let repoService: RepositoryService;

      if (repo.isGitHubRepo) {
        // For GitHub repos, try to use authenticated access if user has a token
        if (repo.userId) {
          const user = await repos.users.findById(repo.userId);
          if (user?.accessToken) {
            repoService = repoServiceFactory.getServiceWithToken(repo, user.accessToken);
          } else {
            repoService = repoServiceFactory.getService(repo);
          }
        } else {
          repoService = repoServiceFactory.getService(repo);
        }

        return createGitHubRepoAccess(repo, repoService);
      } else {
        // For local repos
        if (!gitService) {
          throw new Error('GitService required for local repository access');
        }

        repoService = repoServiceFactory.getService(repo);
        return createLocalRepoAccess(repo, repoService, gitService);
      }
    },
  };
}

// Re-export FileEntry for convenience
export type { FileEntry } from './repository-service.js';
