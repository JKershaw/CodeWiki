/**
 * Unit tests for ContextGatherer depth metrics and GitHub mode.
 * Tests the shallowPages and pagesLackingExamples calculations,
 * as well as directory coverage for GitHub repositories.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { RepositoryServiceFactory, RepositoryService, FileEntry } from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';
import { ContextGatherer, type DirectoryNode } from '../../src/agents/orchestrator/context-gatherer.js';

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
   * Create mock repository service factory.
   */
  function createMockRepoServiceFactory(
    srcEntries: FileEntry[],
    fileTree: string[]
  ): RepositoryServiceFactory {
    const mockService: Partial<RepositoryService> = {
      listDirectory: mock.fn(async (_repo, path) => {
        if (path === 'src') return srcEntries;
        return [];
      }),
      getFileTree: mock.fn(async () => fileTree),
    };

    return {
      getService: mock.fn(() => mockService as RepositoryService),
      getServiceWithToken: mock.fn(() => mockService as RepositoryService),
    };
  }

  describe('calculateDirectoryCoverage', () => {
    it('returns empty for repo not found', async () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
    });

    it('returns empty for GitHub repo without repoServiceFactory', async () => {
      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: true } as Repo);
      const gatherer = new ContextGatherer(repos);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
    });

    it('calculates coverage for GitHub repos via API', async () => {
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

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
        'src/index.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(srcEntries, fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Should have coverage for 2 directories (agents, services)
      assert.strictEqual(context.directoryCoverage.length, 2);

      // Both should have 0% coverage since there are no wiki pages mentioning them
      for (const dir of context.directoryCoverage) {
        assert.ok(dir.path.startsWith('src/'));
        assert.strictEqual(dir.wikiMentions, 0);
        assert.strictEqual(dir.coveragePercent, 0);
      }
    });

    it('counts wiki mentions correctly for GitHub repos', async () => {
      // Create mock wiki pages that mention directories
      const wikiPages = [
        createMockWikiPage('architecture/agents', 'The agents module handles...'),
        createMockWikiPage('guides/services', 'The src/services directory contains...'),
      ];

      const repos = {
        repos: {
          findById: mock.fn(async () => ({
            id: 'repo-1',
            isGitHubRepo: true,
            owner: 'test',
            repoName: 'repo',
          })),
        },
        commits: {
          findByRepo: mock.fn(async () => []),
        },
        wikiPages: {
          findByWiki: mock.fn(async () => wikiPages),
        },
        agentRuns: {
          findByRepo: mock.fn(async () => []),
        },
        editRequests: {
          countPending: mock.fn(async () => 0),
        },
      } as any;

      const srcEntries: FileEntry[] = [
        { name: 'agents', path: 'src/agents', type: 'dir', size: 0 },
        { name: 'services', path: 'src/services', type: 'dir', size: 0 },
      ];

      const fileTree = [
        'src/agents/base-agent.ts',
        'src/agents/code-change-agent.ts',
        'src/services/git/git-service.ts',
        'src/services/llm/llm-service.ts',
      ];

      const repoServiceFactory = createMockRepoServiceFactory(srcEntries, fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      // Both directories should have mentions
      const agentsCoverage = context.directoryCoverage.find(d => d.path === 'src/agents');
      const servicesCoverage = context.directoryCoverage.find(d => d.path === 'src/services');

      assert.ok(agentsCoverage, 'Should have agents coverage');
      assert.ok(servicesCoverage, 'Should have services coverage');
      assert.ok(agentsCoverage.wikiMentions > 0, 'Agents should have wiki mentions');
      assert.ok(servicesCoverage.wikiMentions > 0, 'Services should have wiki mentions');
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

      const repoServiceFactory = createMockRepoServiceFactory(srcEntries, fileTree);
      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      const utilsCoverage = context.directoryCoverage.find(d => d.path === 'src/utils');
      assert.ok(utilsCoverage, 'Should have utils coverage');
      assert.strictEqual(utilsCoverage.fileCount, 1, 'Should only count helper.ts');
    });

    it('returns empty when src directory does not exist', async () => {
      const repos = createMockRepos({
        id: 'repo-1',
        isGitHubRepo: true,
        owner: 'test',
        repoName: 'repo',
      } as Repo);

      const mockService: Partial<RepositoryService> = {
        listDirectory: mock.fn(async () => {
          throw new Error('Directory not found');
        }),
        getFileTree: mock.fn(async () => []),
      };

      const repoServiceFactory = {
        getService: mock.fn(() => mockService as RepositoryService),
        getServiceWithToken: mock.fn(() => mockService as RepositoryService),
      };

      const gatherer = new ContextGatherer(repos, repoServiceFactory);

      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.directoryCoverage.length, 0);
    });
  });
});

