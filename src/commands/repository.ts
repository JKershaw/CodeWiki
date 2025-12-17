/**
 * CQRS Commands for Repository operations.
 *
 * These commands handle all repository and commit state changes,
 * providing a clean boundary for repository management.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import { createRepo, type Repo, type RepoStatus } from '../domain/repo.js';
import type { Commit, AgentProcessingRecord } from '../domain/commit.js';
import type { Wiki } from '../domain/wiki.js';

// ============================================================================
// RegisterRepository Command
// ============================================================================

/**
 * Command to register a new repository in the system.
 */
export interface RegisterRepositoryCommand extends Command {
  readonly type: 'RegisterRepository';
  readonly id: string;
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  /** GitHub owner (e.g., "anthropics") - required for GitHub repos */
  readonly owner?: string;
  /** GitHub repo name (e.g., "codewiki") - required for GitHub repos */
  readonly repoName?: string;
  /** Whether this is a GitHub repository (vs local filesystem) */
  readonly isGitHubRepo?: boolean;
  /** User ID who added this repo (for GitHub auth) */
  readonly userId?: string;
}

export function createRegisterRepositoryCommand(params: {
  id: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  owner?: string;
  repoName?: string;
  isGitHubRepo?: boolean;
  userId?: string;
}): RegisterRepositoryCommand {
  return {
    type: 'RegisterRepository',
    ...params,
  };
}

/**
 * Handler for RegisterRepository command.
 * Creates a new repository with 'pending' status.
 */
export async function handleRegisterRepository(
  command: RegisterRepositoryCommand,
  repos: Repositories
): Promise<CommandResult<Repo>> {
  try {
    // Check if repository with same fullName already exists
    const existing = await repos.repos.findByFullName(command.fullName);
    if (existing) {
      return failure(`Repository with name '${command.fullName}' already exists`);
    }

    const repo = createRepo({
      id: command.id,
      fullName: command.fullName,
      cloneUrl: command.cloneUrl,
      defaultBranch: command.defaultBranch,
      ...(command.owner && { owner: command.owner }),
      ...(command.repoName && { repoName: command.repoName }),
      ...(command.isGitHubRepo !== undefined && { isGitHubRepo: command.isGitHubRepo }),
      ...(command.userId && { userId: command.userId }),
    });

    await repos.repos.save(repo);
    return success(repo);
  } catch (error) {
    return failure(`Failed to register repository: ${error}`);
  }
}

// ============================================================================
// LoadRepositoryCommits Command
// ============================================================================

/**
 * Command to load commits into a repository.
 */
export interface LoadRepositoryCommitsCommand extends Command {
  readonly type: 'LoadRepositoryCommits';
  readonly repoId: string;
  readonly commits: Commit[];
}

export function createLoadRepositoryCommitsCommand(
  repoId: string,
  commits: Commit[]
): LoadRepositoryCommitsCommand {
  return {
    type: 'LoadRepositoryCommits',
    repoId,
    commits,
  };
}

/**
 * Handler for LoadRepositoryCommits command.
 * Saves multiple commits for a repository.
 */
export async function handleLoadRepositoryCommits(
  command: LoadRepositoryCommitsCommand,
  repos: Repositories
): Promise<CommandResult<number>> {
  try {
    // Verify repository exists
    const repo = await repos.repos.findById(command.repoId);
    if (!repo) {
      return failure(`Repository not found: ${command.repoId}`);
    }

    if (command.commits.length > 0) {
      await repos.commits.saveMany(command.commits);
    }

    return success(command.commits.length);
  } catch (error) {
    return failure(`Failed to load repository commits: ${error}`);
  }
}

// ============================================================================
// UpdateRepositoryStatus Command
// ============================================================================

/**
 * Command to update a repository's status.
 */
export interface UpdateRepositoryStatusCommand extends Command {
  readonly type: 'UpdateRepositoryStatus';
  readonly repoId: string;
  readonly status: RepoStatus;
}

export function createUpdateRepositoryStatusCommand(
  repoId: string,
  status: RepoStatus
): UpdateRepositoryStatusCommand {
  return {
    type: 'UpdateRepositoryStatus',
    repoId,
    status,
  };
}

