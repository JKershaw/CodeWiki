/**
 * Unit tests for ContextGatherer low-coverage files collection.
 *
 * Tests the new lowCoverageFiles field in OrchestratorContext that tracks
 * individual files with coverage < 50%, enabling coverage-aware file selection.
 *
 * TDD: Write tests before implementation.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Wiki page mock type with file tracking fields.
 */
interface MockWikiPage {
  path: string;
  content: string;
  filesAccessed?: string[];
  filesReferenced?: string[];
  targetPaths?: string[];
}

/**
 * Create mock repositories.
 */
function createMockRepos(wikiPages: MockWikiPage[] = []) {
  return {
    repos: {
      findById: mock.fn(async () => ({ id: 'repo-1', name: 'test-repo' })),
    },
    commits: {
      findByRepo: mock.fn(async () => []),
      countByRepo: mock.fn(async () => 0),
      countProcessedByAgent: mock.fn(async () => 0),
    },
    wikiPages: {
      findByWiki: mock.fn(async () => wikiPages.map((p, i) => ({
        id: `page-${i}`,
        wikiId: 'wiki-1',
        path: p.path,
        title: p.path.split('/').pop() ?? 'Untitled',
        content: p.content,
        confidence: 0.7,
        sourceCommits: [],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        filesAccessed: p.filesAccessed ?? [],
        filesReferenced: p.filesReferenced ?? [],
        targetPaths: p.targetPaths ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }))),
      findByPath: mock.fn(async () => null),
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
    fileExists: mock.fn(async (path: string) => fileTree.includes(path)),
    getCommitDiff: mock.fn(async () => ''),
    isLocal: () => false,
    getLocalPath: () => undefined,
  };

  return {
    create: mock.fn(async () => mockAccess),
  };
}

describe('ContextGatherer lowCoverageFiles', () => {
  describe('basic functionality', () => {
    it('returns files not covered by filesReferenced', async () => {
      const fileTree = [
        'src/agents/orchestrator.ts',
        'src/agents/base.ts',
        'src/services/llm.ts',
      ];

      // Wiki pages reference orchestrator.ts via filesReferenced (gets coverage)
      // but base.ts and llm.ts are not referenced (0% coverage)
      // Use enough content to give meaningful coverage score
      const wikiPages = [
        {
          path: 'architecture/orchestrator',
          content: 'x'.repeat(200), // 200 chars dedicated to orchestrator
          filesReferenced: ['src/agents/orchestrator.ts'],
        },
      ];

      const repos = createMockRepos(wikiPages);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have lowCoverageFiles field
      assert.ok(context.lowCoverageFiles, 'should have lowCoverageFiles field');
      assert.ok(Array.isArray(context.lowCoverageFiles), 'lowCoverageFiles should be an array');

      // base.ts and llm.ts should be in low coverage (not referenced)
      const paths = context.lowCoverageFiles.map(f => f.path);
      assert.ok(paths.includes('src/agents/base.ts'), 'should include base.ts');
      assert.ok(paths.includes('src/services/llm.ts'), 'should include llm.ts');

      // orchestrator.ts should NOT be in low coverage (referenced with enough content)
      assert.ok(!paths.includes('src/agents/orchestrator.ts'), 'should not include orchestrator.ts');
    });

    it('includes directory path for each file', async () => {
      const fileTree = [
        'src/agents/base.ts',
        'src/services/llm.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Each file should have its directory
      const baseFile = context.lowCoverageFiles.find(f => f.path === 'src/agents/base.ts');
      assert.ok(baseFile, 'should find base.ts');
      assert.strictEqual(baseFile.directory, 'src/agents');

      const llmFile = context.lowCoverageFiles.find(f => f.path === 'src/services/llm.ts');
      assert.ok(llmFile, 'should find llm.ts');
      assert.strictEqual(llmFile.directory, 'src/services');
    });

    it('includes graduated coverage percentages for each file', async () => {
      const fileTree = [
        'src/agents/base.ts',
        'src/agents/covered.ts',
      ];

      // covered.ts is referenced with substantial content (high coverage)
      // base.ts is not referenced (0% coverage)
      const wikiPages = [
        {
          path: 'docs/overview',
          content: 'x'.repeat(200), // 200 chars dedicated to covered.ts
          filesReferenced: ['src/agents/covered.ts'],
        },
      ];

      const repos = createMockRepos(wikiPages);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // base.ts should be in lowCoverageFiles with 0% coverage
      const baseFile = context.lowCoverageFiles.find(f => f.path === 'src/agents/base.ts');
      assert.ok(baseFile, 'should find base.ts');
      assert.strictEqual(baseFile.coverage, 0, 'should have 0% coverage (not referenced)');

      // covered.ts should NOT be in lowCoverageFiles (100% coverage from 200 chars / 1 file)
      const coveredFile = context.lowCoverageFiles.find(f => f.path === 'src/agents/covered.ts');
      assert.ok(!coveredFile, 'covered.ts should not be in lowCoverageFiles');
    });
  });

  describe('sorting', () => {
    it('sorts by coverage ascending (0% first)', async () => {
      const fileTree = [
        'src/agents/base.ts',
        'src/agents/registry.ts',
        'src/services/llm.ts',
      ];

      // registry.ts mentioned in passing (25%), others not mentioned (0%)
      const wikiPages = [
        { path: 'docs/overview', content: 'See registry.ts for agent registration.' },
      ];

      const repos = createMockRepos(wikiPages);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // 0% coverage files should come before 25% coverage
      const registryIndex = context.lowCoverageFiles.findIndex(f => f.path === 'src/agents/registry.ts');
      const baseIndex = context.lowCoverageFiles.findIndex(f => f.path === 'src/agents/base.ts');

      assert.ok(baseIndex < registryIndex, '0% coverage files should come before 25% coverage');
    });

    it('sorts by path length when coverage is equal (shorter first)', async () => {
      const fileTree = [
        'src/a.ts',
        'src/agents/orchestrator/strategies.ts',
        'src/agents/base.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // All have 0% coverage, so should sort by path length
      const paths = context.lowCoverageFiles.map(f => f.path);
      const aIndex = paths.indexOf('src/a.ts');
      const baseIndex = paths.indexOf('src/agents/base.ts');
      const strategiesIndex = paths.indexOf('src/agents/orchestrator/strategies.ts');

      assert.ok(aIndex < baseIndex, 'shorter path should come first');
      assert.ok(baseIndex < strategiesIndex, 'medium path should come before long path');
    });
  });

  describe('filtering', () => {
    it('filters out test files', async () => {
      const fileTree = [
        'src/agents/base.ts',
        'src/agents/base.test.ts',
        'src/agents/base.spec.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const paths = context.lowCoverageFiles.map(f => f.path);
      assert.ok(paths.includes('src/agents/base.ts'), 'should include source file');
      assert.ok(!paths.includes('src/agents/base.test.ts'), 'should exclude .test.ts');
      assert.ok(!paths.includes('src/agents/base.spec.ts'), 'should exclude .spec.ts');
    });

    it('filters out declaration files', async () => {
      const fileTree = [
        'src/types.ts',
        'src/types.d.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const paths = context.lowCoverageFiles.map(f => f.path);
      assert.ok(paths.includes('src/types.ts'), 'should include source file');
      assert.ok(!paths.includes('src/types.d.ts'), 'should exclude .d.ts');
    });
  });

  describe('edge cases', () => {
    it('handles empty wiki (all files are low coverage)', async () => {
      const fileTree = [
        'src/agents/base.ts',
        'src/services/llm.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // All source files should be in low coverage
      assert.strictEqual(context.lowCoverageFiles.length, 2);
    });

    it('handles no source files', async () => {
      const fileTree: string[] = [];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.deepStrictEqual(context.lowCoverageFiles, []);
    });

    it('handles missing repoAccessFactory', async () => {
      const repos = createMockRepos([]);
      const gatherer = new ContextGatherer(repos); // No repoAccessFactory

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.deepStrictEqual(context.lowCoverageFiles, []);
    });

    it('handles files in root directory', async () => {
      const fileTree = [
        'index.ts',
        'src/app.ts',
      ];

      const repos = createMockRepos([]);
      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Root files (no directory) might be skipped or have empty directory
      // This depends on implementation - test documents expected behavior
      const appFile = context.lowCoverageFiles.find(f => f.path === 'src/app.ts');
      assert.ok(appFile, 'should include nested file');
    });
  });
});
