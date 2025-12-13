/**
 * Unit tests for ContextGatherer Quality Gaps formatting.
 * Tests that quality gap issues include specific file references.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';
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
  options?: {
    confidence?: number;
    links?: string[];
  }
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
    links: options?.links ?? [],
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

describe('ContextGatherer Quality Gaps with File Lists', () => {
  describe('gather() returns page path lists', () => {
    it('should return shallowPagesList with page paths', async () => {
      const wikiPages = [
        createMockWikiPage('guides/intro', 'Short content'), // Shallow (<500 chars)
        createMockWikiPage('architecture/cqrs', 'A'.repeat(600)), // Not shallow
        createMockWikiPage('patterns/repo', 'Tiny'), // Shallow
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.shallowPages, 2);
      assert.ok(context.shallowPagesList, 'Should have shallowPagesList');
      assert.strictEqual(context.shallowPagesList.length, 2);
      assert.ok(context.shallowPagesList.includes('guides/intro'));
      assert.ok(context.shallowPagesList.includes('patterns/repo'));
    });

    it('should return pagesLackingExamplesList with page paths', async () => {
      const wikiPages = [
        createMockWikiPage('guides/intro', 'Some content with ```code block```'),
        createMockWikiPage('architecture/cqrs', 'Content without code examples - long enough'.repeat(20)),
        createMockWikiPage('patterns/repo', 'No examples here either'.repeat(25)),
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.pagesLackingExamples, 2);
      assert.ok(context.pagesLackingExamplesList, 'Should have pagesLackingExamplesList');
      assert.strictEqual(context.pagesLackingExamplesList.length, 2);
      assert.ok(context.pagesLackingExamplesList.includes('architecture/cqrs'));
      assert.ok(context.pagesLackingExamplesList.includes('patterns/repo'));
    });

    it('should return pagesWithoutLinksList with page paths', async () => {
      const wikiPages = [
        createMockWikiPage('guides/intro', 'Content', { links: ['guides/other'] }),
        createMockWikiPage('architecture/cqrs', 'Content', { links: [] }), // No links
        createMockWikiPage('patterns/repo', 'Content', { links: [] }), // No links
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');

      assert.strictEqual(context.pagesWithoutLinks, 2);
      assert.ok(context.pagesWithoutLinksList, 'Should have pagesWithoutLinksList');
      assert.strictEqual(context.pagesWithoutLinksList.length, 2);
      assert.ok(context.pagesWithoutLinksList.includes('architecture/cqrs'));
      assert.ok(context.pagesWithoutLinksList.includes('patterns/repo'));
    });
  });

  describe('formatForPrompt() includes file names', () => {
    it('should list shallow page paths in Quality Gaps section', async () => {
      const wikiPages = [
        createMockWikiPage('guides/intro', 'Short'),
        createMockWikiPage('patterns/repo', 'Tiny'),
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');
      const formatted = gatherer.formatForPrompt(context);

      assert.ok(formatted.includes('## Quality Gaps'), 'Should have Quality Gaps section');
      assert.ok(formatted.includes('guides/intro'), 'Should list shallow page path');
      assert.ok(formatted.includes('patterns/repo'), 'Should list shallow page path');
    });

    it('should list pages lacking examples in Quality Gaps section', async () => {
      const wikiPages = [
        createMockWikiPage('architecture/cqrs', 'Long content without code'.repeat(30)),
        createMockWikiPage('patterns/factory', 'Also no code examples'.repeat(30)),
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');
      const formatted = gatherer.formatForPrompt(context);

      assert.ok(formatted.includes('## Quality Gaps'));
      assert.ok(formatted.includes('architecture/cqrs'), 'Should list page lacking examples');
      assert.ok(formatted.includes('patterns/factory'), 'Should list page lacking examples');
    });

    it('should list pages without links in Quality Gaps section', async () => {
      const wikiPages = [
        createMockWikiPage('guides/testing', 'Content', { links: [] }),
        createMockWikiPage('architecture/overview', 'Content', { links: ['other'] }),
      ];

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');
      const formatted = gatherer.formatForPrompt(context);

      assert.ok(formatted.includes('## Quality Gaps'));
      assert.ok(formatted.includes('guides/testing'), 'Should list page without links');
    });

    it('should truncate long lists of pages', async () => {
      // Create many shallow pages
      const wikiPages = Array.from({ length: 20 }, (_, i) =>
        createMockWikiPage(`page/item-${i}`, 'Short')
      );

      const repos = createMockRepos({ id: 'repo-1', isGitHubRepo: false } as Repo, wikiPages);
      const gatherer = new ContextGatherer(repos);
      const context = await gatherer.gather('repo-1', 'wiki-1');
      const formatted = gatherer.formatForPrompt(context);

      // Should have some indication of more pages
      assert.ok(formatted.includes('## Quality Gaps'));
      // Should show first few and indicate there are more
      assert.ok(
        formatted.includes('more') || formatted.includes('...') || formatted.includes('+'),
        'Should indicate truncation for long lists'
      );
    });
  });
});
