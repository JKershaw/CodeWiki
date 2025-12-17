/**
 * Unit tests for ContextGatherer depth metrics and GitHub mode.
 * Tests the shallowPages and pagesLackingExamples calculations,
 * as well as directory coverage for GitHub repositories.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage, SynthesisType } from '../../src/domain/wiki-page.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess, FileEntry } from '../../src/services/repository/unified-repo-access.js';
import type { Repo } from '../../src/domain/repo.js';
import { ContextGatherer } from '../../src/agents/orchestrator/context-gatherer.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Helper to create a mock wiki page with specified content.
 */
function createMockWikiPage(
  path: string,
  content: string,
  options?: {
    title?: string;
    confidence?: number;
  }
): WikiPage {
  return {
    id: `page-${path.replace(/\//g, '-')}`,
    wikiId: 'wiki-1',
    path,
    title: options?.title ?? path.split('/').pop() ?? 'Untitled',
    content,
    confidence: options?.confidence ?? 0.7,
    sourceCommits: [],
    sourceAgentRunIds: [],
    links: [],
    backlinks: [],
    filesAccessed: [],
    filesReferenced: [],
    targetPaths: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Calculate shallow pages count.
 * A page is shallow if:
 * - Content length < 500 characters
 * - NOT an overview or index page (these are expected to be shorter)
 */
function calculateShallowPages(pages: WikiPage[]): number {
  return pages.filter(p => {
    // Exclude overview and index pages
    if (p.path.endsWith('/overview') || p.path.endsWith('/index')) {
      return false;
    }
    // Shallow if content is less than 500 characters
    return p.content.length < 500;
  }).length;
}

/**
 * Calculate pages lacking examples count.
 * A page lacks examples if:
 * - No fenced code blocks (```)
 * - NOT an overview or index page (these may not need code examples)
 */
function calculatePagesLackingExamples(pages: WikiPage[]): number {
  return pages.filter(p => {
    // Exclude overview and index pages
    if (p.path.endsWith('/overview') || p.path.endsWith('/index')) {
      return false;
    }
    // Lacks examples if no fenced code blocks
    return !p.content.includes('```');
  }).length;
}

describe('ContextGatherer Depth Metrics', () => {
  describe('shallowPages calculation', () => {
    it('should count pages with less than 500 characters as shallow', () => {
      const pages = [
        createMockWikiPage('architecture/cqrs', 'Short content'), // ~13 chars - shallow
        createMockWikiPage('patterns/repository', 'A'.repeat(499)), // 499 chars - shallow
        createMockWikiPage('patterns/factory', 'B'.repeat(500)), // 500 chars - NOT shallow
        createMockWikiPage('guides/testing', 'C'.repeat(1000)), // 1000 chars - NOT shallow
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 2, 'Should count 2 shallow pages');
    });

    it('should exclude overview pages from shallow count', () => {
      const pages = [
        createMockWikiPage('architecture/overview', 'Short overview'), // Excluded
        createMockWikiPage('patterns/index', 'Short index'), // Excluded
        createMockWikiPage('guides/intro', 'Short intro'), // Counted as shallow
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 1, 'Should only count non-overview shallow pages');
    });

    it('should return 0 when all pages have sufficient content', () => {
      const pages = [
        createMockWikiPage('architecture/cqrs', 'A'.repeat(600)),
        createMockWikiPage('patterns/repository', 'B'.repeat(1000)),
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 0, 'Should return 0 when no shallow pages');
    });

    it('should return 0 for empty pages array', () => {
      const shallowCount = calculateShallowPages([]);
      assert.strictEqual(shallowCount, 0, 'Should return 0 for empty array');
    });

    it('should handle pages at exact 500 character boundary', () => {
      const pages = [
        createMockWikiPage('page/exactly-500', 'A'.repeat(500)), // NOT shallow (>= 500)
        createMockWikiPage('page/just-under', 'B'.repeat(499)), // shallow (< 500)
      ];

      const shallowCount = calculateShallowPages(pages);
      assert.strictEqual(shallowCount, 1, 'Should count only pages under 500 chars');
    });
  });

  describe('pagesLackingExamples calculation', () => {
    it('should count pages without code blocks as lacking examples', () => {
      const pageWithCode = createMockWikiPage(
        'architecture/cqrs',
        '# CQRS Pattern\n\nExample:\n```typescript\nconst query = createQuery();\n```'
      );
      const pageWithoutCode = createMockWikiPage(
        'patterns/repository',
        '# Repository Pattern\n\nThe repository pattern abstracts data access.'
      );

      const pages = [pageWithCode, pageWithoutCode];
      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should count 1 page lacking examples');
    });

    it('should exclude overview pages from lacking examples count', () => {
      const pages = [
        createMockWikiPage('architecture/overview', 'Overview without code'), // Excluded
        createMockWikiPage('patterns/index', 'Index without code'), // Excluded
        createMockWikiPage('guides/intro', 'Intro without code'), // Counted
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should only count non-overview pages');
    });

    it('should recognize various code block formats', () => {
      const pages = [
        createMockWikiPage('page/typescript', '```typescript\ncode\n```'),
        createMockWikiPage('page/javascript', '```js\ncode\n```'),
        createMockWikiPage('page/plain', '```\ncode\n```'),
        createMockWikiPage('page/no-code', 'No code blocks here'),
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 1, 'Should only count page without any code blocks');
    });

    it('should return 0 when all pages have code examples', () => {
      const pages = [
        createMockWikiPage('page/a', 'Content with ```code```'),
        createMockWikiPage('page/b', 'More content\n```\nexample\n```'),
      ];

      const lackingCount = calculatePagesLackingExamples(pages);
      assert.strictEqual(lackingCount, 0, 'Should return 0 when all pages have examples');
    });

    it('should return 0 for empty pages array', () => {
      const lackingCount = calculatePagesLackingExamples([]);
      assert.strictEqual(lackingCount, 0, 'Should return 0 for empty array');
    });

    it('should not count inline code as examples', () => {
      const pageWithInlineOnly = createMockWikiPage(
        'page/inline',
        'Use the `createQuery()` function to create queries.'
      );

      const lackingCount = calculatePagesLackingExamples([pageWithInlineOnly]);
      assert.strictEqual(lackingCount, 1, 'Inline code should not count as examples');
    });
  });

  describe('combined metrics', () => {
    it('should correctly calculate both metrics for mixed pages', () => {
      const pages = [
        // Shallow AND lacking examples
        createMockWikiPage('page/shallow-no-code', 'Short content without code'),
        // Shallow but HAS examples
        createMockWikiPage('page/shallow-with-code', 'Short ```code```'),
        // Not shallow AND has examples
        createMockWikiPage('page/good', 'A'.repeat(600) + '\n```typescript\ncode\n```'),
        // Not shallow but lacking examples
        createMockWikiPage('page/long-no-code', 'A'.repeat(600)),
        // Overview pages (excluded from both)
        createMockWikiPage('category/overview', 'Short overview'),
        createMockWikiPage('category/index', 'Short index'),
      ];

      const shallowCount = calculateShallowPages(pages);
      const lackingCount = calculatePagesLackingExamples(pages);

      assert.strictEqual(shallowCount, 2, 'Should count 2 shallow pages');
      assert.strictEqual(lackingCount, 2, 'Should count 2 pages lacking examples');
    });
  });
});

describe('ContextGatherer GitHub Mode', () => {
  /**
   * Create mock repositories for testing.
   */
  function createMockRepos(repo: Partial<Repo> | null) {
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
        findByWiki: mock.fn(async () => []),
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
   * Create mock UnifiedRepoAccess factory.
   */
  function createMockRepoAccessFactory(
    srcEntries: FileEntry[],
    fileTree: string[]
  ): UnifiedRepoAccessFactory {
    const mockAccess: Partial<UnifiedRepoAccess> = {
      listDirectory: mock.fn(async (path: string) => {
        if (path === 'src') return srcEntries;
        return [];
      }),
      getFileTree: mock.fn(async () => fileTree),
      isLocal: () => false,
      getLocalPath: () => undefined,
    };

    return {
      create: mock.fn(async () => mockAccess as UnifiedRepoAccess),
    };
  }

  describe('calculateUndocumentedDirectories', () => {
    it('returns empty for repo not found', async () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
    });

    it('returns empty for GitHub repo without repoAccessFactory', async () => {
      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: true } as Repo);
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
    });

    it('identifies undocumented directories for GitHub repos via API', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: true,
        owner: 'test',
        repoName: 'repo',
      } as Repo);

      const srcEntries: FileEntry[] = [
        { name: 'agents', path: 'src/agents', type: 'dir', size: 0 },
        { name: 'services', path: 'src/services', type: 'dir', size: 0 },
        { name: 'index.ts', path: 'src/index.ts', type: 'file', size: 100 },
      ];

      // Note: Files are counted toward their IMMEDIATE parent directory
      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
        'src/index.ts',
      ];

      const repoAccessFactory = createMockRepoAccessFactory(srcEntries, fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have undocumented directories since no wiki pages exist
      assert.ok(context.undocumentedDirectories.length > 0, 'Should find undocumented directories');

      // All should be 100% undocumented since there are no wiki pages
      for (const dir of context.undocumentedDirectories) {
        // Paths should start with 'src' (either 'src' or 'src/...')
        assert.ok(dir.path.startsWith('src'), `Path should start with src: ${dir.path}`);
        assert.strictEqual(dir.undocumentedRatio, 1, 'Should be 100% undocumented');
      }
    });

    it('filters out test and declaration files', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: true,
        owner: 'test',
        repoName: 'repo',
      } as Repo);

      const srcEntries: FileEntry[] = [
        { name: 'utils', path: 'src/utils', type: 'dir', size: 0 },
      ];

      const fileTree = [
        'src/utils/helper.ts',
        'src/utils/helper.test.ts',  // Should be excluded
        'src/utils/helper.spec.ts',  // Should be excluded
        'src/utils/types.d.ts',      // Should be excluded
      ];

      const repoAccessFactory = createMockRepoAccessFactory(srcEntries, fileTree);
      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const utilsDir = context.undocumentedDirectories.find(d => d.path === 'src/utils');
      assert.ok(utilsDir, 'Should have utils directory');
      assert.strictEqual(utilsDir.totalFiles, 1, 'Should only count helper.ts');
    });

    it('returns empty when src directory does not exist', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: true,
        owner: 'test',
        repoName: 'repo',
      } as Repo);

      const mockAccess: Partial<UnifiedRepoAccess> = {
        listDirectory: mock.fn(async () => {
          throw new Error('Directory not found');
        }),
        getFileTree: mock.fn(async () => []),
        isLocal: () => false,
        getLocalPath: () => undefined,
      };

      const repoAccessFactory: UnifiedRepoAccessFactory = {
        create: mock.fn(async () => mockAccess as UnifiedRepoAccess),
      };

      const gatherer = new ContextGatherer(repos, repoAccessFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.undocumentedDirectories.length, 0);
    });
  });
});

