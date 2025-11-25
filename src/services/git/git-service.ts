import { simpleGit, type SimpleGit, type LogResult, type DefaultLogFields } from 'simple-git';
import { join } from 'path';
import { mkdir, access, rm } from 'fs/promises';
import { v4 as uuid } from 'uuid';
import type { Commit, DiffSummary } from '../../domain/commit.js';
import { createCommit } from '../../domain/commit.js';

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
   */
  clone(repoUrl: string, repoId: string): Promise<string>;

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
   */
  fetch(repoId: string): Promise<void>;

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
 * File-system based Git service implementation.
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
    // Check for registered local path first
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

  async clone(repoUrl: string, repoId: string): Promise<string> {
    const repoPath = this.getRepoPath(repoId);

    // Create base directory if needed
    await mkdir(this.baseDir, { recursive: true });

    // Check if already cloned
    if (await this.isCloned(repoId)) {
      // Just fetch latest
      await this.fetch(repoId);
      return repoPath;
    }

    // Clone the repository
    const git = simpleGit();
    await git.clone(repoUrl, repoPath);

    return repoPath;
  }

  async fetch(repoId: string): Promise<void> {
    const repoPath = this.getRepoPath(repoId);
    const git = simpleGit(repoPath);
    await git.fetch();
  }

  async loadCommits(repoId: string, options?: {
    limit?: number;
    since?: Date;
    branch?: string;
  }): Promise<Commit[]> {
    const repoPath = this.getRepoPath(repoId);
    const git = simpleGit(repoPath);

    // Build log options
    const logOptions: string[] = [];

    if (options?.limit) {
      logOptions.push(`-n`, `${options.limit}`);
    }

    if (options?.since) {
      logOptions.push(`--since="${options.since.toISOString()}"`);
    }

    if (options?.branch) {
      logOptions.push(options.branch);
    }

    // Get commit log
    const log = await git.log(logOptions);

    // Convert to domain commits
    const commits: Commit[] = [];

    for (const entry of log.all) {
      const diffSummary = await this.getDiffSummary(git, entry.hash);

      commits.push(createCommit({
        id: uuid(),
        repoId,
        sha: entry.hash,
        message: entry.message,
        authorName: entry.author_name,
        authorEmail: entry.author_email,
        committedAt: new Date(entry.date),
        diffSummary,
      }));
    }

    return commits;
  }

  private async getDiffSummary(git: SimpleGit, sha: string): Promise<DiffSummary> {
    try {
      // Get diff stat for this commit
      const diffStat = await git.diff([`${sha}^`, sha, '--stat', '--stat-width=1000']);
      const diffFiles = await git.diff([`${sha}^`, sha, '--name-status']);

      const lines = diffFiles.trim().split('\n').filter(l => l.length > 0);

      let filesAdded = 0;
      let filesModified = 0;
      let filesDeleted = 0;
      const affectedFiles: string[] = [];

      for (const line of lines) {
        const [status, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t'); // Handle paths with tabs

        if (filePath) {
          affectedFiles.push(filePath);
        }

        switch (status?.[0]) {
          case 'A':
            filesAdded++;
            break;
          case 'D':
            filesDeleted++;
            break;
          case 'M':
          case 'R':
          case 'C':
            filesModified++;
            break;
        }
      }

      // Parse lines added/deleted from stat
      const statMatch = diffStat.match(/(\d+) insertions?\(\+\)/);
      const delMatch = diffStat.match(/(\d+) deletions?\(-\)/);

      const linesAdded = statMatch ? parseInt(statMatch[1]!, 10) : 0;
      const linesDeleted = delMatch ? parseInt(delMatch[1]!, 10) : 0;

      return {
        filesAdded,
        filesModified,
        filesDeleted,
        linesAdded,
        linesDeleted,
        affectedFiles,
      };
    } catch {
      // For initial commits or errors, return empty summary
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

  async getCommitDiff(repoId: string, sha: string): Promise<string> {
    const repoPath = this.getRepoPath(repoId);
    const git = simpleGit(repoPath);

    try {
      // Get the full diff for this commit
      const diff = await git.diff([`${sha}^`, sha]);
      return diff;
    } catch {
      // For initial commit, show all files as added
      const diff = await git.show([sha, '--format=']);
      return diff;
    }
  }

  async getFileAtCommit(repoId: string, sha: string, filePath: string): Promise<string | null> {
    const repoPath = this.getRepoPath(repoId);
    const git = simpleGit(repoPath);

    try {
      const content = await git.show([`${sha}:${filePath}`]);
      return content;
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
