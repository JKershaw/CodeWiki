import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualityAgent } from '../../src/agents/meta/quality-agent.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('QualityAgent', () => {
  let agent: QualityAgent;
  let mockContext: AgentContext;
  let mockPages: WikiPage[];

  beforeEach(() => {
    agent = new QualityAgent();

    mockPages = [
      createMockPage('commits/abc123', 'Commit abc123', 'This is good content with commit abc123 reference and `src/file.ts` path.', 0.6),
      createMockPage('architecture/overview', 'Architecture Overview', 'Overview of the architecture system.', 0.8),
      createMockPage('guides/testing', 'Testing Guide', 'How to test the application with proper examples.', 0.7),
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
          content: `ISSUES:
- [SEVERITY:medium] | [guides/testing] | Could use more concrete code examples

IMPROVEMENTS:
- [guides/testing] | Add step-by-step instructions with code snippets

CONFIDENCE: 0.8`,
          costUsd: 0.05,
        }),
      } as any,
    };
  });

  describe('type', () => {
    it('should have type "quality"', () => {
      expect(agent.type).toBe('quality');
    });
  });

  describe('runOnCommit', () => {
    it('should throw an error', async () => {
      await expect(agent.runOnCommit('commit-id', mockContext))
        .rejects.toThrow('QualityAgent does not run on commits');
    });
  });

  describe('runOnWiki', () => {
    it('should return early if less than 2 pages', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Content', 0.5),
      ]);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toBe('Not enough pages for quality analysis');
      expect(result.costUsd).toBe(0);
    });

    it('should analyze pages with quality issues', async () => {
      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('Reviewed');
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should detect empty sections', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', '# Title\n\n## Empty Section\n\n## Another Section\n\nContent here', 0.5),
        createMockPage('page2', 'Page 2', 'Normal content here', 0.5),
        createMockPage('page3', 'Page 3', 'More content', 0.5),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const emptySectionFinding = result.result.findings.find(f =>
        f.description.includes('empty section')
      );
      expect(emptySectionFinding).toBeDefined();
    });

    it('should detect very short content', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Too short', 0.5),
        createMockPage('page2', 'Page 2', 'Normal length content that is sufficient', 0.5),
        createMockPage('page3', 'Page 3', 'Another page with enough content', 0.5),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const shortContentFinding = result.result.findings.find(f =>
        f.description.includes('very little content')
      );
      expect(shortContentFinding).toBeDefined();
    });

    it('should detect low confidence pages', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Content with commit abc123 and `file.ts`', 0.3),
        createMockPage('page2', 'Page 2', 'Normal content with commit def456 and `other.ts`', 0.8),
        createMockPage('page3', 'Page 3', 'More content with commit ghi789 and `another.ts`', 0.7),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const lowConfidenceFinding = result.result.findings.find(f =>
        f.description.includes('low confidence')
      );
      expect(lowConfidenceFinding).toBeDefined();
    });

    it('should detect missing source citations', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('guides/intro', 'Introduction', 'This guide has no citations or references at all.', 0.5),
        createMockPage('guides/setup', 'Setup Guide', 'Setup with commit abc123 reference', 0.5),
        createMockPage('guides/testing', 'Testing', 'Testing with `src/test.ts` reference', 0.5),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const noCitationFinding = result.result.findings.find(f =>
        f.description.includes('no source citations')
      );
      expect(noCitationFinding).toBeDefined();
    });

    it('should return healthy status when all pages meet standards', async () => {
      // Create well-formed pages with citations and good content
      // Note: commit refs need 7+ hex chars (0-9, a-f only), content must be > 100 chars
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('commits/abc', 'Commit ABC', 'This is substantial content from commit abc1234 with `src/file.ts` and more details about implementation. It includes thorough documentation.', 0.9),
        createMockPage('commits/def', 'Commit DEF', 'Another substantial page from commit def4567 with `src/other.ts` referenced throughout the documentation with plenty of detail.', 0.9),
        createMockPage('commits/fed', 'Commit FED', 'Third page with commit fed7890 and `src/third.ts` mentioned along with other context and additional implementation notes.', 0.9),
      ]);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('meet quality standards');
      expect(result.costUsd).toBe(0);
    });
  });

  describe('parseResponse', () => {
    it('should parse issues correctly', async () => {
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: `ISSUES:
- [SEVERITY:high] | [page1] | Critical issue found
- [SEVERITY:low] | [page2] | Minor issue

IMPROVEMENTS:
- [page1] | Fix the critical issue

CONFIDENCE: 0.75`,
        costUsd: 0.05,
      });

      const result = await agent.runOnWiki(mockContext);

      const highIssue = result.result.findings.find(f =>
        f.importance === 'high' && f.description.includes('Critical')
      );
      expect(highIssue).toBeDefined();
    });

    it('should handle malformed LLM response gracefully', async () => {
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: 'This is not in the expected format at all.',
        costUsd: 0.05,
      });

      const result = await agent.runOnWiki(mockContext);
      expect(result.result).toBeDefined();
    });
  });
});

function createMockPage(
  path: string,
  title: string,
  content: string,
  confidence: number
): WikiPage {
  return {
    id: `page-${path}`,
    repoId: 'test-repo',
    path,
    title,
    content,
    confidence,
    sourceCommits: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
