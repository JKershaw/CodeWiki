import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsistencyAgent } from '../../src/agents/meta/consistency-agent.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('ConsistencyAgent', () => {
  let agent: ConsistencyAgent;
  let mockContext: AgentContext;
  let mockPages: WikiPage[];

  beforeEach(() => {
    agent = new ConsistencyAgent();

    mockPages = [
      createMockPage('architecture/overview', 'Architecture Overview', 'Overview of the CQRS architecture.', 0.8, []),
      createMockPage('architecture/design', 'Design Patterns', 'Design patterns used in the system.', 0.8, ['architecture/overview']),
      createMockPage('commits/abc123', 'Commit abc123', 'Initial CQRS implementation.', 0.7, ['architecture/overview']),
      createMockPage('commits/def456', 'Commit def456', 'Added more features.', 0.7, []),
      createMockPage('security/overview', 'Security Overview', 'Security considerations for the system.', 0.8, []),
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
- [SEVERITY:medium] | [TYPE:terminology] | [architecture/overview, commits/abc123] | CQRS vs Command Query inconsistent

TERMINOLOGY_MAP:
- [CQRS] = [Command Query Responsibility Segregation]: Same architectural pattern

SUGGESTIONS:
- Standardize on "CQRS" throughout the wiki

CONFIDENCE: 0.8`,
          costUsd: 0.05,
        }),
      } as any,
    };
  });

  describe('type', () => {
    it('should have type "consistency"', () => {
      expect(agent.type).toBe('consistency');
    });
  });

  describe('runOnCommit', () => {
    it('should throw an error', async () => {
      await expect(agent.runOnCommit('commit-id', mockContext))
        .rejects.toThrow('ConsistencyAgent does not run on commits');
    });
  });

  describe('runOnWiki', () => {
    it('should return early if less than 5 pages', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Content', 0.5, []),
        createMockPage('page2', 'Page 2', 'Content', 0.5, []),
        createMockPage('page3', 'Page 3', 'Content', 0.5, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('Not enough pages');
      expect(result.costUsd).toBe(0);
    });

    it('should analyze pages for consistency issues', async () => {
      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('consistency issues');
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should detect broken links', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('page1', 'Page 1', 'Content', 0.8, ['nonexistent/page']),
        createMockPage('page2', 'Page 2', 'Content', 0.8, []),
        createMockPage('page3', 'Page 3', 'Content', 0.8, []),
        createMockPage('page4', 'Page 4', 'Content', 0.8, []),
        createMockPage('page5', 'Page 5', 'Content', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const brokenLinkFinding = result.result.findings.find(f =>
        f.description.includes('non-existent page') || f.description.includes('links to')
      );
      expect(brokenLinkFinding).toBeDefined();
    });

    it('should detect duplicate titles', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('commits/abc123', 'Architecture Overview', 'Content about commit', 0.8, []),
        createMockPage('architecture/overview', 'Architecture Overview', 'Overview content', 0.8, []),
        createMockPage('page3', 'Page 3', 'Content', 0.8, []),
        createMockPage('page4', 'Page 4', 'Content', 0.8, []),
        createMockPage('page5', 'Page 5', 'Content', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const duplicateFinding = result.result.findings.find(f =>
        f.description.includes('Duplicate titles')
      );
      expect(duplicateFinding).toBeDefined();
    });

    it('should detect similar content in same category', async () => {
      const sharedContent = 'This is some shared content that appears in both pages about the architecture of the system and how it uses CQRS patterns for command and query separation with repositories and domain entities.';
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('architecture/overview', 'Overview', sharedContent, 0.8, []),
        createMockPage('architecture/design', 'Design', sharedContent, 0.8, []),
        createMockPage('commits/abc', 'Commit ABC', 'Different content here', 0.8, []),
        createMockPage('commits/def', 'Commit DEF', 'More different content', 0.8, []),
        createMockPage('security/overview', 'Security', 'Security overview', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const similarContentFinding = result.result.findings.find(f =>
        f.description.includes('similar content')
      );
      expect(similarContentFinding).toBeDefined();
    });

    it('should detect orphaned pages', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('architecture/overview', 'Overview', 'Content', 0.8, ['architecture/design']),
        createMockPage('architecture/design', 'Design', 'Content', 0.8, ['architecture/overview']),
        createMockPage('commits/abc', 'Commit ABC', 'Content', 0.8, []),
        createMockPage('commits/def', 'Commit DEF', 'Content', 0.8, []),
        createMockPage('commits/ghi', 'Commit GHI', 'Content', 0.8, []),
        createMockPage('security/overview', 'Security', 'Content', 0.8, []),
        createMockPage('guides/testing', 'Testing', 'Content', 0.8, []),
        createMockPage('guides/setup', 'Setup', 'Content', 0.8, []),
        createMockPage('patterns/anti', 'Anti Patterns', 'Content', 0.8, []),
        createMockPage('orphan/page', 'Orphan Page', 'This page has no links', 0.8, []),
        createMockPage('another/orphan', 'Another Orphan', 'Another isolated page', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const orphanFinding = result.result.findings.find(f =>
        f.description.includes('no links')
      );
      expect(orphanFinding).toBeDefined();
    });

    it('should detect category mismatches', async () => {
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('architecture/security-audit', 'Security Analysis',
          'This page discusses security vulnerabilities, XSS attacks, SQL injection exploits, and CVE-2023-1234.', 0.8, []),
        createMockPage('architecture/design', 'Design', 'Design patterns', 0.8, []),
        createMockPage('commits/abc', 'Commit ABC', 'Content', 0.8, []),
        createMockPage('commits/def', 'Commit DEF', 'Content', 0.8, []),
        createMockPage('security/overview', 'Security Overview', 'Security overview', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const mismatchFinding = result.result.findings.find(f =>
        f.description.includes('security content') || f.description.includes('category')
      );
      expect(mismatchFinding).toBeDefined();
    });

    it('should return consistent status when no issues found', async () => {
      // Mock pages with no issues - all well-linked, unique titles, distinct content
      // Avoid any keyword matches by using completely neutral content
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('docs/overview', 'Documentation Overview', 'Introduction to the project documentation.', 0.9, ['docs/guide']),
        createMockPage('docs/guide', 'User Guide', 'How to use the application features.', 0.9, ['docs/overview']),
        createMockPage('commits/abc', 'Commit ABC', 'Added new functionality to the application.', 0.9, ['docs/overview']),
        createMockPage('commits/def', 'Commit DEF', 'Fixed a bug in the login form.', 0.9, ['docs/guide']),
        createMockPage('notes/index', 'Notes Index', 'Collection of development notes.', 0.9, ['docs/overview']),
      ]);

      // Mock LLM to return no issues
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: `ISSUES:

TERMINOLOGY_MAP:

SUGGESTIONS:

CONFIDENCE: 0.95`,
        costUsd: 0.05,
      });

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('consistent');
    });
  });

  describe('parseResponse', () => {
    it('should parse issues correctly', async () => {
      mockContext.llm.complete = vi.fn().mockResolvedValue({
        content: `ISSUES:
- [SEVERITY:high] | [TYPE:contradiction] | [page1, page2] | Pages contradict each other about config format
- [SEVERITY:low] | [TYPE:terminology] | [page3] | Uses deprecated term

TERMINOLOGY_MAP:
- [config] = [configuration] = [settings]: Same concept

SUGGESTIONS:
- Update page3 to use modern terminology

CONFIDENCE: 0.75`,
        costUsd: 0.05,
      });

      const result = await agent.runOnWiki(mockContext);

      const highIssue = result.result.findings.find(f =>
        f.importance === 'high' && f.description.includes('contradict')
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

  describe('similarity calculation', () => {
    it('should calculate similarity between content', async () => {
      // Two pages with identical content should have high similarity
      const identicalContent = 'This is test content that should be detected as similar when compared.';
      mockContext.repos.wikiPages.findByRepo = vi.fn().mockResolvedValue([
        createMockPage('category/page1', 'Page 1', identicalContent, 0.8, []),
        createMockPage('category/page2', 'Page 2', identicalContent, 0.8, []),
        createMockPage('other/page3', 'Page 3', 'Completely different content', 0.8, []),
        createMockPage('other/page4', 'Page 4', 'More unique stuff', 0.8, []),
        createMockPage('other/page5', 'Page 5', 'Even more unique content here', 0.8, []),
      ]);

      const result = await agent.runOnWiki(mockContext);

      const similarFinding = result.result.findings.find(f =>
        f.description.includes('similar content')
      );
      expect(similarFinding).toBeDefined();
    });
  });
});

function createMockPage(
  path: string,
  title: string,
  content: string,
  confidence: number,
  links: string[]
): WikiPage {
  return {
    id: `page-${path}`,
    repoId: 'test-repo',
    path,
    title,
    content,
    confidence,
    sourceCommits: [],
    links,
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
