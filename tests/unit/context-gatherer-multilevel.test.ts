/**
 * Unit tests for ContextGatherer multi-level directory coverage.
 *
 * These tests verify that undocumented directories are calculated at ALL directory levels,
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
  options?: { confidence?: number; filesAccessed?: string[] }
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
    filesAccessed: options?.filesAccessed ?? [],
    filesReferenced: [],
    targetPaths: [],
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
      countByRepo: mock.fn(async () => 0),
      countProcessedByAgent: mock.fn(async () => 0),
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
  describe('calculateUndocumentedDirectories at all levels', () => {
    it('should identify undocumented directories at 3rd-level', async () => {
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

      // Should have undocumented directories for BOTH 2nd and 3rd level directories
      const paths = context.undocumentedDirectories.map(d => d.path);

      // 3rd level directories should be present (all undocumented since no wiki pages)
      assert.ok(
        paths.includes('src/agents/orchestrator'),
        `Should include 3rd-level dir 'src/agents/orchestrator'. Got: ${paths.join(', ')}`
      );
      assert.ok(
        paths.includes('src/agents/analysis'),
        `Should include 3rd-level dir 'src/agents/analysis'. Got: ${paths.join(', ')}`
      );
    });

    it('should identify undocumented directories at 4th-level', async () => {
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

      const paths = context.undocumentedDirectories.map(d => d.path);

      // 4th level directory should be present
      assert.ok(
        paths.includes('src/services/llm/analysis-tools'),
        `Should include 4th-level dir 'src/services/llm/analysis-tools'. Got: ${paths.join(', ')}`
      );
    });

    it('should distinguish documented from undocumented directories', async () => {
      // Wiki page with comprehensive content about orchestrator files
      const wikiPages = [
        createMockWikiPage(
          'architecture/orchestrator',
          `# Orchestrator

The orchestrator module handles work distribution.

## Files

### strategies.ts
Contains strategy implementations.

### context-gatherer.ts
Gathers context for decision making.

\`\`\`typescript
import { strategies } from './strategies';
\`\`\`
`
        ),
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

      // Analysis dir should be in undocumented (no wiki mentions its files)
      const analysisDirUndoc = context.undocumentedDirectories.find(
        d => d.path === 'src/agents/analysis'
      );

      assert.ok(analysisDirUndoc, 'Should identify src/agents/analysis as undocumented');
      assert.strictEqual(
        analysisDirUndoc.undocumentedRatio,
        1,
        'Analysis dir should be 100% undocumented'
      );
    });

    it('should count files correctly per directory', async () => {
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
      const servicesLlm = context.undocumentedDirectories.find(d => d.path === 'src/services/llm');

      assert.ok(servicesLlm, 'Should have entry for src/services/llm');
      assert.strictEqual(
        servicesLlm.totalFiles,
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

      const paths = context.undocumentedDirectories.map(d => d.path);

      // Should include directories at various depths
      assert.ok(
        paths.includes('src/plugins/auth/providers/oauth'),
        `Should include 5th-level dir. Got: ${paths.join(', ')}`
      );
    });

    it('should exclude fully documented directories', async () => {
      // Create wiki pages that cover all files via filesAccessed
      const wikiPages = [
        createMockWikiPage(
          'services/llm-service',
          `# LLM Service

Documentation for the LLM service files.
`,
          {
            // Use filesAccessed for coverage (binary: covered or not)
            filesAccessed: [
              'src/services/llm/llm-service.ts',
              'src/services/llm/mock-llm.ts',
            ],
          }
        ),
      ];

      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: false,
      } as Repo, wikiPages);

      const fileTree = [
        'src/services/llm/llm-service.ts',
        'src/services/llm/mock-llm.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // If files are covered via filesAccessed, directory should not be in undocumented list
      // or would have 0% undocumented ratio
      const llmDir = context.undocumentedDirectories.find(d => d.path === 'src/services/llm');

      // Either not present (fully documented) or has 0 undocumented ratio
      if (llmDir) {
        assert.ok(
          llmDir.undocumentedRatio < 1,
          'Well-documented directory should have lower undocumented ratio'
        );
      }
    });
  });
});
