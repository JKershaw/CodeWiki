import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureAgent } from '../../src/agents/meta/structure-agent.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('StructureAgent', () => {
  let agent: StructureAgent;
  let mockContext: AgentContext;
  let mockPages: WikiPage[];

  beforeEach(() => {
    agent = new StructureAgent();

    mockPages = [
      createMockPage('commits/abc123', 'Commit abc123', 'Short content'),
      createMockPage('commits/def456', 'Commit def456', 'Another short content'),
      createMockPage('architecture/overview', 'Architecture Overview', 'Architecture details...'),
    ];

    mockContext = {
      repoId: 'test-repo',
      repos: {
        wikiPages: {
          findByRepo: vi.fn().mockResolvedValue(mockPages),
        },
        agentRuns: {
          findByRepo: vi.fn().mockResolvedValue([]),
        },
      } as any,
      git: {} as any,
      llm: {
        complete: vi.fn().mockResolvedValue({
          content: `SUGGESTIONS:
- [PRIORITY:medium] | [commits/abc123] | Consider adding more context to this commit page

OVERALL_ASSESSMENT: Wiki structure is acceptable but could use improvement.`,
          costUsd: 0.05,
        }),
      } as any,
    };
  });

  describe('type', () => {
    it('should have type "structure"', () => {
      expect(agent.type).toBe('structure');
    });
  });

  describe('runOnCommit', () => {
    it('should throw an error', async () => {
      await expect(agent.runOnCommit('commit-id', mockContext))
        .rejects.toThrow('StructureAgent does not run on commits');
    });
  });

  describe('runOnWiki', () => {
    it('should return early if less than 3 pages', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Content'),
      ]);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toBe('Not enough pages for structure analysis');
      expect(result.costUsd).toBe(0);
    });

    it('should analyze structure with enough pages', async () => {
      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('Analyzed');
      expect(result.result.summary).toContain('3 pages');
    });

    it('should identify pages that are too long', async () => {
      const longContent = 'x'.repeat(6000);
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('commits/abc', 'Commit ABC', longContent),
        createMockPage('commits/def', 'Commit DEF', 'Short'),
        createMockPage('commits/ghi', 'Commit GHI', 'Short'),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const longPageFinding = result.result.findings.find(f =>
        f.description.includes('too long') || f.description.includes('6000')
      );
      expect(longPageFinding).toBeDefined();
    });

    it('should identify lonely categories', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('commits/abc', 'Commit ABC', 'Content'),
        createMockPage('commits/def', 'Commit DEF', 'Content'),
        createMockPage('orphan-category/only-page', 'Lonely Page', 'Content'),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const lonelyFinding = result.result.findings.find(f =>
        f.description.includes('only 1 page')
      );
      expect(lonelyFinding).toBeDefined();
    });

    it('should identify short titles', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('a/b', 'X', 'Content'), // Very short title
        createMockPage('commits/def', 'Commit DEF', 'Content'),
        createMockPage('commits/ghi', 'Commit GHI', 'Content'),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const shortTitleFinding = result.result.findings.find(f =>
        f.description.includes('short title')
      );
      expect(shortTitleFinding).toBeDefined();
    });

    it('should return healthy status when no issues found', async () => {
      // Create well-structured pages
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('commits/abc123', 'Commit abc123 - Add feature', 'Good content here', ['commits/def456']),
        createMockPage('commits/def456', 'Commit def456 - Fix bug', 'Good content here', ['commits/abc123']),
        createMockPage('commits/ghi789', 'Commit ghi789 - Update docs', 'Good content here', ['commits/abc123']),
      ]);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('healthy');
      expect(result.costUsd).toBe(0);
    });
  });

  describe('parseResponse', () => {
    it('should parse suggestions correctly', async () => {
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: `SUGGESTIONS:
- [PRIORITY:high] | [commits/abc, commits/def] | Split these related commits into a feature page
- [PRIORITY:low] | [architecture/overview] | Add more diagrams

OVERALL_ASSESSMENT: Good structure overall.`,
        costUsd: 0.05,
      });

      const result = await agent.runOnWiki(mockContext);

      const suggestions = result.result.findings.filter(f => f.type === 'SUGGESTION');
      expect(suggestions.length).toBe(2);
      expect(suggestions[0]!.importance).toBe('high');
      expect(suggestions[1]!.importance).toBe('low');
    });

    it('should handle malformed LLM response gracefully', async () => {
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: 'This is not in the expected format at all.',
        costUsd: 0.05,
      });

      // Should not throw
      const result = await agent.runOnWiki(mockContext);
      expect(result.result).toBeDefined();
    });
  });
});

function createMockPage(
  path: string,
  title: string,
  content: string,
  links: string[] = []
): WikiPage {
  return {
    id: `page-${path}`,
    repoId: 'test-repo',
    path,
    title,
    content,
    confidence: 0.5,
    sourceCommits: [],
    links,
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