/**
 * Handler for UpdateRepositoryStatus command.
 */
export async function handleUpdateRepositoryStatus(
  command: UpdateRepositoryStatusCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify repository exists
    const repo = await repos.repos.findById(command.repoId);
    if (!repo) {
      return failure(`Repository not found: ${command.repoId}`);
    }

    await repos.repos.updateStatus(command.repoId, command.status);
    return success();
  } catch (error) {
    return failure(`Failed to update repository status: ${error}`);
  }
}

// ============================================================================
// MarkCommitProcessed Command
// ============================================================================

/**
 * Command to mark a commit as processed by an agent.
 */
export interface MarkCommitProcessedCommand extends Command {
  readonly type: 'MarkCommitProcessed';
  readonly commitId: string;
  readonly record: AgentProcessingRecord;
}

export function createMarkCommitProcessedCommand(
  commitId: string,
  record: AgentProcessingRecord
): MarkCommitProcessedCommand {
  return {
    type: 'MarkCommitProcessed',
    commitId,
    record,
  };
}

/**
 * Handler for MarkCommitProcessed command.
 * Adds a processing record to a commit.
 */
export async function handleMarkCommitProcessed(
  command: MarkCommitProcessedCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify commit exists
    const commit = await repos.commits.findById(command.commitId);
    if (!commit) {
      return failure(`Commit not found: ${command.commitId}`);
    }

    await repos.commits.addProcessingRecord(command.commitId, command.record);
    return success();
  } catch (error) {
    return failure(`Failed to mark commit processed: ${error}`);
  }
}

// ============================================================================
// DeleteRepository Command
// ============================================================================

/**
 * Command to delete a repository and all its associated data.
 */
export interface DeleteRepositoryCommand extends Command {
  readonly type: 'DeleteRepository';
  readonly repoId: string;
}

export function createDeleteRepositoryCommand(repoId: string): DeleteRepositoryCommand {
  return {
    type: 'DeleteRepository',
    repoId,
  };
}

/**
 * Handler for DeleteRepository command.
 * Deletes a repository and cascades deletion to all related data:
 * - Wiki pages, findings, edit requests, conflicts (per wiki)
 * - Wikis, commits, agent runs, processing runs
 * - Benchmarks, quality benchmarks, chat sessions
 * - Learnings, work queue items, self-improvements
 */
export async function handleDeleteRepository(
  command: DeleteRepositoryCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    // Verify repository exists
    const repo = await repos.repos.findById(command.repoId);
    if (!repo) {
      return failure(`Repository not found: ${command.repoId}`);
    }

    // Get all wikis for this repo to cascade delete wiki-specific data
    const wikis: Wiki[] = await repos.wikis.findByRepo(command.repoId);

    // Delete wiki-specific data for each wiki
    for (const wiki of wikis) {
      // Delete wiki pages
      await repos.wikiPages.deleteByWiki(wiki.id);
      // Delete findings
      await repos.findings.deleteByWiki(wiki.id);
      // Delete conflicts
      await repos.conflicts.deleteByWiki(wiki.id);
    }

    // Delete repo-level data (order matters for foreign key-like relationships)
    await repos.wikis.deleteByRepo(command.repoId);
    await repos.commits.deleteByRepo(command.repoId);
    await repos.agentRuns.deleteByRepo(command.repoId);
    await repos.processingRuns.deleteByRepo(command.repoId);
    await repos.benchmarks.deleteByRepo(command.repoId);
    await repos.qualityBenchmarks.deleteByRepo(command.repoId);
    await repos.chatSessions.deleteByRepo(command.repoId);
    await repos.learnings.deleteByRepo(command.repoId);
    await repos.workQueue.deleteByRepo(command.repoId);
    await repos.selfImprovements.deleteByRepo(command.repoId);

    // Finally, delete the repository itself
    await repos.repos.delete(command.repoId);

    return success();
  } catch (error) {
    return failure(`Failed to delete repository: ${error}`);
  }
}
