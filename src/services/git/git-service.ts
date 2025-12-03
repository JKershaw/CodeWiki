import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import * as fs from 'fs';
import { join } from 'path';
import { mkdir, access, rm } from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { createPatch } from 'diff';
import type { Commit, DiffSummary } from '../../domain/commit.js';
import { createCommit } from '../../domain/commit.js';

/**
 * Authentication options for git operations.
 * Used for cloning and fetching from private repositories.
 */
export interface GitAuthOptions {
  /** Username for authentication (typically 'x-access-token' for GitHub) */
  username: string;
  /** Password or access token */
  password: string;
}

/**
 * Service for interacting with Git repositories.
 */
export interface GitService {
  /**
   * Register a local repository path for a repo ID.
   * Used when working with existing local repos instead of cloning.
   */
  registerLocalRepo(repoId: string, localPath: string): void;

  /**
   * Clone a repository to local storage.
   * @param repoUrl - URL of the repository to clone
   * @param repoId - Unique identifier for the repository
   * @param auth - Optional authentication credentials for private repositories
   */
  clone(repoUrl: string, repoId: string, auth?: GitAuthOptions): Promise<string>;

  /**
   * Get the path to a cloned repository.
   */
  getRepoPath(repoId: string): string;

  /**
   * Check if a repository is already cloned.
   */
  isCloned(repoId: string): Promise<boolean>;

  /**
   * Fetch latest changes for a cloned repository.
   * @param repoId - Unique identifier for the repository
   * @param auth - Optional authentication credentials for private repositories
   */
  fetch(repoId: string, auth?: GitAuthOptions): Promise<void>;

  /**
   * Load commits from a repository.
   */
  loadCommits(repoId: string, options?: {
    limit?: number;
    since?: Date;
    branch?: string;
  }): Promise<Commit[]>;

  /**
   * Get the diff for a specific commit.
   */
  getCommitDiff(repoId: string, sha: string): Promise<string>;

  /**
   * Get the full content of a file at a specific commit.
   */
  getFileAtCommit(repoId: string, sha: string, filePath: string): Promise<string | null>;

  /**
   * Delete a cloned repository.
   */
  deleteRepo(repoId: string): Promise<void>;
}

/**
 * File-system based Git service implementation using isomorphic-git.
 * This implementation does not require the git CLI to be installed.
 */
export class FileSystemGitService implements GitService {
  private readonly baseDir: string;
  private readonly localPaths: Map<string, string> = new Map();

  constructor(baseDir = '.codewiki-repos') {
    this.baseDir = baseDir;
  }

  registerLocalRepo(repoId: string, localPath: string): void {
    this.localPaths.set(repoId, localPath);
  }

  getRepoPath(repoId: string): string {
    const localPath = this.localPaths.get(repoId);
    if (localPath) {
      return localPath;
    }
    return join(this.baseDir, repoId);
  }

