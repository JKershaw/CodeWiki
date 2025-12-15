/**
 * GitHub Repository Service.
 *
 * Provides access to repository data via GitHub's REST API,
 * replacing the need for local git clones.
 */

import type { Commit, DiffSummary } from '../../domain/commit.js';
import { createCommit } from '../../domain/commit.js';
import { v4 as uuid } from 'uuid';

/**
 * GitHub API configuration.
 */
export interface GitHubApiConfig {
  /** GitHub API base URL (default: https://api.github.com) */
  baseUrl?: string;
  /** Access token for authentication */
  accessToken?: string;
}

/**
 * Options for listing commits.
 */
export interface CommitListOptions {
  /** Maximum number of commits to return */
  limit?: number;
  /** Only include commits after this date */
  since?: Date;
  /** Branch or commit SHA to start from */
  sha?: string;
  /** Only include commits affecting this path */
  path?: string;
}

/**
 * Directory entry from GitHub Contents API.
 */
export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
  sha: string;
}

/**
 * Tree entry from GitHub Git Trees API.
 */
export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

/**
 * Repository information.
 */
export interface RepoInfo {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
}

/**
 * GitHub Repository Service interface.
 */
export interface GitHubRepoService {
  /**
   * Get repository information.
   */
  getRepository(owner: string, repo: string): Promise<RepoInfo>;

  /**
   * List commits from a repository.
   */
  listCommits(owner: string, repo: string, repoId: string, options?: CommitListOptions): Promise<Commit[]>;

  /**
   * Get the unified diff for a specific commit.
   */
  getCommitDiff(owner: string, repo: string, sha: string): Promise<string>;

  /**
   * Get file content at a specific ref.
   */
  getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string>;

  /**
   * List directory contents at a specific ref.
   */
  getDirectoryContents(owner: string, repo: string, path: string, ref?: string): Promise<DirectoryEntry[]>;

  /**
   * Get the full tree for a commit (recursive file listing).
   */
  getTree(owner: string, repo: string, sha: string, recursive?: boolean): Promise<TreeEntry[]>;

  /**
   * Get the default branch for a repository.
   */
  getDefaultBranch(owner: string, repo: string): Promise<string>;
}

/**
 * Parse a GitHub URL into owner and repo components.
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;

    const pathMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(\.git)?$/);
    if (!pathMatch) return null;

    return {
      owner: pathMatch[1]!,
      repo: pathMatch[2]!,
    };
  } catch {
    return null;
  }
}

/**
 * Create a GitHub Repository Service instance.
 */
