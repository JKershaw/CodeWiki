/**
 * Integration tests for agent workflows.
 *
 * These tests verify that agents work correctly together with their
 * dependencies (repositories, tools) using mock LLM responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeChangeAgent } from '../../src/agents/analysis/code-change-agent.js';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import { QualityAgent } from '../../src/agents/meta/quality-agent.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import {
  createMockPage,
  createMockCommitPage,
  createRelatedPages,
  createPagesWithIssues,
} from '../fixtures/mock-pages.js';
import {
  MockLLMService,
  createCodeChangeMockLLM,
  createLinkAgentMockLLM,
  createQualityAgentMockLLM,
} from '../fixtures/mock-llm.js';

describe('Agent Workflow Integration', () => {
  describe('CodeChangeAgent', () => {
    let agent: CodeChangeAgent;
    let mockLLM: MockLLMService;
    let mockContext: AgentContext;

    beforeEach(() => {
      agent = new CodeChangeAgent();
      mockLLM = createCodeChangeMockLLM();

      mockContext = {
        repoId: 'test-repo',
        repos: {
          commits: {
            findById: vi.fn().mockResolvedValue({
              id: 'commit-1',
              sha: 'abc12345def67890',
              message: 'Add authentication feature',
              authorName: 'Test Author',
              committedAt: new Date('2024-01-15'),
              diffSummary: {
                affectedFiles: ['src/auth.ts', 'src/middleware.ts'],
                linesAdded: 150,
                linesDeleted: 20,
              },
            }),
          },
          wikiPages: {
            findByRepo: vi.fn().mockResolvedValue([]),
          },
        } as unknown as AgentContext['repos'],
        git: {
          getCommitDiff: vi.fn().mockResolvedValue(`diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
+export function authenticate(token: string) {
+  return validateToken(token);
+}`),
          getRepoPath: vi.fn().mockReturnValue('/tmp/test-repo'),
        } as unknown as AgentContext['git'],
        llm: mockLLM,
      };
    });

    it('generates wiki updates from commit analysis', async () => {
      const result = await agent.runOnCommit('commit-1', mockContext);

      // Should produce updates
      expect(result.updates.length).toBeGreaterThan(0);

      // Should have a commit page
      const commitUpdate = result.updates.find(u => u.path.startsWith('commits/'));
      expect(commitUpdate).toBeDefined();
      expect(commitUpdate?.type).toBe('create');

      // Should track cost
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('records LLM interaction in history', async () => {
      await agent.runOnCommit('commit-1', mockContext);

      // Should have made an LLM call
      expect(mockLLM.toolUseHistory.length).toBe(1);

      // Should include commit info in the prompt
      const call = mockLLM.toolUseHistory[0]!;
      const userMessage = call.messages.find(m => m.role === 'user');
      expect(userMessage?.content).toContain('abc12345');
    });

    it('parses findings from LLM response', async () => {
      const result = await agent.runOnCommit('commit-1', mockContext);

      // Should have parsed findings
      expect(result.result.findings.length).toBeGreaterThan(0);
      expect(result.result.confidence).toBe(0.75);
    });

    it('throws error for non-existent commit', async () => {
      (mockContext.repos.commits.findById as ReturnType<typeof vi.fn>)
        .mockResolvedValue(null);

      await expect(agent.runOnCommit('missing', mockContext))
        .rejects.toThrow('Commit not found');
    });
  });

  describe('LinkAgent', () => {
    let agent: LinkAgent;
    let mockLLM: MockLLMService;
    let mockContext: AgentContext;
    let mockPages: ReturnType<typeof createRelatedPages>;

    beforeEach(() => {
      agent = new LinkAgent();
      mockLLM = createLinkAgentMockLLM();
      mockPages = createRelatedPages();

      mockContext = {
        repoId: 'test-repo',
        repos: {
          wikiPages: {
            findByRepo: vi.fn().mockResolvedValue(mockPages),
            findByPath: vi.fn().mockImplementation((_, path) =>
              Promise.resolve(mockPages.find(p => p.path === path) ?? null)
            ),
          },
          workQueue: {
            findByRepo: vi.fn().mockResolvedValue([]),
          },
        } as unknown as AgentContext['repos'],
        git: {} as AgentContext['git'],
        llm: mockLLM,
      };
    });

    it('analyzes pages and suggests links', async () => {
      const result = await agent.runOnWiki!(mockContext);

      // Should have link findings
      const linkFindings = result.result.findings.filter(f => f.type === 'LINK');
      expect(linkFindings.length).toBeGreaterThan(0);

      // Should have confidence
      expect(result.result.confidence).toBe(0.85);
    });

    it('generates merge updates for related pages', async () => {
      // Use paths that match the mock pages from createRelatedPages()
      mockLLM.setDefaultResponse(`LINK_SUGGESTIONS:
- [commits/abc1234] -> [security/auth-review] | [STRENGTH:strong] | Both discuss authentication
- [commits/abc1234] -> [architecture/api-design] | [STRENGTH:medium] | Related API design

CONFIDENCE: 0.85`);

      const result = await agent.runOnWiki!(mockContext);

      // Should create merge updates for pages with suggested links
      const mergeUpdates = result.updates.filter(u => u.type === 'merge');
      expect(mergeUpdates.length).toBeGreaterThan(0);

      // Updates should contain Related Pages section
      const hasRelatedSection = mergeUpdates.some(u =>
        u.content.includes('Related Pages')
      );
      expect(hasRelatedSection).toBe(true);
    });

    it('skips analysis when pages already have links', async () => {
      const pagesWithLinks = mockPages.map(p => ({
        ...p,
        links: ['some-existing-link'],
      }));
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>)
        .mockResolvedValue(pagesWithLinks);

      const result = await agent.runOnWiki!(mockContext);

      expect(result.result.summary).toBe('All pages already have links analyzed');
      expect(result.updates).toHaveLength(0);
    });

    it('returns early with insufficient pages', async () => {
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>)
        .mockResolvedValue([mockPages[0]]);

      const result = await agent.runOnWiki!(mockContext);

      expect(result.result.summary).toBe('Not enough pages to create links');
      expect(result.costUsd).toBe(0);
    });
  });

  describe('QualityAgent', () => {
    let agent: QualityAgent;
    let mockLLM: MockLLMService;
    let mockContext: AgentContext;

    beforeEach(() => {
      agent = new QualityAgent();
      mockLLM = createQualityAgentMockLLM();

      mockContext = {
        repoId: 'test-repo',
        repos: {
          wikiPages: {
            findByRepo: vi.fn().mockResolvedValue(createRelatedPages()),
          },
          agentRuns: {
            findByRepo: vi.fn().mockResolvedValue([]),
          },
        } as unknown as AgentContext['repos'],
        git: {} as AgentContext['git'],
        llm: mockLLM,
      };
    });

    it('identifies quality issues in pages', async () => {
      const result = await agent.runOnWiki(mockContext);

      // Should have analyzed pages
      expect(result.result.summary).toContain('Reviewed');
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('detects pages with quality problems', async () => {
      const pagesWithIssues = createPagesWithIssues();
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>)
        .mockResolvedValue(pagesWithIssues);

      const result = await agent.runOnWiki(mockContext);

      // Should find issues (empty sections, short content, no citations)
      expect(result.result.findings.length).toBeGreaterThan(0);
    });

    it('reports healthy status for well-formed pages', async () => {
      const goodPages = [
        createMockPage(
          'commits/abc',
          'Good Page 1',
          'This is substantial content from commit abc1234 with `src/file.ts` references and detailed explanations that provide value to readers.',
          { confidence: 0.9 }
        ),
        createMockPage(
          'commits/def',
          'Good Page 2',
          'Another well-written page from commit def5678 with `src/other.ts` code references and comprehensive documentation.',
          { confidence: 0.9 }
        ),
        createMockPage(
          'commits/ghi',
          'Good Page 3',
          'Third quality page with commit ghi9012 and `src/third.ts` mentioned along with implementation details.',
          { confidence: 0.9 }
        ),
      ];
      (mockContext.repos.wikiPages.findByRepo as ReturnType<typeof vi.fn>)
        .mockResolvedValue(goodPages);

      const result = await agent.runOnWiki(mockContext);

      expect(result.result.summary).toContain('meet quality standards');
    });
  });

  describe('Multi-Agent Workflow', () => {
    it('simulates sequential agent processing', async () => {
      // Simulate the workflow: commit -> code-change -> link -> quality
      const mockLLM = new MockLLMService();
      const pages: ReturnType<typeof createMockPage>[] = [];

      // Step 1: Code-change agent creates initial pages
      mockLLM.setDefaultResponse(`PAGE_TITLE:
User Authentication System

SUMMARY:
Implements JWT-based authentication with secure token validation.
The system integrates with the existing middleware pipeline.

FINDINGS:
- [SECURITY] [IMPORTANCE:high] Implemented secure token validation [src/auth.ts]

WIKI_UPDATES:
- [commits/auth123] [create] Authentication implementation

CONFIDENCE: 0.8`);

      const codeChangeAgent = new CodeChangeAgent();
      const codeChangeContext: AgentContext = {
        repoId: 'test-repo',
        repos: {
          commits: {
            findById: vi.fn().mockResolvedValue({
              id: 'auth123',
              sha: 'auth1234567890',
              message: 'Add JWT authentication',
              authorName: 'Dev',
              committedAt: new Date(),
              diffSummary: {
                affectedFiles: ['src/auth.ts'],
                linesAdded: 100,
                linesDeleted: 0,
              },
            }),
          },
        } as unknown as AgentContext['repos'],
        git: {
          getCommitDiff: vi.fn().mockResolvedValue('mock diff'),
          getRepoPath: vi.fn().mockReturnValue('/tmp/repo'),
        } as unknown as AgentContext['git'],
        llm: mockLLM,
      };

      const codeResult = await codeChangeAgent.runOnCommit('auth123', codeChangeContext);
      expect(codeResult.updates.length).toBeGreaterThan(0);

      // Simulate adding pages to repository
      for (const update of codeResult.updates) {
        pages.push(createMockPage(update.path, update.title ?? 'Untitled', update.content));
      }

      // Step 2: Link agent processes the new pages
      mockLLM.setDefaultResponse(`LINK_SUGGESTIONS:
- [commits/auth123] -> [security/overview] | [STRENGTH:strong] | Related security topic

CONFIDENCE: 0.75`);

      // Add a second page to enable link analysis
      pages.push(createMockPage(
        'security/overview',
        'Security Overview',
        'Overview of security practices in the codebase.'
      ));

      const linkAgent = new LinkAgent();
      const linkContext: AgentContext = {
        repoId: 'test-repo',
        repos: {
          wikiPages: {
            findByRepo: vi.fn().mockResolvedValue(pages),
            findByPath: vi.fn(),
          },
          workQueue: {
            findByRepo: vi.fn().mockResolvedValue([]),
          },
        } as unknown as AgentContext['repos'],
        git: {} as AgentContext['git'],
        llm: mockLLM,
      };

      const linkResult = await linkAgent.runOnWiki!(linkContext);
      expect(linkResult.result.findings.some(f => f.type === 'LINK')).toBe(true);

      // Step 3: Quality agent reviews the wiki
      mockLLM.setDefaultResponse(`ISSUES:
No significant issues found.

CONFIDENCE: 0.9`);

      const qualityAgent = new QualityAgent();
      const qualityContext: AgentContext = {
        repoId: 'test-repo',
        repos: {
          wikiPages: {
            findByRepo: vi.fn().mockResolvedValue(pages),
          },
          agentRuns: {
            findByRepo: vi.fn().mockResolvedValue([]),
          },
        } as unknown as AgentContext['repos'],
        git: {} as AgentContext['git'],
        llm: mockLLM,
      };

      const qualityResult = await qualityAgent.runOnWiki(qualityContext);
      expect(qualityResult).toBeDefined();
    });
  });
});