  async isCloned(repoId: string): Promise<boolean> {
    try {
      await access(join(this.getRepoPath(repoId), '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async clone(repoUrl: string, repoId: string, auth?: GitAuthOptions): Promise<string> {
    const repoPath = this.getRepoPath(repoId);

    await mkdir(this.baseDir, { recursive: true });

    if (await this.isCloned(repoId)) {
      await this.fetch(repoId, auth);
      return repoPath;
    }

    // Build clone options
    const cloneOptions: Parameters<typeof git.clone>[0] = {
      fs,
      http,
      dir: repoPath,
      url: repoUrl,
      singleBranch: false,
    };

    // Add authentication if provided
    if (auth) {
      cloneOptions.onAuth = () => ({
        username: auth.username,
        password: auth.password,
      });
    }

    await git.clone(cloneOptions);

    // Explicitly checkout to ensure working directory files are created
    // isomorphic-git clone with singleBranch: false may not checkout files
    try {
      await git.checkout({ fs, dir: repoPath, ref: 'HEAD' });
    } catch {
      // If HEAD checkout fails, try common default branches
      for (const branch of ['main', 'master']) {
        try {
          await git.checkout({ fs, dir: repoPath, ref: branch });
          break;
        } catch {
          // Continue to next branch
        }
      }
    }

    return repoPath;
  }

  async fetch(repoId: string, auth?: GitAuthOptions): Promise<void> {
    const repoPath = this.getRepoPath(repoId);
    try {
      // Build fetch options
      const fetchOptions: Parameters<typeof git.fetch>[0] = {
        fs,
        http,
        dir: repoPath,
      };

      // Add authentication if provided
      if (auth) {
        fetchOptions.onAuth = () => ({
          username: auth.username,
          password: auth.password,
        });
      }

      await git.fetch(fetchOptions);
    } catch {
      // Ignore fetch errors for local repos without remotes
    }
  }

  async loadCommits(repoId: string, options?: {
    limit?: number;
    since?: Date;
    branch?: string;
  }): Promise<Commit[]> {
    const repoPath = this.getRepoPath(repoId);

    // Get the ref to start from
    const ref = options?.branch || 'HEAD';

    // Get commit log
    const logEntries = await git.log({
      fs,
      dir: repoPath,
      ref,
      depth: options?.limit,
    });

    // Filter by date if since option provided
    let filteredEntries = logEntries;
    if (options?.since) {
      const sinceTime = options.since.getTime();
      filteredEntries = logEntries.filter(entry =>
        entry.commit.committer.timestamp * 1000 >= sinceTime
      );
    }

    const commits: Commit[] = [];

    for (const entry of filteredEntries) {
      const diffSummary = await this.getDiffSummary(repoPath, entry.oid);

      commits.push(createCommit({
        id: uuid(),
        repoId,
        sha: entry.oid,
        message: entry.commit.message,
        authorName: entry.commit.author.name,
        authorEmail: entry.commit.author.email,
        committedAt: new Date(entry.commit.committer.timestamp * 1000),
        diffSummary,
      }));
    }

    return commits;
  }

  private async getDiffSummary(repoPath: string, sha: string): Promise<DiffSummary> {
    try {
      const commit = await git.readCommit({ fs, dir: repoPath, oid: sha });
      const parentOid = commit.commit.parent[0];

      // Get trees for current and parent commits
      const currentTree = await this.getTreeEntries(repoPath, sha);
      const parentTree = parentOid
        ? await this.getTreeEntries(repoPath, parentOid)
        : new Map<string, string>();

      let filesAdded = 0;
      let filesModified = 0;
      let filesDeleted = 0;
      let linesAdded = 0;
      let linesDeleted = 0;
      const affectedFiles: string[] = [];

      // Find added and modified files
      for (const [path, oid] of currentTree) {
        const parentOidForPath = parentTree.get(path);
        if (!parentOidForPath) {
          filesAdded++;
          affectedFiles.push(path);
          // Count lines in new file
          const content = await this.readBlobContent(repoPath, oid);
          if (content) {
            linesAdded += content.split('\n').length;
          }
        } else if (parentOidForPath !== oid) {
          filesModified++;
          affectedFiles.push(path);
          // Count line changes
          const oldContent = await this.readBlobContent(repoPath, parentOidForPath);
          const newContent = await this.readBlobContent(repoPath, oid);
          if (oldContent !== null && newContent !== null) {
            const { added, deleted } = this.countLineDiffs(oldContent, newContent);
            linesAdded += added;
            linesDeleted += deleted;
          }
        }
      }

      // Find deleted files
      for (const [path] of parentTree) {
        if (!currentTree.has(path)) {
          filesDeleted++;
          affectedFiles.push(path);
          const parentOidForPath = parentTree.get(path);
          if (parentOidForPath) {
            const content = await this.readBlobContent(repoPath, parentOidForPath);
            if (content) {
              linesDeleted += content.split('\n').length;
            }
          }
        }
      }

      return {
        filesAdded,
        filesModified,
        filesDeleted,
        linesAdded,
        linesDeleted,
        affectedFiles,
      };
    } catch {
      return {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        linesAdded: 0,
        linesDeleted: 0,
        affectedFiles: [],
      };
    }
  }

  private async getTreeEntries(repoPath: string, commitOid: string): Promise<Map<string, string>> {
    const entries = new Map<string, string>();

    try {
      await git.walk({
        fs,
        dir: repoPath,
        trees: [git.TREE({ ref: commitOid })],
        map: async (filepath, [entry]) => {
          if (entry && filepath !== '.') {
            const type = await entry.type();
            if (type === 'blob') {
              const oid = await entry.oid();
              entries.set(filepath, oid);
            }
          }
          return undefined;
        },
      });
    } catch {
      // Return empty map on error
    }

    return entries;
  }

  private async readBlobContent(repoPath: string, oid: string): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid });
      return new TextDecoder().decode(blob);
    } catch {
      return null;
    }
  }

  private countLineDiffs(oldContent: string, newContent: string): { added: number; deleted: number } {
    // Count added and removed lines using diff library
    const patch = createPatch('file', oldContent, newContent);
    const lines = patch.split('\n');

    let added = 0;
    let deleted = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deleted++;
      }
    }

    return { added, deleted };
  }

  async getCommitDiff(repoId: string, sha: string): Promise<string> {
    const repoPath = this.getRepoPath(repoId);

    try {
      const commit = await git.readCommit({ fs, dir: repoPath, oid: sha });
      const parentOid = commit.commit.parent[0];

      const currentTree = await this.getTreeEntries(repoPath, sha);
      const parentTree = parentOid
        ? await this.getTreeEntries(repoPath, parentOid)
        : new Map<string, string>();

      const diffs: string[] = [];

      // Process modified and added files
      for (const [path, oid] of currentTree) {
        const parentOidForPath = parentTree.get(path);

        if (!parentOidForPath) {
          // New file
          const newContent = await this.readBlobContent(repoPath, oid) || '';
          const patch = createPatch(path, '', newContent, 'a/' + path, 'b/' + path);
          diffs.push(patch);
        } else if (parentOidForPath !== oid) {
          // Modified file
          const oldContent = await this.readBlobContent(repoPath, parentOidForPath) || '';
          const newContent = await this.readBlobContent(repoPath, oid) || '';
          const patch = createPatch(path, oldContent, newContent, 'a/' + path, 'b/' + path);
          diffs.push(patch);
        }
      }

      // Process deleted files
      for (const [path, oid] of parentTree) {
        if (!currentTree.has(path)) {
          const oldContent = await this.readBlobContent(repoPath, oid) || '';
          const patch = createPatch(path, oldContent, '', 'a/' + path, 'b/' + path);
          diffs.push(patch);
        }
      }

      return diffs.join('\n');
    } catch {
      // For errors (like initial commit issues), try to show all files
      try {
        const currentTree = await this.getTreeEntries(repoPath, sha);
        const diffs: string[] = [];

        for (const [path, oid] of currentTree) {
          const content = await this.readBlobContent(repoPath, oid) || '';
          const patch = createPatch(path, '', content, '/dev/null', 'b/' + path);
          diffs.push(patch);
        }

        return diffs.join('\n');
      } catch {
        return '';
      }
    }
  }

  async getFileAtCommit(repoId: string, sha: string, filePath: string): Promise<string | null> {
    const repoPath = this.getRepoPath(repoId);

    try {
      const { blob } = await git.readBlob({
        fs,
        dir: repoPath,
        oid: sha,
        filepath: filePath,
      });
      return new TextDecoder().decode(blob);
    } catch {
      return null;
    }
  }

  async deleteRepo(repoId: string): Promise<void> {
    const repoPath = this.getRepoPath(repoId);
    await rm(repoPath, { recursive: true, force: true });
  }
}

/**
 * Create the default Git service.
 */
export function createGitService(baseDir?: string): GitService {
  return new FileSystemGitService(baseDir);
}