export function createGitHubRepoService(config: GitHubApiConfig = {}): GitHubRepoService {
  const baseUrl = config.baseUrl ?? 'https://api.github.com';
  const accessToken = config.accessToken;

  /**
   * Make an authenticated request to the GitHub API.
   */
  async function fetchGitHub(
    endpoint: string,
    options: {
      accept?: string;
      method?: string;
    } = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Accept': options.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method ?? 'GET',
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(
        `GitHub API error (${response.status}): ${error.message || response.statusText}`
      );
    }

    return response;
  }

  /**
   * Fetch JSON from GitHub API.
   */
  async function fetchJson<T>(endpoint: string): Promise<T> {
    const response = await fetchGitHub(endpoint);
    return response.json() as Promise<T>;
  }

  /**
   * Fetch raw content from GitHub API.
   */
  async function fetchRaw(endpoint: string): Promise<string> {
    const response = await fetchGitHub(endpoint, {
      accept: 'application/vnd.github.raw+json',
    });
    return response.text();
  }

  /**
   * Fetch diff from GitHub API.
   */
  async function fetchDiff(endpoint: string): Promise<string> {
    const response = await fetchGitHub(endpoint, {
      accept: 'application/vnd.github.diff',
    });
    return response.text();
  }

  return {
    async getRepository(owner: string, repo: string): Promise<RepoInfo> {
      const data = await fetchJson<{
        id: number;
        name: string;
        full_name: string;
        default_branch: string;
        private: boolean;
        description: string | null;
      }>(`/repos/${owner}/${repo}`);

      return {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        isPrivate: data.private,
        description: data.description,
      };
    },

    async listCommits(
      owner: string,
      repo: string,
      repoId: string,
      options: CommitListOptions = {}
    ): Promise<Commit[]> {
      const params = new URLSearchParams();

      if (options.limit) {
        params.set('per_page', String(Math.min(options.limit, 100)));
      } else {
        params.set('per_page', '100');
      }

      if (options.since) {
        params.set('since', options.since.toISOString());
      }

      if (options.sha) {
        params.set('sha', options.sha);
      }

      if (options.path) {
        params.set('path', options.path);
      }

      const commits: Commit[] = [];
      let page = 1;
      const limit = options.limit ?? Infinity;

      while (commits.length < limit) {
        params.set('page', String(page));

        const data = await fetchJson<Array<{
          sha: string;
          commit: {
            message: string;
            author: {
              name: string;
              email: string;
              date: string;
            };
            committer: {
              date: string;
            };
          };
          stats?: {
            additions: number;
            deletions: number;
          };
          files?: Array<{
            filename: string;
            status: string;
            additions: number;
            deletions: number;
          }>;
        }>>(`/repos/${owner}/${repo}/commits?${params.toString()}`);

        if (data.length === 0) break;

        for (const item of data) {
          if (commits.length >= limit) break;

          // Build diff summary from commit data
          const diffSummary: DiffSummary = {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            linesAdded: item.stats?.additions ?? 0,
            linesDeleted: item.stats?.deletions ?? 0,
            affectedFiles: [],
          };

          if (item.files) {
            for (const file of item.files) {
              diffSummary.affectedFiles.push(file.filename);
              if (file.status === 'added') {
                diffSummary.filesAdded++;
              } else if (file.status === 'removed') {
                diffSummary.filesDeleted++;
              } else {
                diffSummary.filesModified++;
              }
            }
          }

          commits.push(createCommit({
            id: uuid(),
            repoId,
            sha: item.sha,
            message: item.commit.message,
            authorName: item.commit.author.name,
            authorEmail: item.commit.author.email,
            committedAt: new Date(item.commit.committer.date),
            diffSummary,
          }));
        }

        // Check if there are more pages
        if (data.length < 100) break;
        page++;
      }

      return commits;
    },

    async getCommitDiff(owner: string, repo: string, sha: string): Promise<string> {
      return fetchDiff(`/repos/${owner}/${repo}/commits/${sha}`);
    },

    async getFileContent(
      owner: string,
      repo: string,
      path: string,
      ref?: string
    ): Promise<string> {
      const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return fetchRaw(`/repos/${owner}/${repo}/contents/${path}${params}`);
    },

    async getDirectoryContents(
      owner: string,
      repo: string,
      path: string,
      ref?: string
    ): Promise<DirectoryEntry[]> {
      const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const data = await fetchJson<Array<{
        name: string;
        path: string;
        type: 'file' | 'dir' | 'symlink' | 'submodule';
        size: number;
        sha: string;
      }>>(`/repos/${owner}/${repo}/contents/${path}${params}`);

      return data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
      }));
    },

    async getTree(
      owner: string,
      repo: string,
      sha: string,
      recursive = true
    ): Promise<TreeEntry[]> {
      const params = recursive ? '?recursive=1' : '';
      const data = await fetchJson<{
        sha: string;
        tree: Array<{
          path: string;
          mode: string;
          type: 'blob' | 'tree';
          sha: string;
          size?: number;
        }>;
        truncated: boolean;
      }>(`/repos/${owner}/${repo}/git/trees/${sha}${params}`);

      if (data.truncated) {
        throw new Error(
          `GitHub tree API returned truncated data for ${owner}/${repo}. ` +
          `Repository has too many files for recursive tree listing. ` +
          `Consider using directory-by-directory traversal instead.`
        );
      }

      return data.tree.map(item => ({
        path: item.path,
        mode: item.mode,
        type: item.type,
        sha: item.sha,
        ...(item.size !== undefined && { size: item.size }),
      }));
    },

    async getDefaultBranch(owner: string, repo: string): Promise<string> {
      const repoInfo = await this.getRepository(owner, repo);
      return repoInfo.defaultBranch;
    },
  };
}

/**
 * Create a GitHub Repository Service with authentication from a user's token.
 */
export function createAuthenticatedGitHubRepoService(accessToken: string): GitHubRepoService {
  return createGitHubRepoService({ accessToken });
}