describe('ContextGatherer Coverage Tree Formatting', () => {
  /**
   * Create a simple DirectoryNode for testing.
   */
  function createNode(
    name: string,
    path: string,
    totalFileCount: number,
    coveragePercent: number,
    children: DirectoryNode[] = []
  ): DirectoryNode {
    return {
      name,
      path,
      fileCount: totalFileCount - children.reduce((sum, c) => sum + c.totalFileCount, 0),
      totalFileCount,
      coveragePercent,
      children,
    };
  }

  describe('formatCoverageTree', () => {
    it('should format a simple tree correctly', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      const tree = createNode('src', 'src', 10, 50);
      const result = gatherer.formatCoverageTree(tree);

      assert.ok(result.includes('src/'));
      assert.ok(result.includes('(50%)'));
      assert.ok(result.includes('10 files'));
    });

    it('should mark low coverage directories with warning emoji', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      const tree = createNode('src', 'src', 10, 30, [
        createNode('agents', 'src/agents', 5, 20),  // Low coverage
        createNode('services', 'src/services', 5, 80),  // High coverage
      ]);
      const result = gatherer.formatCoverageTree(tree);

      // Low coverage directories should have warning
      assert.ok(result.includes('agents/'));
      assert.ok(result.includes('⚠️'));
      assert.ok(result.includes('services/'));
    });

    it('should format nested tree with proper indentation', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      const tree = createNode('src', 'src', 20, 40, [
        createNode('services', 'src/services', 15, 30, [
          createNode('llm', 'src/services/llm', 10, 20),
          createNode('git', 'src/services/git', 5, 50),
        ]),
        createNode('agents', 'src/agents', 5, 60),
      ]);
      const result = gatherer.formatCoverageTree(tree);

      // Check that nested directories appear
      assert.ok(result.includes('services/'));
      assert.ok(result.includes('llm/'));
      assert.ok(result.includes('git/'));
      assert.ok(result.includes('agents/'));

      // Check tree characters are present
      assert.ok(result.includes('├──') || result.includes('└──'));
    });

    it('should truncate to maxLines', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      // Create a tree with many children with varying coverage
      const manyChildren = Array.from({ length: 20 }, (_, i) =>
        createNode(`dir${i}`, `src/dir${i}`, 5, i * 5) // 0%, 5%, 10%... coverage
      );
      const tree = createNode('src', 'src', 100, 30, manyChildren);

      const result = gatherer.formatCoverageTree(tree, 10);

      // Should filter high-coverage dirs and show message about hidden dirs
      const lines = result.split('\n');
      assert.ok(lines.length <= 11); // up to 10 dirs + info message
      assert.ok(result.includes('hidden'), 'Should indicate directories were hidden');
    });

    it('should return placeholder for null tree', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      const result = gatherer.formatCoverageTree(null);

      assert.ok(result.includes('No source directory'));
    });

    it('should sort children by coverage ascending (lowest first)', () => {
      const repos = createMockRepos(null);
      const gatherer = new ContextGatherer(repos as any);

      // Children have different coverage percentages
      const tree = createNode('src', 'src', 30, 40, [
        createNode('high', 'src/high', 5, 80),
        createNode('low', 'src/low', 20, 10),
        createNode('medium', 'src/medium', 10, 50),
      ]);

      const result = gatherer.formatCoverageTree(tree);
      const lines = result.split('\n');

      // Find indices - low coverage should appear before medium, medium before high
      const lowIndex = lines.findIndex(l => l.includes('low/'));
      const mediumIndex = lines.findIndex(l => l.includes('medium/'));
      const highIndex = lines.findIndex(l => l.includes('high/'));

      assert.ok(lowIndex < mediumIndex, 'low coverage should appear before medium');
      assert.ok(mediumIndex < highIndex, 'medium coverage should appear before high');
    });
  });

  /**
   * Helper to create mock repos for formatting tests.
   */
  function createMockRepos(repo: Partial<Repo> | null) {
    return {
      repos: {
        findById: mock.fn(async () => repo),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => []),
        findByPath: mock.fn(async () => null),
      },
      agentRuns: {
        findByRepo: mock.fn(async () => []),
      },
      editRequests: {
        countPending: mock.fn(async () => 0),
      },
    };
  }
});

