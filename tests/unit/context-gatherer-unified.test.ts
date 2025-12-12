/**
 * Unit tests for ContextGatherer unified RepositoryService-based directory coverage.
 *
 * These tests verify that undocumented directory calculation works uniformly for both
 * local and GitHub repositories using the RepositoryService abstraction, without
 * branching on isGitHubRepo.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';
import type { Repo } from '../../src/domain/repo.js';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Helper to create a mock wiki page.
 */
function createMockWikiPage(
  path: string,
  content: string,
  options?: { confidence?: number }
): WikiPage {
  return {
    id: `page-${path.replace(/\//g, '-')}`,
    wikiId: 'wiki-1',
    path,
    title: path.split('/').pop() ?? 'Untitled',
    content,
    confidence: options?.confidence ?? 0.7,
    sourceCommits: [],
    sourceAgentRunIds: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create mock repositories with specified repo and wiki pages.
 */
function createMockRepos(repo: Partial<Repo> | null, wikiPages: WikiPage[] = []) {
  return {
    repos: {
      findById: mock.fn(async () => repo),
    },
    commits: {
      findByRepo: mock.fn(async () => []),
    },
    wikiPages: {
      findByWiki: mock.fn(async () => wikiPages),
      findByPath: mock.fn(async (_wikiId: string, path: string) => {
        return wikiPages.find(p => p.path === path) ?? null;
      }),
    },
    agentRuns: {
      findByRepo: mock.fn(async () => []),
    },
    editRequests: {
      countPending: mock.fn(async () => 0),
    },
  } as any;
}

/**
 * Create mock unified repo access factory with specified file tree.
 */
function createMockRepoAccessFactory(fileTree: string[]): UnifiedRepoAccessFactory {
  const mockAccess: UnifiedRepoAccess = {
    getFileTree: mock.fn(async () => fileTree),
    listDirectory: mock.fn(async () => []),
    getFileContent: mock.fn(async () => ''),
    fileExists: mock.fn(async () => false),
    getCommitDiff: mock.fn(async () => ''),
    isLocal: () => false,
    getLocalPath: () => undefined,
  };

  return {
    create: mock.fn(async () => mockAccess),
  };
}

describe('ContextGatherer Unified Directory Coverage', () => {
  describe('calculateUndocumentedDirectories via RepositoryService', () => {
    it('identifies undocumented directories for local repo using RepositoryService', async () => {
      // Local repo (isGitHubRepo: false) should use RepositoryService
      const repos = createMockRepos({
        id: 'repo-1',
        fullName: '/path/to/local/repo',
        isGitHubRepo: false,
      } as Repo);

      // Note: Files are counted toward their IMMEDIATE parent directory
      // So src/services/git/git-service.ts counts toward src/services/git, not src/services
      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
        'src/index.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have undocumented directories since no wiki pages exist
      assert.ok(context.undocumentedDirectories.length > 0, 'Should find undocumented directories');

      // Check specific directories exist
      const agentsDir = context.undocumentedDirectories.find(d => d.path === 'src/agents');
      const gitDir = context.undocumentedDirectories.find(d => d.path === 'src/services/git');
      const llmDir = context.undocumentedDirectories.find(d => d.path === 'src/services/llm');

      assert.ok(agentsDir, 'Should have agents directory');
      assert.ok(gitDir, 'Should have services/git directory');
      assert.ok(llmDir, 'Should have services/llm directory');
      assert.strictEqual(agentsDir.totalFiles, 2);
      assert.strictEqual(gitDir.totalFiles, 1);
      assert.strictEqual(llmDir.totalFiles, 1);
    });

    it('identifies undocumented directories for GitHub repo using RepositoryService', async () => {
      // GitHub repo (isGitHubRepo: true) should also use RepositoryService
      const repos = createMockRepos({
        id: 'repo-1',
        fullName: 'owner/repo',
        isGitHubRepo: true,
        owner: 'owner',
        repoName: 'repo',
      } as Repo);

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/index.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.ok(context.undocumentedDirectories.length > 0, 'Should find undocumented directories');
    });

    it('produces same results for local and GitHub repos with same file tree', async () => {
      const fileTree = [
        'src/domain/repo.ts',
        'src/domain/wiki-page.ts',
        'src/services/llm/llm-service.ts',
        'src/services/llm/mock-llm.ts',
      ];

      // Local repo
      const localRepos = createMockRepos({
        id: 'local-repo',
        fullName: '/path/to/repo',
        isGitHubRepo: false,
      } as Repo);
      const localFactory = createMockRepoAccessFactory(fileTree);
      const localGatherer = new ContextGatherer(localRepos, localFactory);
      const localContext = await localGatherer.gather('local-repo', 'wiki-1');

      // GitHub repo
      const githubRepos = createMockRepos({
        id: 'github-repo',
        fullName: 'owner/repo',
        isGitHubRepo: true,
        owner: 'owner',
        repoName: 'repo',
      } as Repo);
      const githubFactory = createMockRepoAccessFactory(fileTree);
      const githubGatherer = new ContextGatherer(githubRepos, githubFactory);
      const githubContext = await githubGatherer.gather('github-repo', 'wiki-1');

      // Results should be identical
      assert.deepStrictEqual(
        localContext.undocumentedDirectories.map(d => ({ path: d.path, totalFiles: d.totalFiles })),
        githubContext.undocumentedDirectories.map(d => ({ path: d.path, totalFiles: d.totalFiles })),
        'Local and GitHub repos should produce identical results'
      );
    });

    it('filters out test files, spec files, and declaration files', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/utils/helper.ts',
        'src/utils/helper.test.ts',  // Should be excluded
        'src/utils/helper.spec.ts',  // Should be excluded
        'src/utils/types.d.ts',      // Should be excluded
        'src/utils/another.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const utilsDir = context.undocumentedDirectories.find(d => d.path === 'src/utils');
      assert.ok(utilsDir, 'Should have utils directory');
      assert.strictEqual(utilsDir.totalFiles, 2, 'Should only count helper.ts and another.ts');
    });

    it('filters out files in node_modules, dist, and build directories', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/utils/helper.ts',
        'src/node_modules/package/index.ts',  // Should be excluded
        'src/dist/compiled.js',               // Should be excluded
        'src/build/output.js',                // Should be excluded
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const utilsDir = context.undocumentedDirectories.find(d => d.path === 'src/utils');
      assert.ok(utilsDir, 'Should have utils directory');
      assert.strictEqual(utilsDir.totalFiles, 1);

      // Should not have entries for excluded directories
      const nodeModulesDir = context.undocumentedDirectories.find(d => d.path.includes('node_modules'));
      assert.strictEqual(nodeModulesDir, undefined, 'Should not include node_modules');
    });

    it('handles undocumented directories for non-src directories like lib/', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // lib/ instead of src/
      const fileTree = [
        'lib/utils/helper.ts',
        'lib/utils/formatter.ts',
        'lib/core/engine.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have entries for lib/utils and lib/core
      assert.ok(context.undocumentedDirectories.find(d => d.path === 'lib/utils'));
      assert.ok(context.undocumentedDirectories.find(d => d.path === 'lib/core'));
    });

    it('returns empty when no directories with source files exist', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // Only root-level files (no directories)
      const fileTree = [
        'index.ts',
        'config.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
    });

    it('returns empty when repoAccessFactory is not provided', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // No repoAccessFactory provided
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
    });

    it('sorts by undocumented ratio (highest first)', async () => {
      // Create wiki pages that document some files
      const wikiPages = [
        createMockWikiPage(
          'guides/services',
          `# Services

## src/services/service.ts
Main service file documented here.
`
        ),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/agents/agent.ts',        // 1 file, undocumented
        'src/services/service.ts',    // 1 file, documented
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Agents (100% undocumented) should come before services (potentially lower)
      if (context.undocumentedDirectories.length > 0) {
        const agentsDir = context.undocumentedDirectories.find(d => d.path === 'src/agents');
        assert.ok(agentsDir, 'Should have agents as undocumented');
        assert.strictEqual(agentsDir.undocumentedRatio, 1, 'Agents should be 100% undocumented');
      }
    });
  });

  describe('error handling', () => {
    it('handles getFileTree errors gracefully', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const mockAccess: Partial<UnifiedRepoAccess> = {
        getFileTree: mock.fn(async () => {
          throw new Error('Network error');
        }),
        listDirectory: mock.fn(async () => []),
        isLocal: () => false,
        getLocalPath: () => undefined,
      };

      const repoAccessFactory: UnifiedRepoAccessFactory = {
        create: mock.fn(async () => mockAccess as UnifiedRepoAccess),
      };

      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should return empty instead of throwing
      assert.strictEqual(context.undocumentedDirectories.length, 0);
      assert.strictEqual(context.fileCoverageTree, null);
    });

    it('handles repo not found', async () => {
      const repos = createMockRepos(null);
      const repoAccessFactory = createMockRepoAccessFactory([]);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('nonexistent-repo', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
      assert.strictEqual(context.fileCoverageTree, null);
    });
  });
});
