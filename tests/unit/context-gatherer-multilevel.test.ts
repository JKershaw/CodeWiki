/**
 * Unit tests for ContextGatherer multi-level directory coverage.
 *
 * These tests verify that directory coverage is calculated at ALL directory levels,
 * not just 2nd level (e.g., src/agents). This enables the orchestrator to target
 * specific deeply nested directories with low coverage.
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
 * Create mock repositories.
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
 * Create mock unified repo access factory.
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

describe('ContextGatherer Multi-Level Directory Coverage', () => {
  describe('calculateDirectoryCoverage at all levels', () => {
    it('should calculate coverage for 3rd-level directories', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      // Files at multiple depth levels
      const fileTree = [
        'src/agents/orchestrator/strategies.ts',      // 3rd level dir: src/agents/orchestrator
        'src/agents/orchestrator/context-gatherer.ts',
        'src/agents/analysis/base-agent.ts',          // 3rd level dir: src/agents/analysis
        'src/agents/base-agent.ts',                    // 2nd level
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have coverage for BOTH 2nd and 3rd level directories
      const paths = context.directoryCoverage.map(d => d.path);

      // 3rd level directories should be present
      assert.ok(
        paths.includes('src/agents/orchestrator'),
        `Should include 3rd-level dir 'src/agents/orchestrator'. Got: ${paths.join(', ')}`
      );
      assert.ok(
        paths.includes('src/agents/analysis'),
        `Should include 3rd-level dir 'src/agents/analysis'. Got: ${paths.join(', ')}`
      );
    });

    it('should calculate coverage for 4th-level directories', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/services/llm/analysis-tools/source-tools.ts',  // 4th level
        'src/services/llm/analysis-tools/metrics.ts',        // 4th level
        'src/services/llm/llm-service.ts',                    // 3rd level
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const paths = context.directoryCoverage.map(d => d.path);

      // 4th level directory should be present
      assert.ok(
        paths.includes('src/services/llm/analysis-tools'),
        `Should include 4th-level dir 'src/services/llm/analysis-tools'. Got: ${paths.join(', ')}`
      );
    });

    it('should calculate separate coverage for parent and child directories', async () => {
      // Wiki page mentions 'orchestrator' but NOT 'analysis'
      const wikiPages = [
        createMockWikiPage('architecture/orchestrator', 'The orchestrator module handles...'),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/agents/orchestrator/strategies.ts',
        'src/agents/orchestrator/context-gatherer.ts',
        'src/agents/analysis/base-agent.ts',
        'src/agents/analysis/code-change-agent.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Find coverage entries for specific directories
      const orchestratorCoverage = context.directoryCoverage.find(
        d => d.path === 'src/agents/orchestrator'
      );
      const analysisCoverage = context.directoryCoverage.find(
        d => d.path === 'src/agents/analysis'
      );

      assert.ok(orchestratorCoverage, 'Should have coverage for src/agents/orchestrator');
      assert.ok(analysisCoverage, 'Should have coverage for src/agents/analysis');

      // Orchestrator should have higher coverage (wiki mentions it)
      // Analysis should have 0% coverage (no wiki mentions)
      assert.ok(
        orchestratorCoverage.wikiMentions > 0,
        'Orchestrator should have wiki mentions'
      );
      assert.strictEqual(
        analysisCoverage.wikiMentions,
        0,
        'Analysis should have 0 wiki mentions'
      );
    });

    it('should allow targeting specific deep directories with low coverage', async () => {
      // Scenario: src/agents has overall 50% coverage, but src/agents/analysis has 0%
      const wikiPages = [
        createMockWikiPage('architecture/orchestrator', 'The orchestrator handles work distribution...'),
        createMockWikiPage('guides/orchestrator-usage', 'How to use the orchestrator...'),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/agents/orchestrator/strategies.ts',
        'src/agents/orchestrator/context-gatherer.ts',
        'src/agents/analysis/base-agent.ts',
        'src/agents/analysis/code-change-agent.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Get the low-coverage directories (sorted by coverage, lowest first)
      const lowCoverageDirs = context.directoryCoverage.filter(d => d.coveragePercent === 0);

      // src/agents/analysis should be in the low coverage list
      const analysisInLowCoverage = lowCoverageDirs.some(
        d => d.path === 'src/agents/analysis'
      );

      assert.ok(
        analysisInLowCoverage,
        `src/agents/analysis should be identifiable as low coverage. Low coverage dirs: ${lowCoverageDirs.map(d => d.path).join(', ')}`
      );
    });

    it('should not duplicate coverage counting for nested directories', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/services/llm/llm-service.ts',
        'src/services/llm/mock-llm.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Each directory level should have its own file count
      const servicesLlm = context.directoryCoverage.find(d => d.path === 'src/services/llm');

      assert.ok(servicesLlm, 'Should have coverage for src/services/llm');
      assert.strictEqual(
        servicesLlm.fileCount,
        2,
        'src/services/llm should have 2 files'
      );
    });

    it('should handle deeply nested structures (5+ levels)', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo);

      const fileTree = [
        'src/plugins/auth/providers/oauth/google.ts',  // 5 levels
        'src/plugins/auth/providers/oauth/github.ts',  // 5 levels
        'src/plugins/auth/providers/basic/password.ts', // 5 levels
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const paths = context.directoryCoverage.map(d => d.path);

      // Should include directories at various depths
      assert.ok(
        paths.includes('src/plugins/auth/providers/oauth'),
        `Should include 5th-level dir. Got: ${paths.join(', ')}`
      );
    });
  });
});
