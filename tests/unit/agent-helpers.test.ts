/**
 * Tests for agent-helpers module.
 *
 * Tests the unified helper functions that allow agents to work with
 * both local repositories and GitHub API-based access via UnifiedRepoAccess.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  getCommitDiff,
  isLocalRepo,
  getLocalRepoPath,
  createCodebaseToolExecutor,
  fetchAffectedFileContents,
} from '../../src/agents/agent-helpers.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';

describe('agent-helpers', () => {
  describe('getCommitDiff', () => {
    it('uses repoAccess to get commit diff', async () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        getCommitDiff: mock.fn(async () => 'diff from repoAccess'),
        isLocal: () => false,
        getLocalPath: () => undefined,
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const diff = await getCommitDiff(context, 'abc123');

      assert.strictEqual(diff, 'diff from repoAccess');
      assert.strictEqual((mockRepoAccess.getCommitDiff as any).mock.calls.length, 1);
    });

    it('throws when repoAccess is not available', async () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        // No repoAccess
      };

      await assert.rejects(
        async () => getCommitDiff(context, 'abc123'),
        /repoAccess is required/
      );
    });
  });

  describe('isLocalRepo', () => {
    it('returns true when repoAccess.isLocal returns true', () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => true,
        getLocalPath: () => '/path/to/repo',
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      assert.strictEqual(isLocalRepo(context), true);
    });

    it('returns false when repoAccess.isLocal returns false', () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      assert.strictEqual(isLocalRepo(context), false);
    });

    it('throws when repoAccess is not available', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        // No repoAccess
      };

      assert.throws(
        () => isLocalRepo(context),
        /repoAccess is required/
      );
    });
  });

  describe('getLocalRepoPath', () => {
    it('returns path from repoAccess.getLocalPath', () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => true,
        getLocalPath: () => '/unified/path/to/repo',
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const path = getLocalRepoPath(context);
      assert.strictEqual(path, '/unified/path/to/repo');
    });

    it('returns undefined for GitHub repos', () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const path = getLocalRepoPath(context);
      assert.strictEqual(path, undefined);
    });

    it('throws when repoAccess is not available', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        // No repoAccess
      };

      assert.throws(
        () => getLocalRepoPath(context),
        /repoAccess is required/
      );
    });
  });

  describe('createCodebaseToolExecutor', () => {
    it('returns null when repoAccess is not available', () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        // No repoAccess
      };

      const executor = createCodebaseToolExecutor(context);
      assert.strictEqual(executor, null);
    });

    it('returns filesystem tools for local repos', () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => true,
        getLocalPath: () => '/path/to/repo',
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
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
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => 'file content'),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
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
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => 'file content from API'),
        listDirectory: mock.fn(async () => [
          { name: 'file1.ts', type: 'file' as const },
          { name: 'dir1', type: 'dir' as const },
        ]),
        getFileTree: mock.fn(async () => ['src/index.ts', 'src/utils.ts', 'package.json']),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
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
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => 'content'),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
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
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => {
          throw new Error('File not found');
        }),
        listDirectory: mock.fn(async () => []),
        getFileTree: mock.fn(async () => []),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
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

  describe('fetchAffectedFileContents', () => {
    it('uses repoAccess to fetch file contents', async () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async (path: string) => `content of ${path}`),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const results = await fetchAffectedFileContents(context, ['src/index.ts', 'src/utils.ts']);

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].path, 'src/index.ts');
      assert.strictEqual(results[0].content, 'content of src/index.ts');
      assert.strictEqual(results[1].path, 'src/utils.ts');
      assert.strictEqual(results[1].content, 'content of src/utils.ts');
    });

    it('throws when repoAccess is not available', async () => {
      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        // No repoAccess
      };

      await assert.rejects(
        async () => fetchAffectedFileContents(context, ['src/index.ts']),
        /repoAccess is required/
      );
    });

    it('skips non-source files', async () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async (path: string) => `content of ${path}`),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const results = await fetchAffectedFileContents(context, [
        'src/index.ts',
        'package-lock.json', // Should be skipped
        'image.png', // Should be skipped
      ]);

      // Only index.ts should be fetched
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].path, 'src/index.ts');
    });

    it('truncates large files', async () => {
      const largeContent = 'A'.repeat(50000);
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => largeContent),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const results = await fetchAffectedFileContents(context, ['src/large.ts'], 1000);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].content?.length, 1000);
      assert.strictEqual(results[0].truncated, true);
    });

    it('handles API errors gracefully', async () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async () => {
          throw new Error('File not found');
        }),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const results = await fetchAffectedFileContents(context, ['src/missing.ts']);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].path, 'src/missing.ts');
      assert.strictEqual(results[0].content, null);
      assert.ok(results[0].error?.includes('File not found'));
    });

    it('respects total size limit', async () => {
      const mockRepoAccess: Partial<UnifiedRepoAccess> = {
        isLocal: () => false,
        getLocalPath: () => undefined,
        getFileContent: mock.fn(async (path: string) => `content of ${path} ${'x'.repeat(500)}`),
      };

      const context: AgentContext = {
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        repos: {} as any,
        git: {} as any,
        llm: {} as any,
        repoAccess: mockRepoAccess as UnifiedRepoAccess,
      };

      const results = await fetchAffectedFileContents(
        context,
        ['file1.ts', 'file2.ts', 'file3.ts'],
        10000, // max per file
        1000   // max total - only 1-2 files should fit
      );

      // At least one file should be skipped due to total size limit
      const skippedFiles = results.filter(r => r.error?.includes('total size limit'));
      assert.ok(skippedFiles.length > 0, 'At least one file should be skipped due to total size limit');
    });
  });
});
