/**
 * Shared mock AgentContext factory for tests.
 */

import { vi } from 'vitest';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Commit } from '../../src/domain/commit.js';

export interface MockContextOptions {
  repoId?: string;
  pages?: WikiPage[];
  commits?: Commit[];
  llmResponse?: { content: string; costUsd: number };
}

/**
 * Create a mock AgentContext with vitest mocks.
 */
export function createMockContext(options: MockContextOptions = {}): AgentContext {
  const {
    repoId = 'test-repo',
    pages = [],
    commits = [],
    llmResponse = { content: 'Mock LLM response', costUsd: 0.01 },
  } = options;

  return {
    repoId,
    repos: {
      wikiPages: {
        findByRepo: vi.fn().mockResolvedValue(pages),
        findByPath: vi.fn().mockImplementation((_, path) =>
          Promise.resolve(pages.find(p => p.path === path) ?? null)
        ),
        updateContent: vi.fn().mockResolvedValue(undefined),
        save: vi.fn().mockResolvedValue(undefined),
      },
      commits: {
        findById: vi.fn().mockImplementation((id) =>
          Promise.resolve(commits.find(c => c.id === id) ?? null)
        ),
        findByRepo: vi.fn().mockResolvedValue(commits),
      },
      agentRuns: {
        findByRepo: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue(undefined),
      },
      workQueue: {
        findByRepo: vi.fn().mockResolvedValue([]),
      },
    } as unknown as AgentContext['repos'],
    git: {
      getCommitDiff: vi.fn().mockResolvedValue('mock diff'),
      readFile: vi.fn().mockResolvedValue('mock file content'),
    } as unknown as AgentContext['git'],
    llm: {
      complete: vi.fn().mockResolvedValue(llmResponse),
    } as unknown as AgentContext['llm'],
  };
}

/**
 * Create a mock commit for testing.
 */
export function createMockCommit(
  id: string,
  message: string,
  overrides?: Partial<Commit>
): Commit {
  return {
    id,
    repoId: 'test-repo',
    sha: id,
    message,
    author: 'Test Author',
    authorEmail: 'test@example.com',
    timestamp: new Date('2024-01-01'),
    filesChanged: 1,
    additions: 10,
    deletions: 5,
    files: [{ path: 'src/index.ts', additions: 10, deletions: 5 }],
    ...overrides,
  };
}
