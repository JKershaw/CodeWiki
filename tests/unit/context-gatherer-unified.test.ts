/**
 * Unit tests for ContextGatherer unified RepositoryService-based directory coverage.
 *
 * These tests verify that directory coverage calculation works uniformly for both
 * local and GitHub repositories using the RepositoryService abstraction, without
 * branching on isGitHubRepo.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';
import type { Repo } from '../../src/domain/repo.js';
import { ContextGatherer, type DirectoryCoverage } from '../../src/agents/orchestrator/context-gatherer.js';

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
  describe('calculateDirectoryCoverage via RepositoryService', () => {
    it('calculates coverage for local repo using RepositoryService', async () => {
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

      // Should have coverage for 3 directories (agents, services/git, services/llm)
      // Each file is counted toward its immediate parent directory
      assert.strictEqual(context.directoryCoverage.length, 3);

      const agentsCoverage = context.directoryCoverage.find(d => d.path === 'src/agents');
      const gitCoverage = context.directoryCoverage.find(d => d.path === 'src/services/git');
      const llmCoverage = context.directoryCoverage.find(d => d.path === 'src/services/llm');

      assert.ok(agentsCoverage, 'Should have agents coverage');
      assert.ok(gitCoverage, 'Should have services/git coverage');
      assert.ok(llmCoverage, 'Should have services/llm coverage');
      assert.strictEqual(agentsCoverage.fileCount, 2);
      assert.strictEqual(gitCoverage.fileCount, 1);
      assert.strictEqual(llmCoverage.fileCount, 1);
    });

    it('calculates coverage for GitHub repo using RepositoryService', async () => {
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

      assert.strictEqual(context.directoryCoverage.length, 2);
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
        localContext.directoryCoverage.map(d => ({ path: d.path, fileCount: d.fileCount })),
        githubContext.directoryCoverage.map(d => ({ path: d.path, fileCount: d.fileCount })),
        'Local and GitHub repos should produce identical coverage'
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

      const utilsCoverage = context.directoryCoverage.find(d => d.path === 'src/utils');
      assert.ok(utilsCoverage, 'Should have utils coverage');
      assert.strictEqual(utilsCoverage.fileCount, 2, 'Should only count helper.ts and another.ts');
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

      const utilsCoverage = context.directoryCoverage.find(d => d.path === 'src/utils');
      assert.ok(utilsCoverage, 'Should have utils coverage');
      assert.strictEqual(utilsCoverage.fileCount, 1);

      // Should not have coverage entries for excluded directories
      const nodeModulesCoverage = context.directoryCoverage.find(d => d.path.includes('node_modules'));
      assert.strictEqual(nodeModulesCoverage, undefined, 'Should not include node_modules');
    });

    it('calculates wiki mentions correctly', async () => {
      const wikiPages = [
        createMockWikiPage('architecture/agents', 'The agents module handles autonomous tasks.'),
        createMockWikiPage('guides/git', 'The src/services/git directory contains git service implementations.'),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      // Note: Files are counted toward their IMMEDIATE parent directory
      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const agentsCoverage = context.directoryCoverage.find(d => d.path === 'src/agents');
      const gitCoverage = context.directoryCoverage.find(d => d.path === 'src/services/git');

      assert.ok(agentsCoverage, 'Should have agents coverage');
      assert.ok(gitCoverage, 'Should have services/git coverage');
      assert.ok(agentsCoverage.wikiMentions > 0, 'Agents should have wiki mentions');
      assert.ok(gitCoverage.wikiMentions > 0, 'Git should have wiki mentions');
    });

    it('calculates coverage for non-src directories like lib/', async () => {
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

      // Should have coverage for lib/utils and lib/core
      assert.strictEqual(context.directoryCoverage.length, 2);
      assert.ok(context.directoryCoverage.find(d => d.path === 'lib/utils'));
      assert.ok(context.directoryCoverage.find(d => d.path === 'lib/core'));
    });

    it('returns empty coverage when no directories with source files exist', async () => {
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

      assert.strictEqual(context.directoryCoverage.length, 0);
    });

    it('returns empty coverage when repoAccessFactory is not provided', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // No repoAccessFactory provided
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
    });

    it('sorts coverage by percentage (lowest first)', async () => {
      const wikiPages = [
        createMockWikiPage('guides/services', 'The services module is well documented.'),
        createMockWikiPage('guides/services-detail', 'More about services...'),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/agents/agent.ts',        // 1 file, no mentions
        'src/services/service.ts',    // 1 file, 2 mentions
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 2);
      // Agents (0% coverage) should come before services (higher coverage)
      assert.strictEqual(context.directoryCoverage[0]!.path, 'src/agents');
    });
  });

  describe('error handling', () => {
    it('handles getFileTree errors gracefully', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const mockService: Partial<RepositoryService> = {
        getFileTree: mock.fn(async () => {
          throw new Error('Network error');
        }),
      };

      const repoAccessFactory = {
        getService: mock.fn(() => mockService as RepositoryService),
        getServiceWithToken: mock.fn(() => mockService as RepositoryService),
      };

      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should return empty coverage instead of throwing
      assert.strictEqual(context.directoryCoverage.length, 0);
      assert.strictEqual(context.fileCoverageTree, null);
    });

    it('handles repo not found', async () => {
      const repos = createMockRepos(null);
      const repoAccessFactory = createMockRepoAccessFactory([]);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('nonexistent-repo', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
      assert.strictEqual(context.fileCoverageTree, null);
    });
  });
});
