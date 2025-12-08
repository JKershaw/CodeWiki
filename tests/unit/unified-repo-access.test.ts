/**
 * Tests for UnifiedRepoAccess interface and implementations.
 *
 * This is the new abstraction that simplifies repository access by:
 * 1. Binding to a specific repo (no repo parameter needed on calls)
 * 2. Providing isLocal() and getLocalPath() for cases needing local access
 * 3. Hiding the GitHub vs local distinction from consumers
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  type UnifiedRepoAccess,
  createLocalRepoAccess,
  createGitHubRepoAccess,
  createUnifiedRepoAccessFactory,
  type UnifiedRepoAccessFactory,
} from '../../src/services/repository/unified-repo-access.js';
import type { RepositoryService, FileEntry } from '../../src/services/repository/repository-service.js';
import type { GitService } from '../../src/services/git/git-service.js';
import type { Repo } from '../../src/domain/repo.js';
import type { Repositories } from '../../src/repositories/index.js';

describe('UnifiedRepoAccess', () => {
  describe('interface contract', () => {
    it('defines all required methods', () => {
      // This test verifies the interface shape at compile time
      const mockAccess: UnifiedRepoAccess = {
        getFileContent: async () => 'content',
        listDirectory: async () => [],
        getFileTree: async () => [],
        fileExists: async () => true,
        getCommitDiff: async () => 'diff',
        isLocal: () => true,
        getLocalPath: () => '/path',
      };

      assert.ok(typeof mockAccess.getFileContent === 'function');
      assert.ok(typeof mockAccess.listDirectory === 'function');
      assert.ok(typeof mockAccess.getFileTree === 'function');
      assert.ok(typeof mockAccess.fileExists === 'function');
      assert.ok(typeof mockAccess.getCommitDiff === 'function');
      assert.ok(typeof mockAccess.isLocal === 'function');
      assert.ok(typeof mockAccess.getLocalPath === 'function');
    });
  });

  describe('createLocalRepoAccess', () => {
    let mockRepoService: RepositoryService;
    let mockGitService: Partial<GitService>;
    let localRepo: Repo;
    let access: UnifiedRepoAccess;

    beforeEach(() => {
      localRepo = {
        id: 'local-repo-1',
        fullName: '/path/to/repo',
        isGitHubRepo: false,
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
        status: 'ready',
        config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
        createdAt: new Date(),
        lastProcessedAt: null,
      };

      mockRepoService = {
        loadCommits: mock.fn(async () => []),
        getCommitDiff: mock.fn(async () => 'local diff'),
        getFileContent: mock.fn(async () => 'local content'),
        listDirectory: mock.fn(async () => [
          { name: 'file.ts', path: 'file.ts', type: 'file' as const, size: 100 },
        ]),
        getFileTree: mock.fn(async () => ['src/index.ts', 'package.json']),
        fileExists: mock.fn(async () => true),
        getDefaultBranch: mock.fn(async () => 'main'),
      };

      mockGitService = {
        getRepoPath: mock.fn(() => '/path/to/repo'),
      };

      access = createLocalRepoAccess(localRepo, mockRepoService, mockGitService as GitService);
    });

    it('getFileContent delegates to repoService', async () => {
      const content = await access.getFileContent('src/index.ts');

      assert.strictEqual(content, 'local content');
      assert.strictEqual((mockRepoService.getFileContent as any).mock.calls.length, 1);
      const call = (mockRepoService.getFileContent as any).mock.calls[0];
      assert.strictEqual(call.arguments[0], localRepo);
      assert.strictEqual(call.arguments[1], 'src/index.ts');
    });

    it('listDirectory delegates to repoService', async () => {
      const entries = await access.listDirectory('src');

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].name, 'file.ts');
    });

    it('getFileTree delegates to repoService', async () => {
      const files = await access.getFileTree();

      assert.deepStrictEqual(files, ['src/index.ts', 'package.json']);
    });

    it('fileExists delegates to repoService', async () => {
      const exists = await access.fileExists('src/index.ts');

      assert.strictEqual(exists, true);
    });

    it('getCommitDiff delegates to repoService', async () => {
      const diff = await access.getCommitDiff('abc123');

      assert.strictEqual(diff, 'local diff');
    });

    it('isLocal returns true', () => {
      assert.strictEqual(access.isLocal(), true);
    });

    it('getLocalPath returns the repo path', () => {
      assert.strictEqual(access.getLocalPath(), '/path/to/repo');
    });
  });

  describe('createGitHubRepoAccess', () => {
    let mockRepoService: RepositoryService;
    let githubRepo: Repo;
    let access: UnifiedRepoAccess;

    beforeEach(() => {
      githubRepo = {
        id: 'github-repo-1',
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

      mockRepoService = {
        loadCommits: mock.fn(async () => []),
        getCommitDiff: mock.fn(async () => 'github diff'),
        getFileContent: mock.fn(async () => 'github content'),
        listDirectory: mock.fn(async () => [
          { name: 'README.md', path: 'README.md', type: 'file' as const, size: 200 },
        ]),
        getFileTree: mock.fn(async () => ['README.md', 'src/main.ts']),
        fileExists: mock.fn(async () => false),
        getDefaultBranch: mock.fn(async () => 'main'),
      };

      access = createGitHubRepoAccess(githubRepo, mockRepoService);
    });

    it('getFileContent delegates to repoService', async () => {
      const content = await access.getFileContent('README.md');

      assert.strictEqual(content, 'github content');
      const call = (mockRepoService.getFileContent as any).mock.calls[0];
      assert.strictEqual(call.arguments[0], githubRepo);
      assert.strictEqual(call.arguments[1], 'README.md');
    });

    it('getFileContent passes ref parameter', async () => {
      await access.getFileContent('README.md', 'feature-branch');

      const call = (mockRepoService.getFileContent as any).mock.calls[0];
      assert.strictEqual(call.arguments[2], 'feature-branch');
    });

    it('listDirectory delegates to repoService', async () => {
      const entries = await access.listDirectory('.');

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].name, 'README.md');
    });

    it('getFileTree delegates to repoService', async () => {
      const files = await access.getFileTree();

      assert.deepStrictEqual(files, ['README.md', 'src/main.ts']);
    });

    it('fileExists delegates to repoService', async () => {
      const exists = await access.fileExists('nonexistent.ts');

      assert.strictEqual(exists, false);
    });

    it('getCommitDiff delegates to repoService', async () => {
      const diff = await access.getCommitDiff('def456');

      assert.strictEqual(diff, 'github diff');
    });

    it('isLocal returns false', () => {
      assert.strictEqual(access.isLocal(), false);
    });

    it('getLocalPath returns undefined', () => {
      assert.strictEqual(access.getLocalPath(), undefined);
    });
  });

  describe('createUnifiedRepoAccessFactory', () => {
    let mockRepos: Partial<Repositories>;
    let mockRepoServiceFactory: any;
    let mockGitService: Partial<GitService>;
    let factory: UnifiedRepoAccessFactory;

    const localRepo: Repo = {
      id: 'local-1',
      fullName: '/local/repo',
      isGitHubRepo: false,
      cloneUrl: '/local/repo',
      defaultBranch: 'main',
      status: 'ready',
      config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
      createdAt: new Date(),
      lastProcessedAt: null,
    };

    const githubRepo: Repo = {
      id: 'github-1',
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
      userId: 'user-1',
    };

    beforeEach(() => {
      mockRepos = {
        repos: {
          findById: mock.fn(async (id: string) => {
            if (id === 'local-1') return localRepo;
            if (id === 'github-1') return githubRepo;
            return null;
          }),
        } as any,
        users: {
          findById: mock.fn(async (id: string) => {
            if (id === 'user-1') return { accessToken: 'test-token' };
            return null;
          }),
        } as any,
      };

      const mockService: RepositoryService = {
        loadCommits: async () => [],
        getCommitDiff: async () => 'diff',
        getFileContent: async () => 'content',
        listDirectory: async () => [],
        getFileTree: async () => [],
        fileExists: async () => true,
        getDefaultBranch: async () => 'main',
      };

      mockRepoServiceFactory = {
        getService: mock.fn(() => mockService),
        getServiceWithToken: mock.fn(() => mockService),
      };

      mockGitService = {
        getRepoPath: mock.fn(() => '/local/repo'),
      };

      factory = createUnifiedRepoAccessFactory({
        repos: mockRepos as Repositories,
        repoServiceFactory: mockRepoServiceFactory,
        gitService: mockGitService as GitService,
      });
    });

    it('creates LocalRepoAccess for local repos', async () => {
      const access = await factory.create('local-1');

      assert.ok(access);
      assert.strictEqual(access.isLocal(), true);
      assert.strictEqual(access.getLocalPath(), '/local/repo');
    });

    it('creates GitHubRepoAccess for GitHub repos', async () => {
      const access = await factory.create('github-1');

      assert.ok(access);
      assert.strictEqual(access.isLocal(), false);
      assert.strictEqual(access.getLocalPath(), undefined);
    });

    it('uses authenticated service for GitHub repos with userId', async () => {
      await factory.create('github-1');

      assert.strictEqual((mockRepoServiceFactory.getServiceWithToken as any).mock.calls.length, 1);
      const call = (mockRepoServiceFactory.getServiceWithToken as any).mock.calls[0];
      assert.strictEqual(call.arguments[1], 'test-token');
    });

    it('falls back to unauthenticated service when no token', async () => {
      // Update mock to return user without token
      (mockRepos.users!.findById as any) = mock.fn(async () => ({ accessToken: undefined }));

      await factory.create('github-1');

      assert.strictEqual((mockRepoServiceFactory.getService as any).mock.calls.length, 1);
    });

    it('throws when repo not found', async () => {
      await assert.rejects(
        factory.create('nonexistent'),
        /Repository not found: nonexistent/
      );
    });

    it('throws when repoServiceFactory not available', async () => {
      const factoryWithoutRepoService = createUnifiedRepoAccessFactory({
        repos: mockRepos as Repositories,
        gitService: mockGitService as GitService,
      });

      await assert.rejects(
        factoryWithoutRepoService.create('github-1'),
        /RepositoryServiceFactory required/
      );
    });
  });
});
