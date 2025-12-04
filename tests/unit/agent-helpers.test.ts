/**
 * Tests for agent-helpers module.
 *
 * Tests the unified helper functions that allow agents to work with
 * both local repositories and GitHub API-based access.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  getCommitDiff,
  isLocalRepo,
  getLocalRepoPath,
  createCodebaseToolExecutor,
} from '../../src/agents/agent-helpers.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { GitService } from '../../src/services/git/git-service.js';
import type { RepositoryService } from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';

describe('agent-helpers', () => {
  describe('getCommitDiff', () => {
    it('uses repoService when available', async () => {
      const mockRepoService: Partial<RepositoryService> = {
        getCommitDiff: mock.fn(async () => 'diff from repoService'),
      };

      const mockRepo: Partial<Repo> = {
        id: 'repo-1',
        isGitHubRepo: true,
      };

      const mockGit: Partial<GitService> = {
        getCommitDiff: mock.fn(async () => 'diff from git'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        repo: mockRepo as Repo,
      };

      const diff = await getCommitDiff(context, 'abc123');

      assert.strictEqual(diff, 'diff from repoService');
      assert.strictEqual((mockRepoService.getCommitDiff as any).mock.calls.length, 1);
      assert.strictEqual((mockGit.getCommitDiff as any).mock.calls.length, 0);
    });

    it('falls back to git service when repoService not available', async () => {
      const mockGit: Partial<GitService> = {
        getCommitDiff: mock.fn(async () => 'diff from git'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
      };

      const diff = await getCommitDiff(context, 'abc123');

      assert.strictEqual(diff, 'diff from git');
      assert.strictEqual((mockGit.getCommitDiff as any).mock.calls.length, 1);
    });

    it('falls back to git service when repo not available', async () => {
      const mockRepoService: Partial<RepositoryService> = {
        getCommitDiff: mock.fn(async () => 'diff from repoService'),
      };

      const mockGit: Partial<GitService> = {
        getCommitDiff: mock.fn(async () => 'diff from git'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        // No repo provided
      };

      const diff = await getCommitDiff(context, 'abc123');

      assert.strictEqual(diff, 'diff from git');
      assert.strictEqual((mockGit.getCommitDiff as any).mock.calls.length, 1);
      assert.strictEqual((mockRepoService.getCommitDiff as any).mock.calls.length, 0);
    });
  });

  describe('isLocalRepo', () => {
    it('returns true when repo is not a GitHub repo', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repo: { isGitHubRepo: false } as Repo,
      };

      assert.strictEqual(isLocalRepo(context), true);
    });

    it('returns true when isGitHubRepo is undefined', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repo: {} as Repo,
      };

      assert.strictEqual(isLocalRepo(context), true);
    });

    it('returns false when repo is a GitHub repo', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repo: { isGitHubRepo: true } as Repo,
      };

      assert.strictEqual(isLocalRepo(context), false);
    });

    it('returns true when repo is not provided', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
      };

      assert.strictEqual(isLocalRepo(context), true);
    });
  });

  describe('getLocalRepoPath', () => {
    it('returns path from git service for local repos', () => {
      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => '/path/to/repo'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repo: { isGitHubRepo: false } as Repo,
      };

      const path = getLocalRepoPath(context);

      assert.strictEqual(path, '/path/to/repo');
    });

    it('returns undefined for GitHub repos', () => {
      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => '/path/to/repo'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repo: { isGitHubRepo: true } as Repo,
      };

      const path = getLocalRepoPath(context);

      assert.strictEqual(path, undefined);
      assert.strictEqual((mockGit.getRepoPath as any).mock.calls.length, 0);
    });

    it('returns undefined when getRepoPath throws', () => {
      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repo: { isGitHubRepo: false } as Repo,
      };

      const path = getLocalRepoPath(context);

      assert.strictEqual(path, undefined);
    });
  });

  describe('createCodebaseToolExecutor', () => {
    it('returns null when no tools available', () => {
      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        // No repoService or repo
      };

      const executor = createCodebaseToolExecutor(context);

      assert.strictEqual(executor, null);
    });

    it('returns filesystem tools for local repos', () => {
      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => '/path/to/repo'),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repo: { isGitHubRepo: false } as Repo,
      };

      const executor = createCodebaseToolExecutor(context);

      assert.notStrictEqual(executor, null);
      assert.ok(Array.isArray(executor?.tools));
      assert.ok(executor?.tools.length > 0);
      assert.ok(typeof executor?.executeTools === 'function');

      // Check that standard codebase tools are available
      const toolNames = executor?.tools.map(t => t.name);
      assert.ok(toolNames?.includes('read_file'));
      assert.ok(toolNames?.includes('list_directory'));
      assert.ok(toolNames?.includes('search_files'));
    });

    it('returns API tools for GitHub repos', () => {
      const mockRepoService: Partial<RepositoryService> = {
        getFileContent: mock.fn(async () => 'file content'),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        repo: { isGitHubRepo: true } as Repo,
      };

      const executor = createCodebaseToolExecutor(context);

      assert.notStrictEqual(executor, null);
      assert.ok(Array.isArray(executor?.tools));
      assert.ok(executor?.tools.length > 0);

      // Check that API-based tools are available
      const toolNames = executor?.tools.map(t => t.name);
      assert.ok(toolNames?.includes('read_file'));
      assert.ok(toolNames?.includes('list_directory'));
      assert.ok(toolNames?.includes('search_files'));
    });

    it('API tools execute correctly', async () => {
      const mockRepoService: Partial<RepositoryService> = {
        getFileContent: mock.fn(async () => 'file content from API'),
        listDirectory: mock.fn(async () => [
          { name: 'file1.ts', path: 'file1.ts', type: 'file' as const, size: 100 },
          { name: 'dir1', path: 'dir1', type: 'dir' as const, size: 0 },
        ]),
        getFileTree: mock.fn(async () => ['src/index.ts', 'src/utils.ts', 'package.json']),
      };

      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        repo: { isGitHubRepo: true } as Repo,
      };

      const executor = createCodebaseToolExecutor(context);
      assert.ok(executor);

      // Test read_file tool
      const readResults = await executor.executeTools([
        { id: '1', name: 'read_file', input: { path: 'src/index.ts' } },
      ]);
      assert.strictEqual(readResults[0].result, 'file content from API');

      // Test list_directory tool
      const listResults = await executor.executeTools([
        { id: '2', name: 'list_directory', input: { path: '.' } },
      ]);
      assert.ok(listResults[0].result.includes('file1.ts'));
      assert.ok(listResults[0].result.includes('dir1/'));

      // Test search_files tool
      const searchResults = await executor.executeTools([
        { id: '3', name: 'search_files', input: { pattern: '**/*.ts' } },
      ]);
      assert.ok(searchResults[0].result.includes('src/index.ts'));
      assert.ok(searchResults[0].result.includes('src/utils.ts'));
    });

    it('handles unknown tool gracefully', async () => {
      const mockRepoService: Partial<RepositoryService> = {
        getFileContent: mock.fn(async () => 'content'),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        repo: { isGitHubRepo: true } as Repo,
      };

      const executor = createCodebaseToolExecutor(context);
      assert.ok(executor);

      const results = await executor.executeTools([
        { id: '1', name: 'unknown_tool', input: {} },
      ]);

      assert.ok(results[0].result.includes('Error'));
      assert.ok(results[0].result.includes('unknown_tool'));
    });

    it('handles API errors gracefully', async () => {
      const mockRepoService: Partial<RepositoryService> = {
        getFileContent: mock.fn(async () => {
          throw new Error('File not found');
        }),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const mockGit: Partial<GitService> = {
        getRepoPath: mock.fn(() => {
          throw new Error('Repo not registered');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: mockGit as GitService,
        llm: {} as any,
        repoService: mockRepoService as RepositoryService,
        repo: { isGitHubRepo: true } as Repo,
      };

      const executor = createCodebaseToolExecutor(context);
      assert.ok(executor);

      const results = await executor.executeTools([
        { id: '1', name: 'read_file', input: { path: 'nonexistent.ts' } },
      ]);

      assert.ok(results[0].result.includes('Error'));
      assert.ok(results[0].result.includes('File not found'));
    });
  });
});
