/**
 * Unit tests for update-wiki-page command.
 * Tests title extraction and page update operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  extractTitle,
  extractTitleFromPath,
  extractTitleWithFallback,
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import { createWikiPage, type WikiPage } from '../../src/domain/wiki-page.js';
import type { Repositories } from '../../src/repositories/index.js';

describe('extractTitle', () => {
  it('extracts title from H1 heading at start of content', () => {
    const content = '# My Page Title\n\nSome content here.';
    assert.strictEqual(extractTitle(content), 'My Page Title');
  });

  it('extracts title from H1 heading not at start of content', () => {
    const content = 'Some intro text\n\n# The Real Title\n\nMore content.';
    assert.strictEqual(extractTitle(content), 'The Real Title');
  });

  it('returns Untitled when no H1 heading exists', () => {
    const content = 'No heading here, just text.';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });

  it('returns Untitled for empty content', () => {
    assert.strictEqual(extractTitle(''), 'Untitled');
  });

  it('ignores H2 and lower headings', () => {
    const content = '## H2 Heading\n\n### H3 Heading';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });

  it('extracts first H1 when multiple exist', () => {
    const content = '# First Title\n\n# Second Title';
    assert.strictEqual(extractTitle(content), 'First Title');
  });

  it('handles H1 with extra whitespace', () => {
    // Title is trimmed to remove leading/trailing whitespace
    const content = '#   Title With Spaces   \n\nContent';
    assert.strictEqual(extractTitle(content), 'Title With Spaces');
  });

  it('handles H1 with special characters', () => {
    const content = '# My Title: A Story (Part 1)\n\nContent';
    assert.strictEqual(extractTitle(content), 'My Title: A Story (Part 1)');
  });

  it('extracts title from H1 without space after # (lenient parsing)', () => {
    // LLMs sometimes generate `#Title` without a space - we handle this gracefully
    const content = '#NoSpaceTitle\n\nContent';
    assert.strictEqual(extractTitle(content), 'NoSpaceTitle');
  });

  it('extracts title from H1 with zero spaces after #', () => {
    const content = '#ZeroSpaceTitle\n\nSome content here.';
    assert.strictEqual(extractTitle(content), 'ZeroSpaceTitle');
  });

  it('returns Untitled when H1 has only whitespace after #', () => {
    const content = '#    \n\nContent';
    assert.strictEqual(extractTitle(content), 'Untitled');
  });
});

describe('extractTitleFromPath', () => {
  it('extracts title from simple path', () => {
    assert.strictEqual(extractTitleFromPath('overview'), 'Overview');
  });

  it('extracts title from path with directory', () => {
    assert.strictEqual(extractTitleFromPath('architecture/overview'), 'Overview');
  });

  it('converts hyphens to spaces and capitalizes', () => {
    assert.strictEqual(extractTitleFromPath('architecture/cqrs-pattern'), 'Cqrs Pattern');
  });

  it('handles deep paths', () => {
    assert.strictEqual(extractTitleFromPath('docs/guides/getting-started'), 'Getting Started');
  });

  it('returns Untitled for empty path', () => {
    assert.strictEqual(extractTitleFromPath(''), 'Untitled');
  });

  it('handles path ending with slash', () => {
    // Split on '/' and pop returns empty string
    assert.strictEqual(extractTitleFromPath('test/'), 'Untitled');
  });
});

describe('extractTitleWithFallback', () => {
  it('extracts title from content when H1 exists', () => {
    const content = '# My Page Title\n\nContent here.';
    assert.strictEqual(extractTitleWithFallback(content, 'test/page'), 'My Page Title');
  });

  it('falls back to path when no H1 in content', () => {
    const content = 'No heading here, just text.';
    assert.strictEqual(extractTitleWithFallback(content, 'architecture/system-design'), 'System Design');
  });

  it('prefers content H1 over path-based title', () => {
    const content = '# Explicit Title\n\nContent.';
    assert.strictEqual(extractTitleWithFallback(content, 'different/path-name'), 'Explicit Title');
  });

  it('falls back to path for empty content', () => {
    assert.strictEqual(extractTitleWithFallback('', 'test/my-page'), 'My Page');
  });

  it('handles H1 without space (lenient) before falling back', () => {
    const content = '#DirectTitle\n\nContent.';
    assert.strictEqual(extractTitleWithFallback(content, 'fallback/path'), 'DirectTitle');
  });
});

// Create a minimal mock repositories object for testing page updates
function createMockRepos(): Repositories & { _pages: Map<string, WikiPage> } {
  const pages = new Map<string, WikiPage>();
  const histories: unknown[] = [];

  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async (id) => pages.get(id) ?? null,
    findByPath: async (wikiId, path) => {
      for (const page of pages.values()) {
        if (page.wikiId === wikiId && page.path === path) return page;
      }
      return null;
    },
    findByWiki: async (wikiId) => {
      return Array.from(pages.values()).filter(p => p.wikiId === wikiId);
    },
    findLowConfidence: async () => [],
    findRecentlyUpdated: async () => [],
    search: async () => [],
    save: async (page) => { pages.set(page.id, page); },
    delete: async (id) => { pages.delete(id); },
    deleteByWiki: async () => {},
    updateContent: async (id, updates) => {
      const page = pages.get(id);
      if (page) {
        page.content = updates.content;
        if (updates.title !== undefined) {
          page.title = updates.title;
        }
        if (updates.confidence !== undefined) {
          page.confidence = updates.confidence;
        }
        page.updatedAt = new Date();
      }
    },
    addBacklink: async () => {},
    removeBacklink: async () => {},
    updateLinks: async () => {},
  };

  const mockWikiPageHistory: Repositories['wikiPageHistory'] = {
    save: async (history) => { histories.push(history); },
    findById: async () => null,
    findByPage: async () => [],
    findByWiki: async () => [],
    findByAgentRun: async () => [],
    deleteByWiki: async () => {},
    getNextSequenceNumber: async () => histories.length + 1,
  };

  return {
    wikiPages: mockWikiPages,
    wikiPageHistory: mockWikiPageHistory,
    _pages: pages,
  } as Repositories & { _pages: Map<string, WikiPage> };
}

// Helper to create valid content that passes validation (min 100 chars)
function validContent(title: string, body = 'This is comprehensive documentation that explains the feature in detail. It provides enough content to pass validation requirements for wiki pages.'): string {
  return `# ${title}\n\n${body}`;
}

describe('handleUpdateWikiPage', () => {
  describe('create operation', () => {
    it('extracts title from content when title not provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: validContent('Auto Extracted Title'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Auto Extracted Title');
    });

    it('uses provided title instead of extracting', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        title: 'Explicit Title',
        content: validContent('Content Title'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Explicit Title');
    });

    it('falls back to path-based title when no H1 and no title provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Content without H1 but long enough to pass validation
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'architecture/system-design',
        content: 'No heading here, just text. This is comprehensive documentation that explains the system design in detail. It provides enough content to pass validation.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Falls back to title derived from path
      assert.strictEqual(result.data?.title, 'System Design');
    });

    it('extracts title from H1 without space (lenient parsing)', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/page',
        content: '#NoSpaceTitle\n\nThis is comprehensive documentation that explains the feature in detail. It provides enough content to pass validation requirements.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'NoSpaceTitle');
    });

    it('applies confidenceDelta when creating a page', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/high-confidence',
        content: validContent('High Confidence Page'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5, // Should result in 0.5 (base) + 0.5 = 1.0
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Base confidence is 0.5, plus delta of 0.5 should give 1.0
      assert.strictEqual(result.data?.confidence, 1.0);
    });

    it('caps confidence at 1.0 when delta exceeds maximum', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/over-confidence',
        content: validContent('Very High Confidence Page'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.8, // 0.5 + 0.8 = 1.3, should cap at 1.0
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 1.0);
    });

    it('applies small confidenceDelta correctly', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/low-confidence',
        content: validContent('Low Confidence Page'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.1, // Should result in 0.5 + 0.1 = 0.6
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 0.6);
    });
  });

  describe('update operation', () => {
    it('updates title when content changes', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with new content that has different H1
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        content: '# New Updated Title\n\nUpdated content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'New Updated Title');
    });

    it('uses explicit title on update when provided', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with explicit title
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'test/page',
        title: 'Explicit Override Title',
        content: '# Content Title\n\nUpdated content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Explicit Override Title');
    });

    it('falls back to path-based title when updated content has no H1', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'guides/quick-start',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update with content that has no H1
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'guides/quick-start',
        content: 'No heading in this update.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // Falls back to path-based title instead of 'Untitled'
      assert.strictEqual(result.data?.title, 'Quick Start');
    });
  });

  describe('merge operation', () => {
    it('applies confidenceDelta when merge creates a new page', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/merge-new',
        content: '# Merge Created Page\n\nContent here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.3, // Should result in 0.5 + 0.3 = 0.8
        skipValidation: true,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.confidence, 0.8);
    });

    it('creates page with extracted title when page does not exist', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/new-page',
        content: '# Merged Page Title\n\nMerged content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
        skipValidation: true,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Merged Page Title');
    });

    it('extracts title from merged content when page exists', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page with a title
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'test/page',
        title: 'Original Title',
        content: '# Original Title\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Merge additional content (merged content will have original H1 first)
      const command = createUpdateWikiPageCommand({
        type: 'merge',
        path: 'test/page',
        content: '## Additional Section\n\nMore content here.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      // The merged content keeps the original H1, so title should be "Original Title"
      assert.strictEqual(result.data?.title, 'Original Title');
    });
  });

  describe('duplicate prevention', () => {
    it('prevents creating a page with an identical title at a different path', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'architecture/test-coverage',
        title: 'Test Coverage',
        content: validContent('Test Coverage', 'Architectural overview of test coverage and how it impacts the system quality. This covers all aspects of testing.'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Try to create a second page with the same title at a different path
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'commits/abc123',
        title: 'Test Coverage',
        content: validContent('Test Coverage', 'Commit introducing test coverage with detailed explanation of the changes and their impact on quality.'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      // Should fail due to duplicate/similar page
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('similar'), `Expected error to include 'similar': ${result.error}`);
    });

    it('prevents creating a page with case-insensitive matching title', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'guides/getting-started',
        title: 'Getting Started',
        content: validContent('Getting Started', 'How to get started with the project and configure your environment properly for development.'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Try to create with different case
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'docs/getting-started-guide',
        title: 'GETTING STARTED',
        content: validContent('GETTING STARTED', 'Another getting started guide with different formatting and approach for new developers.'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('similar'), `Expected error to include 'similar': ${result.error}`);
    });

    it('allows creating pages with different titles', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'architecture/overview',
        title: 'Architecture Overview',
        content: validContent('Architecture Overview', 'System architecture description with all components and their relationships in detail.'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Create second page with different title
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'guides/quick-start',
        title: 'Quick Start Guide',
        content: validContent('Quick Start Guide', 'How to get started quickly with step by step instructions for new users of the system.'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.title, 'Quick Start Guide');
    });

    it('allows update even if title matches existing page (same path)', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();
      const pageId = uuid();

      // Create initial page
      const initialPage = createWikiPage({
        id: pageId,
        wikiId,
        path: 'docs/setup',
        title: 'Setup Guide',
        content: '# Setup Guide\n\nOriginal content.',
      });
      repos._pages.set(pageId, initialPage);

      // Update the same page - should work even though title "exists"
      const command = createUpdateWikiPageCommand({
        type: 'update',
        path: 'docs/setup',
        title: 'Setup Guide',
        content: '# Setup Guide\n\nUpdated content.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.1,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
    });
  });

  describe('template validation', () => {
    it('rejects content with template placeholders on create', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/bad-page',
        content: '# [Descriptive title]\n\n[2-3 paragraph article describing the feature]',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('template placeholder'));
    });

    it('rejects content that is too short on create', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/short-page',
        content: '# Title\n\nShort.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('too short'));
    });

    it('allows valid content on create', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'test/good-page',
        content: '# Architecture Overview\n\nThis document describes the system architecture. The application follows a clean architecture pattern with clear separation of concerns.\n\n## Components\n\nThe system consists of several key components that work together.',
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
    });
  });

  describe('semantic similarity prevention', () => {
    it('prevents creating a page with a similar title', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page: "LLM Service"
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'services/llm',
        title: 'LLM Service',
        content: validContent('LLM Service'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Try to create "LLM Service Overview" - similar title (2/3 = 67% word overlap)
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'components/llm-overview',
        title: 'LLM Service Overview',
        content: validContent('LLM Service Overview'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false, `Expected failure but got success`);
      assert.ok(result.error?.includes('similar'), `Expected error to include 'similar': ${result.error}`);
    });

    it('prevents creating a page with a similar path', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page at "services/llm"
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'services/llm',
        title: 'LLM Service',
        content: validContent('LLM Service'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Try to create at "services/llm-service" - similar path (50% overlap with llm and services)
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'services/llm-service',
        title: 'OpenRouter Integration',
        content: validContent('OpenRouter Integration'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('similar'), `Expected error to include 'similar': ${result.error}`);
    });

    it('allows creating pages with truly different topics', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'services/llm',
        title: 'LLM Service',
        content: validContent('LLM Service'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Create completely different page
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'architecture/database',
        title: 'Database Configuration',
        content: validContent('Database Configuration'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, true);
    });

    it('provides helpful error message pointing to existing page', async () => {
      const repos = createMockRepos();
      const wikiId = uuid();

      // Create first page
      const initialPage = createWikiPage({
        id: uuid(),
        wikiId,
        path: 'services/llm',
        title: 'LLM Service',
        content: validContent('LLM Service'),
      });
      repos._pages.set(initialPage.id, initialPage);

      // Try to create page with identical title (exact match)
      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'components/llm-wrapper',
        title: 'LLM Service',
        content: validContent('LLM Service'),
        agentRunId: 'agent-1',
        confidenceDelta: 0.5,
      });

      const result = await handleUpdateWikiPage(command, repos, wikiId);

      assert.strictEqual(result.success, false);
      // Error should mention the existing page path
      assert.ok(result.error?.includes('services/llm'), `Error should mention existing path: ${result.error}`);
    });
  });
});