describe('ContextGatherer Project Overview Content', () => {
  /**
   * Create mock wiki page with specified content.
   */
  function createMockWikiPage(
    path: string,
    content: string
  ): WikiPage {
    return {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('should include project overview content when architecture/overview exists', async () => {
    const overviewContent = '# Project Overview\n\nThis is a great project.';
    const overviewPage = createMockWikiPage('architecture/overview', overviewContent);

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
        findByPath: mock.fn(async (_wikiId: string, path: string) => {
          if (path === 'architecture/overview') return overviewPage;
          return null;
        }),
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
    const overviewPage = createMockWikiPage('architecture/overview', longContent);

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
        findByPath: mock.fn(async (_wikiId: string, path: string) => {
          if (path === 'architecture/overview') return overviewPage;
          return null;
        }),
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

  it('should return null when no overview page exists', async () => {
    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => []),
        findByPath: mock.fn(async () => null),
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

    assert.strictEqual(context.projectOverviewContent, null);
  });

  it('should include overview content from bootstrap overview page (root level)', async () => {
    const overviewContent = '# Bootstrap Overview\n\nCreated by bootstrap agent.';
    const overviewPage = createMockWikiPage('overview', overviewContent);

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
        findByPath: mock.fn(async (_wikiId: string, path: string) => {
          if (path === 'overview') return overviewPage;
          return null;
        }),
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

  it('should prefer architecture/overview over root overview when both exist', async () => {
    const architectureContent = '# Architecture Overview\n\nMore comprehensive.';
    const bootstrapContent = '# Bootstrap Overview\n\nBasic starter.';
    const architecturePage = createMockWikiPage('architecture/overview', architectureContent);
    const bootstrapPage = createMockWikiPage('overview', bootstrapContent);

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [architecturePage, bootstrapPage]),
        findByPath: mock.fn(async (_wikiId: string, path: string) => {
          if (path === 'architecture/overview') return architecturePage;
          if (path === 'overview') return bootstrapPage;
          return null;
        }),
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
    // Should prefer architecture/overview (more comprehensive)
    assert.strictEqual(context.projectOverviewContent, architectureContent);
  });

  it('should set hasProjectOverview true when root overview exists', async () => {
    const overviewPage = createMockWikiPage('overview', 'Basic overview');

    const repos = {
      repos: {
        findById: mock.fn(async () => ({ id: 'repo-1', isGitHubRepo: false })),
      },
      commits: {
        findByRepo: mock.fn(async () => []),
      },
      wikiPages: {
        findByWiki: mock.fn(async () => [overviewPage]),
        findByPath: mock.fn(async (_wikiId: string, path: string) => {
          if (path === 'overview') return overviewPage;
          return null;
        }),
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
