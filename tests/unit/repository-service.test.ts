/**
 * Unit tests for Unified Repository Service.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createRepositoryService,
  createRepositoryServiceFactory,
  type RepositoryService,
} from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';
import type { GitHubRepoService, DirectoryEntry, TreeEntry, RepoInfo } from '../../src/services/github/github-repo-service.js';
import type { GitService } from '../../src/services/git/git-service.js';
import type { Commit } from '../../src/domain/commit.js';

describe('Repository Service', () => {
  describe('createRepositoryService', () => {
    it('throws if GitHub repo without githubRepoService', () => {
      const repo: Repo = {
        id: 'repo-1',
        fullName: 'owner/repo',
        owner: 'owner',
        repoName: 'repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      assert.throws(
        () => createRepositoryService(repo, {}),
        /GitHub repo service required/
      );
    });

    it('throws if GitHub repo without owner/repoName', () => {
      const repo: Repo = {
        id: 'repo-1',
        fullName: 'owner/repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      const mockGitHubService = {} as GitHubRepoService;

      assert.throws(
        () => createRepositoryService(repo, { githubRepoService: mockGitHubService }),
        /GitHub repositories require owner and repoName/
      );
    });

    it('throws if local repo without gitService', () => {
      const repo: Repo = {
        id: 'repo-1',
        fullName: '/path/to/repo',
        isGitHubRepo: false,
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      assert.throws(
        () => createRepositoryService(repo, {}),
        /Git service required/
      );
    });
  });

  describe('GitHub Repository Service', () => {
    let service: RepositoryService;
    let mockGitHubService: GitHubRepoService;
    let callCounts: Record<string, number>;
    let repo: Repo;

    beforeEach(() => {
      callCounts = {
        listCommits: 0,
        getCommitDiff: 0,
        getFileContent: 0,
        getDirectoryContents: 0,
        getTree: 0,
        getDefaultBranch: 0,
      };

      mockGitHubService = {
        async getRepository(): Promise<RepoInfo> {
          return {
            id: 1,
            name: 'repo',
            fullName: 'owner/repo',
            defaultBranch: 'main',
            isPrivate: false,
            description: null,
          };
        },

        async listCommits(): Promise<Commit[]> {
          callCounts.listCommits++;
          return [{
            id: 'commit-1',
            repoId: 'repo-1',
            sha: 'abc123',
            message: 'Test commit',
            authorName: 'Test',
            authorEmail: 'test@example.com',
            committedAt: new Date(),
            diffSummary: {
              filesAdded: 1,
              filesModified: 0,
              filesDeleted: 0,
              linesAdded: 10,
              linesDeleted: 0,
              affectedFiles: ['file.ts'],
            },
          }];
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
          return [
            { name: 'file.ts', path: 'src/file.ts', type: 'file', size: 100, sha: 'sha1' },
            { name: 'utils', path: 'src/utils', type: 'dir', size: 0, sha: 'sha2' },
          ];
        },

        async getTree(): Promise<TreeEntry[]> {
          callCounts.getTree++;
          return [
            { path: 'src', mode: '040000', type: 'tree', sha: 'sha1' },
            { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'sha2', size: 100 },
            { path: 'src/utils/helper.ts', mode: '100644', type: 'blob', sha: 'sha3', size: 200 },
          ];
        },

        async getDefaultBranch(): Promise<string> {
          callCounts.getDefaultBranch++;
          return 'main';
        },
      };

      repo = {
        id: 'repo-1',
        fullName: 'owner/repo',
        owner: 'owner',
        repoName: 'repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      service = createRepositoryService(repo, { githubRepoService: mockGitHubService });
    });

    it('loadCommits delegates to GitHub service', async () => {
      const commits = await service.loadCommits(repo);

      assert.strictEqual(callCounts.listCommits, 1);
      assert.strictEqual(commits.length, 1);
      assert.strictEqual(commits[0].sha, 'abc123');
    });

    it('getCommitDiff delegates to GitHub service', async () => {
      const diff = await service.getCommitDiff(repo, 'sha123');

      assert.strictEqual(callCounts.getCommitDiff, 1);
      assert.strictEqual(diff, 'diff for sha123');
    });

    it('getFileContent delegates to GitHub service', async () => {
      const content = await service.getFileContent(repo, 'src/index.ts');

      assert.strictEqual(callCounts.getFileContent, 1);
      assert.strictEqual(content, 'content of src/index.ts');
    });

    it('listDirectory converts GitHub entries to FileEntry', async () => {
      const entries = await service.listDirectory(repo, 'src');

      assert.strictEqual(callCounts.getDirectoryContents, 1);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].name, 'file.ts');
      assert.strictEqual(entries[0].type, 'file');
      assert.strictEqual(entries[1].name, 'utils');
      assert.strictEqual(entries[1].type, 'dir');
    });

    it('getFileTree returns file paths from tree', async () => {
      const files = await service.getFileTree(repo);

      assert.strictEqual(callCounts.getTree, 1);
      assert.strictEqual(files.length, 2);
      assert.ok(files.includes('src/index.ts'));
      assert.ok(files.includes('src/utils/helper.ts'));
      // Should not include directories
      assert.ok(!files.includes('src'));
    });

    it('fileExists returns true for existing files', async () => {
      const exists = await service.fileExists(repo, 'src/index.ts');

      assert.strictEqual(exists, true);
    });

    it('fileExists returns false for missing files', async () => {
      mockGitHubService.getFileContent = async () => {
        throw new Error('Not found');
      };

      const exists = await service.fileExists(repo, 'nonexistent.ts');

      assert.strictEqual(exists, false);
    });

    it('getDefaultBranch returns branch name', async () => {
      const branch = await service.getDefaultBranch(repo);

      assert.strictEqual(branch, 'main');
    });
  });

  describe('RepositoryServiceFactory', () => {
    it('caches services by repo id', () => {
      const mockGitHubService = {
        async getRepository(): Promise<RepoInfo> {
          return { id: 1, name: 'repo', fullName: 'o/r', defaultBranch: 'main', isPrivate: false, description: null };
        },
        async listCommits(): Promise<Commit[]> { return []; },
        async getCommitDiff(): Promise<string> { return ''; },
        async getFileContent(): Promise<string> { return ''; },
        async getDirectoryContents(): Promise<DirectoryEntry[]> { return []; },
        async getTree(): Promise<TreeEntry[]> { return []; },
        async getDefaultBranch(): Promise<string> { return 'main'; },
      };

      const factory = createRepositoryServiceFactory({ githubRepoService: mockGitHubService });

      const repo: Repo = {
        id: 'repo-1',
        fullName: 'owner/repo',
        owner: 'owner',
        repoName: 'repo',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      const service1 = factory.getService(repo);
      const service2 = factory.getService(repo);

      assert.strictEqual(service1, service2);
    });

    it('creates different services for different repos', () => {
      const mockGitHubService = {
        async getRepository(): Promise<RepoInfo> {
          return { id: 1, name: 'repo', fullName: 'o/r', defaultBranch: 'main', isPrivate: false, description: null };
        },
        async listCommits(): Promise<Commit[]> { return []; },
        async getCommitDiff(): Promise<string> { return ''; },
        async getFileContent(): Promise<string> { return ''; },
        async getDirectoryContents(): Promise<DirectoryEntry[]> { return []; },
        async getTree(): Promise<TreeEntry[]> { return []; },
        async getDefaultBranch(): Promise<string> { return 'main'; },
      };

      const factory = createRepositoryServiceFactory({ githubRepoService: mockGitHubService });

      const repo1: Repo = {
        id: 'repo-1',
        fullName: 'owner/repo1',
        owner: 'owner',
        repoName: 'repo1',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo1.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      const repo2: Repo = {
        id: 'repo-2',
        fullName: 'owner/repo2',
        owner: 'owner',
        repoName: 'repo2',
        isGitHubRepo: true,
        cloneUrl: 'https://github.com/owner/repo2.git',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      const service1 = factory.getService(repo1);
      const service2 = factory.getService(repo2);

      assert.notStrictEqual(service1, service2);
    });
  });
});