describe('ContextGatherer Project Overview Content', () => {
  /**
   * Create mock wiki page with specified content.
   * Note: synthesisType must be set to 'project-overview' for pages to be
   * recognized as project overviews (not just path-based matching).
   */
  function createMockWikiPage(
    path: string,
    content: string,
    synthesisType?: SynthesisType
  ): WikiPage {
    const page: WikiPage = {
      id: `page-${path.replace(/\//g, '-')}`,
      wikiId: 'wiki-1',
      path,
      title: path.split('/').pop() ?? 'Untitled',
      content,
      confidence: 0.8,
      sourceCommits: [],
      sourceAgentRunIds: [],
      links: [],
      backlinks: [],
      filesAccessed: [],
      filesReferenced: [],
      targetPaths: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (synthesisType) {
      page.synthesisType = synthesisType;
    }
    return page;
  }

  it('should include project overview content when page has synthesisType project-overview', async () => {
    const overviewContent = '# Project Overview\n\nThis is a great project.';
    // Key: synthesisType must be set for the page to be recognized as project overview
    const overviewPage = createMockWikiPage('overview', overviewContent, 'project-overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    assert.strictEqual(context.projectOverviewContent, overviewContent);
  });

  it('should truncate long overview content to 4000 chars', async () => {
    const longContent = 'A'.repeat(5000);
    const overviewPage = createMockWikiPage('overview', longContent, 'project-overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    assert.ok(context.projectOverviewContent);
    // Should be truncated to ~4000 chars + truncation message
    assert.ok(context.projectOverviewContent.length < 5000);
    assert.ok(context.projectOverviewContent.length > 4000); // At least 4000 chars preserved
    assert.ok(context.projectOverviewContent.includes('[... truncated ...]'));
  });

  it('should report hasProjectOverview false when page exists without synthesisType', async () => {
    // Page exists at target path but without synthesisType
    // hasProjectOverview should be false - this triggers the synthesis agent
    // The synthesis agent will UPDATE the page (adding synthesisType)
    const pathOverview = createMockWikiPage('architecture/overview', 'Category overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [pathOverview]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    // hasProjectOverview false (no synthesisType) - synthesis agent will run and UPDATE
    assert.strictEqual(context.hasProjectOverview, false);
    assert.strictEqual(context.projectOverviewContent, null);
  });

  it('should detect project overview via synthesisType not path', async () => {
    const overviewContent = '# Project Overview\n\nCreated by project-overview agent.';
    const overviewPage = createMockWikiPage('overview', overviewContent, 'project-overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    assert.strictEqual(context.hasProjectOverview, true);
    assert.strictEqual(context.projectOverviewContent, overviewContent);
  });

  it('should use page with project-overview synthesisType, not path-based category overview', async () => {
    const synthesisContent = '# Project Overview\n\nComprehensive synthesis.';
    const categoryContent = '# Architecture Overview\n\nCategory-specific overview.';
    // Only the synthesis page has synthesisType
    const synthesisPage = createMockWikiPage('overview', synthesisContent, 'project-overview');
    const categoryPage = createMockWikiPage('architecture/overview', categoryContent);

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [categoryPage, synthesisPage]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    assert.strictEqual(context.hasProjectOverview, true);
    // Should use the synthesis page (has synthesisType), not the category overview
    assert.strictEqual(context.projectOverviewContent, synthesisContent);
  });

  it('should set hasProjectOverview true only when synthesisType is set', async () => {
    const overviewPage = createMockWikiPage('overview', 'Basic overview', 'project-overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
        countByRepo: mock.fn(async () => 0),
        countProcessedByAgent: mock.fn(async () => 0),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    } as any;

    const gatherer = new ContextGatherer(repos);
    const context = await gatherer.gather('repo-1', 'wiki-1');

    assert.strictEqual(context.hasProjectOverview, true);
  });
});
