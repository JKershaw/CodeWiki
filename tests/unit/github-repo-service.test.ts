/**
 * Unit tests for GitHub Repository Service.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createGitHubRepoService,
  createAuthenticatedGitHubRepoService,
  parseGitHubUrl,
  type GitHubRepoService,
} from '../../src/services/github/github-repo-service.js';

describe('GitHub Repo Service', () => {
  let repoService: GitHubRepoService;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    repoService = createGitHubRepoService({ accessToken: 'test-token' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('parseGitHubUrl', () => {
    it('parses standard GitHub URL', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo');
      assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
    });

    it('parses GitHub URL with .git extension', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo.git');
      assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
    });

    it('parses HTTP GitHub URL', () => {
      const result = parseGitHubUrl('http://github.com/owner/repo');
      assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
    });

    it('returns null for non-GitHub URLs', () => {
      const result = parseGitHubUrl('https://gitlab.com/owner/repo');
      assert.strictEqual(result, null);
    });

    it('returns null for invalid URLs', () => {
      const result = parseGitHubUrl('not-a-url');
      assert.strictEqual(result, null);
    });

    it('returns null for GitHub URLs without repo', () => {
      const result = parseGitHubUrl('https://github.com/owner');
      assert.strictEqual(result, null);
    });

    it('returns null for GitHub URLs with extra path segments', () => {
      const result = parseGitHubUrl('https://github.com/owner/repo/issues');
      assert.strictEqual(result, null);
    });
  });

  describe('getRepository', () => {
    it('fetches repository information', async () => {
      const mockRepo = {
        id: 123,
        name: 'test-repo',
        full_name: 'owner/test-repo',
        default_branch: 'main',
        private: false,
        description: 'A test repository',
      };

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('/repos/owner/test-repo'));
        assert.ok((options.headers as Record<string, string>)['Authorization']?.includes('Bearer'));
        return new Response(JSON.stringify(mockRepo), { status: 200 });
      }) as typeof fetch;

      const repo = await repoService.getRepository('owner', 'test-repo');

      assert.strictEqual(repo.id, 123);
      assert.strictEqual(repo.name, 'test-repo');
      assert.strictEqual(repo.fullName, 'owner/test-repo');
      assert.strictEqual(repo.defaultBranch, 'main');
      assert.strictEqual(repo.isPrivate, false);
      assert.strictEqual(repo.description, 'A test repository');
    });

    it('throws error for non-existent repository', async () => {
      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }) as typeof fetch;

      await assert.rejects(
        () => repoService.getRepository('owner', 'nonexistent'),
        /GitHub API error \(404\)/
      );
    });
  });

  describe('listCommits', () => {
    it('fetches commits from repository', async () => {
      const mockCommits = [
        {
          sha: 'abc123',
          commit: {
            message: 'First commit',
            author: { name: 'Test Author', email: 'test@example.com', date: '2024-01-01T00:00:00Z' },
            committer: { date: '2024-01-01T00:00:00Z' },
          },
          stats: { additions: 10, deletions: 5 },
          files: [
            { filename: 'file1.ts', status: 'added', additions: 10, deletions: 0 },
          ],
        },
        {
          sha: 'def456',
          commit: {
            message: 'Second commit',
            author: { name: 'Test Author', email: 'test@example.com', date: '2024-01-02T00:00:00Z' },
            committer: { date: '2024-01-02T00:00:00Z' },
          },
          stats: { additions: 20, deletions: 10 },
          files: [
            { filename: 'file2.ts', status: 'modified', additions: 15, deletions: 10 },
            { filename: 'file3.ts', status: 'removed', additions: 0, deletions: 5 },
          ],
        },
      ];

      globalThis.fetch = mock.fn(async (url: string) => {
        assert.ok(url.includes('/repos/owner/repo/commits'));
        return new Response(JSON.stringify(mockCommits), { status: 200 });
      }) as typeof fetch;

      const commits = await repoService.listCommits('owner', 'repo', 'repo-id');

      assert.strictEqual(commits.length, 2);
      assert.strictEqual(commits[0].sha, 'abc123');
      assert.strictEqual(commits[0].message, 'First commit');
      assert.strictEqual(commits[0].authorName, 'Test Author');
      assert.strictEqual(commits[0].diffSummary.filesAdded, 1);
      assert.strictEqual(commits[0].diffSummary.linesAdded, 10);

      assert.strictEqual(commits[1].sha, 'def456');
      assert.strictEqual(commits[1].diffSummary.filesModified, 1);
      assert.strictEqual(commits[1].diffSummary.filesDeleted, 1);
    });

    it('respects limit option', async () => {
      const mockCommits = [
        {
          sha: 'abc123',
          commit: {
            message: 'Commit 1',
            author: { name: 'Author', email: 'a@b.com', date: '2024-01-01T00:00:00Z' },
            committer: { date: '2024-01-01T00:00:00Z' },
          },
        },
      ];

      let capturedUrl = '';
      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify(mockCommits), { status: 200 });
      }) as typeof fetch;

      await repoService.listCommits('owner', 'repo', 'repo-id', { limit: 50 });

      assert.ok(capturedUrl.includes('per_page=50'));
    });

    it('includes since parameter when specified', async () => {
      const mockCommits: unknown[] = [];
      let capturedUrl = '';

      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify(mockCommits), { status: 200 });
      }) as typeof fetch;

      const sinceDate = new Date('2024-06-01T00:00:00Z');
      await repoService.listCommits('owner', 'repo', 'repo-id', { since: sinceDate });

      assert.ok(capturedUrl.includes('since=2024-06-01'));
    });

    it('includes sha parameter when specified', async () => {
      const mockCommits: unknown[] = [];
      let capturedUrl = '';

      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify(mockCommits), { status: 200 });
      }) as typeof fetch;

      await repoService.listCommits('owner', 'repo', 'repo-id', { sha: 'feature-branch' });

      assert.ok(capturedUrl.includes('sha=feature-branch'));
    });
  });

  describe('getCommitDiff', () => {
    it('fetches diff for a commit', async () => {
      const mockDiff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+// New line
 const x = 1;
`;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('/repos/owner/repo/commits/abc123'));
        assert.strictEqual(
          (options.headers as Record<string, string>)['Accept'],
          'application/vnd.github.diff'
        );
        return new Response(mockDiff, { status: 200 });
      }) as typeof fetch;

      const diff = await repoService.getCommitDiff('owner', 'repo', 'abc123');

      assert.ok(diff.includes('diff --git'));
      assert.ok(diff.includes('+// New line'));
    });
  });

  describe('getFileContent', () => {
    it('fetches file content', async () => {
      const fileContent = 'export const hello = "world";';

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        assert.ok(url.includes('/repos/owner/repo/contents/src/index.ts'));
        assert.strictEqual(
          (options.headers as Record<string, string>)['Accept'],
          'application/vnd.github.raw+json'
        );
        return new Response(fileContent, { status: 200 });
      }) as typeof fetch;

      const content = await repoService.getFileContent('owner', 'repo', 'src/index.ts');

      assert.strictEqual(content, fileContent);
    });

    it('fetches file content at specific ref', async () => {
      let capturedUrl = '';

      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response('content', { status: 200 });
      }) as typeof fetch;

      await repoService.getFileContent('owner', 'repo', 'file.ts', 'feature-branch');

      assert.ok(capturedUrl.includes('ref=feature-branch'));
    });

    it('throws error for non-existent file', async () => {
      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }) as typeof fetch;

      await assert.rejects(
        () => repoService.getFileContent('owner', 'repo', 'nonexistent.ts'),
        /GitHub API error \(404\)/
      );
    });
  });

  describe('getDirectoryContents', () => {
    it('fetches directory listing', async () => {
      const mockContents = [
        { name: 'file1.ts', path: 'src/file1.ts', type: 'file', size: 100, sha: 'sha1' },
        { name: 'utils', path: 'src/utils', type: 'dir', size: 0, sha: 'sha2' },
      ];

      globalThis.fetch = mock.fn(async (url: string) => {
        assert.ok(url.includes('/repos/owner/repo/contents/src'));
        return new Response(JSON.stringify(mockContents), { status: 200 });
      }) as typeof fetch;

      const contents = await repoService.getDirectoryContents('owner', 'repo', 'src');

      assert.strictEqual(contents.length, 2);
      assert.strictEqual(contents[0].name, 'file1.ts');
      assert.strictEqual(contents[0].type, 'file');
      assert.strictEqual(contents[1].name, 'utils');
      assert.strictEqual(contents[1].type, 'dir');
    });

    it('fetches directory contents at specific ref', async () => {
      let capturedUrl = '';

      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch;

      await repoService.getDirectoryContents('owner', 'repo', 'src', 'v1.0.0');

      assert.ok(capturedUrl.includes('ref=v1.0.0'));
    });
  });

  describe('getTree', () => {
    it('fetches recursive tree', async () => {
      const mockTree = {
        sha: 'tree-sha',
        tree: [
          { path: 'src', mode: '040000', type: 'tree', sha: 'sha1' },
          { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'sha2', size: 150 },
          { path: 'src/utils/helper.ts', mode: '100644', type: 'blob', sha: 'sha3', size: 200 },
        ],
        truncated: false,
      };

      globalThis.fetch = mock.fn(async (url: string) => {
        assert.ok(url.includes('/repos/owner/repo/git/trees/main'));
        assert.ok(url.includes('recursive=1'));
        return new Response(JSON.stringify(mockTree), { status: 200 });
      }) as typeof fetch;

      const tree = await repoService.getTree('owner', 'repo', 'main');

      assert.strictEqual(tree.length, 3);
      assert.strictEqual(tree[0].path, 'src');
      assert.strictEqual(tree[0].type, 'tree');
      assert.strictEqual(tree[1].path, 'src/index.ts');
      assert.strictEqual(tree[1].type, 'blob');
      assert.strictEqual(tree[1].size, 150);
    });

    it('fetches non-recursive tree when specified', async () => {
      let capturedUrl = '';

      globalThis.fetch = mock.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ sha: 'sha', tree: [], truncated: false }), { status: 200 });
      }) as typeof fetch;

      await repoService.getTree('owner', 'repo', 'main', false);

      assert.ok(!capturedUrl.includes('recursive=1'));
    });
  });

  describe('getDefaultBranch', () => {
    it('returns the default branch', async () => {
      const mockRepo = {
        id: 123,
        name: 'repo',
        full_name: 'owner/repo',
        default_branch: 'develop',
        private: false,
        description: null,
      };

      globalThis.fetch = mock.fn(async () => {
        return new Response(JSON.stringify(mockRepo), { status: 200 });
      }) as typeof fetch;

      const branch = await repoService.getDefaultBranch('owner', 'repo');

      assert.strictEqual(branch, 'develop');
    });
  });

  describe('createAuthenticatedGitHubRepoService', () => {
    it('creates service with access token', async () => {
      const mockRepo = {
        id: 1,
        name: 'repo',
        full_name: 'owner/repo',
        default_branch: 'main',
        private: true,
        description: null,
      };

      globalThis.fetch = mock.fn(async (_url: string, options: RequestInit) => {
        const authHeader = (options.headers as Record<string, string>)['Authorization'];
        assert.strictEqual(authHeader, 'Bearer my-secret-token');
        return new Response(JSON.stringify(mockRepo), { status: 200 });
      }) as typeof fetch;

      const authService = createAuthenticatedGitHubRepoService('my-secret-token');
      await authService.getRepository('owner', 'repo');
    });
  });

  describe('unauthenticated access', () => {
    it('works without token for public repos', async () => {
      const mockRepo = {
        id: 1,
        name: 'repo',
        full_name: 'owner/repo',
        default_branch: 'main',
        private: false,
        description: null,
      };

      globalThis.fetch = mock.fn(async (_url: string, options: RequestInit) => {
        const authHeader = (options.headers as Record<string, string>)['Authorization'];
        assert.strictEqual(authHeader, undefined);
        return new Response(JSON.stringify(mockRepo), { status: 200 });
      }) as typeof fetch;

      const unauthService = createGitHubRepoService();
      await unauthService.getRepository('owner', 'repo');
    });
  });

  describe('API version header', () => {
    it('includes X-GitHub-Api-Version header', async () => {
      globalThis.fetch = mock.fn(async (_url: string, options: RequestInit) => {
        const apiVersion = (options.headers as Record<string, string>)['X-GitHub-Api-Version'];
        assert.strictEqual(apiVersion, '2022-11-28');
        return new Response(JSON.stringify({ id: 1, name: 'repo', full_name: 'o/r', default_branch: 'main', private: false, description: null }), { status: 200 });
      }) as typeof fetch;

      await repoService.getRepository('owner', 'repo');
    });
  });
});
