/**
 * Unit tests for Repository CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createRegisterRepositoryCommand,
  handleRegisterRepository,
  createLoadRepositoryCommitsCommand,
  handleLoadRepositoryCommits,
  createUpdateRepositoryStatusCommand,
  handleUpdateRepositoryStatus,
  createMarkCommitProcessedCommand,
  handleMarkCommitProcessed,
} from '../../src/commands/repository.js';
import { createRepo, type Repo, type RepoStatus } from '../../src/domain/repo.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { Commit, AgentProcessingRecord, DiffSummary } from '../../src/domain/commit.js';

// Helper to create a minimal diff summary for tests
function createTestDiffSummary(): DiffSummary {
  return {
    filesAdded: 0,
    filesModified: 1,
    filesDeleted: 0,
    linesAdded: 10,
    linesDeleted: 5,
    affectedFiles: ['test.ts'],
  };
}

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const repos = new Map<string, Repo>();
  const commits = new Map<string, Commit>();

  const mockRepos: Repositories['repos'] = {
    findById: async (id) => repos.get(id) ?? null,
    findByFullName: async (fullName) => {
      for (const repo of repos.values()) {
        if (repo.fullName === fullName) return repo;
      }
      return null;
    },
    findByStatus: async () => [],
    findAll: async () => Array.from(repos.values()),
    save: async (repo) => { repos.set(repo.id, repo); },
    delete: async (id) => { repos.delete(id); },
    updateStatus: async (id, status) => {
      const repo = repos.get(id);
      if (repo) repo.status = status;
    },
    updateLastProcessed: async (id, timestamp) => {
      const repo = repos.get(id);
      if (repo) repo.lastProcessedAt = timestamp;
    },
  };

  const mockCommits: Repositories['commits'] = {
    findById: async (id) => commits.get(id) ?? null,
    findBySha: async (repoId, sha) => {
      for (const commit of commits.values()) {
        if (commit.repoId === repoId && commit.sha === sha) return commit;
      }
      return null;
    },
    findByRepo: async () => [],
    findUnprocessedByAgent: async () => [],
    findByDateRange: async () => [],
    countByRepo: async () => commits.size,
    countProcessedByAgent: async () => 0,
    save: async (commit) => { commits.set(commit.id, commit); },
    saveMany: async (newCommits) => { newCommits.forEach(c => commits.set(c.id, c)); },
    deleteByRepo: async () => {},
    addProcessingRecord: async (commitId, record) => {
      const commit = commits.get(commitId);
      if (commit) {
        commit.processedBy.push(record);
      }
    },
  };

  return {
    repos: mockRepos,
    commits: mockCommits,
  } as Repositories;
}

describe('Repository Commands', () => {
  describe('RegisterRepository', () => {
    it('creates a new repository', async () => {
      const repos = createMockRepos();
      const repoId = uuid();

      const command = createRegisterRepositoryCommand({
        id: repoId,
        fullName: 'test/my-repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      const result = await handleRegisterRepository(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.id, repoId);
      assert.strictEqual(result.data.fullName, 'test/my-repo');
      assert.strictEqual(result.data.cloneUrl, '/path/to/repo');
      assert.strictEqual(result.data.defaultBranch, 'main');
      assert.strictEqual(result.data.status, 'pending');
    });

    it('fails when repository with same fullName exists', async () => {
      const repos = createMockRepos();

      // Create first repo
      const repo1 = createRepo({
        id: uuid(),
        fullName: 'test/existing-repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await repos.repos.save(repo1);

      // Try to create another with same fullName
      const command = createRegisterRepositoryCommand({
        id: uuid(),
        fullName: 'test/existing-repo',
        cloneUrl: '/another/path',
        defaultBranch: 'main',
      });
      const result = await handleRegisterRepository(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('already exists'));
    });

    it('has correct command type', () => {
      const command = createRegisterRepositoryCommand({
        id: 'repo-1',
        fullName: 'test/repo',
        cloneUrl: '/path',
        defaultBranch: 'main',
      });
      assert.strictEqual(command.type, 'RegisterRepository');
    });
  });

  describe('LoadRepositoryCommits', () => {
    it('saves multiple commits for a repository', async () => {
      const repos = createMockRepos();
      const repoId = uuid();

      // Create repo first
      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path',
        defaultBranch: 'main',
      });
      await repos.repos.save(repo);

      const commits: Commit[] = [
        {
          id: uuid(),
          repoId,
          sha: 'abc123',
          message: 'First commit',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          committedAt: new Date(),
          diffSummary: createTestDiffSummary(),
          processedBy: [],
          createdAt: new Date(),
        },
        {
          id: uuid(),
          repoId,
          sha: 'def456',
          message: 'Second commit',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          committedAt: new Date(),
          diffSummary: createTestDiffSummary(),
          processedBy: [],
          createdAt: new Date(),
        },
      ];

      const command = createLoadRepositoryCommitsCommand(repoId, commits);
      const result = await handleLoadRepositoryCommits(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 2);
    });

    it('fails when repository does not exist', async () => {
      const repos = createMockRepos();

      const command = createLoadRepositoryCommitsCommand('nonexistent', []);
      const result = await handleLoadRepositoryCommits(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('handles empty commit array', async () => {
      const repos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path',
        defaultBranch: 'main',
      });
      await repos.repos.save(repo);

      const command = createLoadRepositoryCommitsCommand(repoId, []);
      const result = await handleLoadRepositoryCommits(command, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 0);
    });

    it('has correct command type', () => {
      const command = createLoadRepositoryCommitsCommand('repo-1', []);
      assert.strictEqual(command.type, 'LoadRepositoryCommits');
    });
  });

  describe('UpdateRepositoryStatus', () => {
    it('updates repository status', async () => {
      const repos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path',
        defaultBranch: 'main',
      });
      await repos.repos.save(repo);

      const command = createUpdateRepositoryStatusCommand(repoId, 'processing');
      const result = await handleUpdateRepositoryStatus(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.repos.findById(repoId);
      assert.strictEqual(updated?.status, 'processing');
    });

    it('fails when repository does not exist', async () => {
      const repos = createMockRepos();

      const command = createUpdateRepositoryStatusCommand('nonexistent', 'ready');
      const result = await handleUpdateRepositoryStatus(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createUpdateRepositoryStatusCommand('repo-1', 'ready');
      assert.strictEqual(command.type, 'UpdateRepositoryStatus');
      assert.strictEqual(command.repoId, 'repo-1');
      assert.strictEqual(command.status, 'ready');
    });
  });

  describe('MarkCommitProcessed', () => {
    it('adds processing record to a commit', async () => {
      const repos = createMockRepos();
      const commitId = uuid();

      // Create commit first
      const commit: Commit = {
        id: commitId,
        repoId: uuid(),
        sha: 'abc123',
        message: 'Test commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: createTestDiffSummary(),
        processedBy: [],
        createdAt: new Date(),
      };
      await repos.commits.save(commit);

      const agentRunId = uuid();
      const command = createMarkCommitProcessedCommand(commitId, {
        agentType: 'code-change',
        agentRunId,
        processedAt: new Date(),
      });
      const result = await handleMarkCommitProcessed(command, repos);

      assert.strictEqual(result.success, true);

      const updated = await repos.commits.findById(commitId);
      assert.strictEqual(updated?.processedBy.length, 1);
      assert.strictEqual(updated?.processedBy[0]?.agentType, 'code-change');
      assert.strictEqual(updated?.processedBy[0]?.agentRunId, agentRunId);
    });

    it('fails when commit does not exist', async () => {
      const repos = createMockRepos();

      const command = createMarkCommitProcessedCommand('nonexistent', {
        agentType: 'code-change',
        agentRunId: uuid(),
        processedAt: new Date(),
      });
      const result = await handleMarkCommitProcessed(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createMarkCommitProcessedCommand('commit-1', {
        agentType: 'code-change',
        agentRunId: 'run-1',
        processedAt: new Date(),
      });
      assert.strictEqual(command.type, 'MarkCommitProcessed');
    });
  });
});
