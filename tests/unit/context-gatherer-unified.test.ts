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
import type { RepositoryServiceFactory, RepositoryService } from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';
import { ContextGatherer, type DirectoryNode, type DirectoryCoverage } from '../../src/agents/orchestrator/context-gatherer.js';

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
 * Create mock repository service factory with specified file tree.
 */
function createMockRepoServiceFactory(fileTree: string[]): RepositoryServiceFactory {
  const mockService: Partial<RepositoryService> = {
    getFileTree: mock.fn(async () => fileTree),
    listDirectory: mock.fn(async () => []), // Not used in unified approach
  };

  return {
    getService: mock.fn(() => mockService as RepositoryService),
    getServiceWithToken: mock.fn(() => mockService as RepositoryService),
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

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
        'src/index.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have coverage for 2 directories (agents, services)
      assert.strictEqual(context.directoryCoverage.length, 2);

      const agentsCoverage = context.directoryCoverage.find(d => d.path === 'src/agents');
      const servicesCoverage = context.directoryCoverage.find(d => d.path === 'src/services');

      assert.ok(agentsCoverage, 'Should have agents coverage');
      assert.ok(servicesCoverage, 'Should have services coverage');
      assert.strictEqual(agentsCoverage.fileCount, 2);
      assert.strictEqual(servicesCoverage.fileCount, 2);
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

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

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
      const localFactory = createMockRepoServiceFactory(fileTree);
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
      const githubFactory = createMockRepoServiceFactory(fileTree);
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

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

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

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

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
        createMockWikiPage('guides/services', 'The src/services directory contains service implementations.'),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const agentsCoverage = context.directoryCoverage.find(d => d.path === 'src/agents');
      const servicesCoverage = context.directoryCoverage.find(d => d.path === 'src/services');

      assert.ok(agentsCoverage, 'Should have agents coverage');
      assert.ok(servicesCoverage, 'Should have services coverage');
      assert.ok(agentsCoverage.wikiMentions > 0, 'Agents should have wiki mentions');
      assert.ok(servicesCoverage.wikiMentions > 0, 'Services should have wiki mentions');
    });

    it('returns empty coverage when no src directory exists', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // No src/ files
      const fileTree = [
        'lib/utils.ts',
        'index.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
    });

    it('returns empty coverage when repoServiceFactory is not provided', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // No repoServiceFactory provided
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

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 2);
      // Agents (0% coverage) should come before services (higher coverage)
      assert.strictEqual(context.directoryCoverage[0]!.path, 'src/agents');
    });
  });

  describe('buildCoverageTree via RepositoryService', () => {
    it('builds coverage tree for local repo using RepositoryService', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change/agent.ts',
        'src/services/llm/llm-service.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.ok(context.coverageTree, 'Should have coverage tree');
      assert.strictEqual(context.coverageTree.name, 'src');
      assert.strictEqual(context.coverageTree.totalFileCount, 3);
      assert.ok(context.coverageTree.children.length > 0, 'Should have children');
    });

    it('builds identical tree structure for local and GitHub repos', async () => {
      const fileTree = [
        'src/domain/entity.ts',
        'src/domain/value-object.ts',
        'src/services/api/client.ts',
      ];

      // Local repo
      const localRepos = createMockRepos({
        id: 'local-repo',
        isGitHubRepo: false,
      } as Repo);
      const localFactory = createMockRepoServiceFactory(fileTree);
      const localGatherer = new ContextGatherer(localRepos, localFactory);
      const localContext = await localGatherer.gather('local-repo', 'wiki-1');

      // GitHub repo
      const githubRepos = createMockRepos({
        id: 'github-repo',
        isGitHubRepo: true,
        owner: 'owner',
        repoName: 'repo',
      } as Repo);
      const githubFactory = createMockRepoServiceFactory(fileTree);
      const githubGatherer = new ContextGatherer(githubRepos, githubFactory);
      const githubContext = await githubGatherer.gather('github-repo', 'wiki-1');

      // Tree structure should be identical
      assert.ok(localContext.coverageTree, 'Local should have tree');
      assert.ok(githubContext.coverageTree, 'GitHub should have tree');
      assert.strictEqual(
        localContext.coverageTree.totalFileCount,
        githubContext.coverageTree.totalFileCount,
        'File counts should match'
      );
      assert.strictEqual(
        localContext.coverageTree.children.length,
        githubContext.coverageTree.children.length,
        'Child counts should match'
      );
    });

    it('returns null tree when no src files exist', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'lib/utils.ts',
        'index.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.coverageTree, null);
    });

    it('returns null tree when repoServiceFactory not provided', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.coverageTree, null);
    });

    it('builds nested tree structure correctly', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/services/llm/openai/client.ts',
        'src/services/llm/openai/types.ts',
        'src/services/llm/anthropic/client.ts',
        'src/services/git/git-service.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.ok(context.coverageTree, 'Should have coverage tree');

      // Find services node
      const servicesNode = context.coverageTree.children.find(c => c.name === 'services');
      assert.ok(servicesNode, 'Should have services node');

      // Services should have llm and git children
      const llmNode = servicesNode.children.find(c => c.name === 'llm');
      const gitNode = servicesNode.children.find(c => c.name === 'git');
      assert.ok(llmNode, 'Should have llm node');
      assert.ok(gitNode, 'Should have git node');

      // LLM should have openai and anthropic children
      assert.strictEqual(llmNode.children.length, 2);
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

      const repoServiceFactory = {
        getService: mock.fn(() => mockService as RepositoryService),
        getServiceWithToken: mock.fn(() => mockService as RepositoryService),
      };

      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should return empty coverage instead of throwing
      assert.strictEqual(context.directoryCoverage.length, 0);
      assert.strictEqual(context.coverageTree, null);
    });

    it('handles repo not found', async () => {
      const repos = createMockRepos(null);
      const repoServiceFactory = createMockRepoServiceFactory([]);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('nonexistent-repo', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
      assert.strictEqual(context.coverageTree, null);
    });
  });
});
