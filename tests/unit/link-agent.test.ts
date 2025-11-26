import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('LinkAgent', () => {
  let agent: LinkAgent;
  let mockContext: AgentContext;
  let mockPages: WikiPage[];

  beforeEach(() => {
    agent = new LinkAgent();

    mockPages = [
      {
        id: '1',
        repoId: 'repo1',
        path: 'commits/abc123',
        title: 'Add user authentication',
        content: '# Add user authentication\n\nImplemented JWT-based authentication system.',
        confidence: 0.5,
        sourceCommits: ['abc123'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        repoId: 'repo1',
        path: 'security/auth-review',
        title: 'Authentication Security Review',
        content: '# Authentication Security Review\n\nReviewed JWT implementation for security issues.',
        confidence: 0.5,
        sourceCommits: ['def456'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '3',
        repoId: 'repo1',
        path: 'architecture/api-design',
        title: 'API Design Patterns',
        content: '# API Design Patterns\n\nREST API design with authentication middleware.',
        confidence: 0.5,
        sourceCommits: ['ghi789'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockContext = {
      repoId: 'repo1',
      repos: {
        wikiPages: {
          findByRepo: vi.fn().mockResolvedValue(mockPages),
          findByPath: vi.fn(),
          updateContent: vi.fn(),
          save: vi.fn(),
        },
        commits: {
          findById: vi.fn(),
        },
        workQueue: {
          findByRepo: vi.fn().mockResolvedValue([]),
        },
      } as unknown as AgentContext['repos'],
      git: {} as AgentContext['git'],
      llm: {
        complete: vi.fn().mockResolvedValue({
          content: `LINK_SUGGESTIONS:
- [commits/abc123] -> [security/auth-review] | [STRENGTH:strong] | Both discuss authentication implementation
- [commits/abc123] -> [architecture/api-design] | [STRENGTH:medium] | Related API authentication

CONFIDENCE: 0.85`,
          costUsd: 0.01,
        }),
      } as unknown as AgentContext['llm'],
    };
  });

  describe('type', () => {
    it('should have type "link"', () => {
      expect(agent.type).toBe('link');
    });
  });

  describe('runOnCommit', () => {
    it('should throw error when called', async () => {
      await expect(agent.runOnCommit('commit1', mockContext)).rejects.toThrow(
        'LinkAgent does not run on commits'
      );
    });
  });

  describe('runOnWiki', () => {
    it('should return early if less than 2 pages', async () => {
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>).mockResolvedValue([mockPages[0]]);

      const result = await agent.runOnWiki!(mockContext);

      expect(result.updates).toHaveLength(0);
      expect(result.result.summary).toBe('Not enough pages to create links');
    });

    it('should return early if all pages have links', async () => {
      const pagesWithLinks = mockPages.map(p => ({ ...p, links: ['some-link'] }));
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>).mockResolvedValue(pagesWithLinks);

      const result = await agent.runOnWiki!(mockContext);

      expect(result.updates).toHaveLength(0);
      expect(result.result.summary).toBe('All pages already have links analyzed');
    });

    it('should analyze pages and generate link updates', async () => {
      const result = await agent.runOnWiki!(mockContext);

      expect(result.result.summary).toContain('link relationships');
      expect(result.costUsd).toBe(0.01);
      expect(result.result.confidence).toBe(0.85);
    });

    it('should parse link suggestions correctly', async () => {
      const result = await agent.runOnWiki!(mockContext);

      // Should have findings for the parsed links
      expect(result.result.findings.length).toBeGreaterThan(0);
      expect(result.result.findings[0]!.type).toBe('LINK');
    });

    it('should generate merge updates for pages', async () => {
      const result = await agent.runOnWiki!(mockContext);

      // Should create merge updates to add Related Pages section
      const mergeUpdates = result.updates.filter(u => u.type === 'merge');
      expect(mergeUpdates.length).toBeGreaterThan(0);

      // Updates should contain Related Pages section
      const firstUpdate = mergeUpdates[0]!;
      expect(firstUpdate.content).toContain('## Related Pages');
    });
  });

  describe('parseResponse', () => {
    it('should handle empty response', async () => {
      (mockContext.llm.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'No links found.',
        costUsd: 0.005,
      });

      const result = await agent.runOnWiki!(mockContext);

      expect(result.updates).toHaveLength(0);
      expect(result.result.findings).toHaveLength(0);
    });

    it('should handle malformed response', async () => {
      (mockContext.llm.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: `LINK_SUGGESTIONS:
- invalid format here
- [source] -> missing parts

CONFIDENCE: 0.5`,
        costUsd: 0.005,
      });

      const result = await agent.runOnWiki!(mockContext);

      // Should not crash, just have no updates
      expect(result).toBeDefined();
    });
  });
});
