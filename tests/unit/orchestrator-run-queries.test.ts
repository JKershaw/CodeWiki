/**
 * Unit tests for Orchestrator Run CQRS queries.
 * Tests the queries in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createListOrchestratorRunsQuery,
  handleListOrchestratorRuns,
  createGetOrchestratorRunQuery,
  handleGetOrchestratorRun,
} from '../../src/queries/orchestrator-run.js';
import type { OrchestratorRun } from '../../src/domain/orchestrator-run.js';
import type { Repositories } from '../../src/repositories/index.js';

// Helper to create a mock orchestrator run
function createMockOrchestratorRun(
  id: string,
  repoId: string,
  options?: {
    reasoning?: string;
    workItems?: Array<{ agentType: string; reason: string; targetCommitId?: string; targetPath?: string }>;
    workItemsCreated?: string[];
    usedLLM?: boolean;
    costUsd?: number;
    durationMs?: number;
    wikiPages?: number;
    pendingEditRequests?: number;
  }
): OrchestratorRun {
  return {
    id,
    repoId,
    timestamp: new Date(),
    context: {
      totalCommits: 50,
      commitsByAgent: {},
      recentCommits: [],
      wikiPages: options?.wikiPages ?? 10,
      categoryCounts: {},
      categoriesWithOverview: [],
      categoriesWithoutOverview: [],
      pagesNeedingRewrite: 2,
      avgConfidence: 0.75,
      lowConfidencePages: 1,
      recentRuns: [],
      pagesWithoutLinks: 3,
      hasProjectOverview: true,
      hasGettingStarted: false,
      hasTestingGuide: false,
      hasExtensionGuide: false,
      directoryCoverage: [],
      pendingEditRequests: options?.pendingEditRequests ?? 0,
    },
    promptSent: 'Test prompt',
    rawResponse: 'Test response',
    decision: {
      reasoning: options?.reasoning ?? 'Test reasoning',
      workItems: options?.workItems ?? [
        { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Process recent commit' },
      ],
    },
    workItemsCreated: options?.workItemsCreated ?? ['work-1'],
    model: 'claude-3-haiku',
    costUsd: options?.costUsd ?? 0.001,
    durationMs: options?.durationMs ?? 1500,
    usedLLM: options?.usedLLM ?? true,
  };
}

// Create a minimal mock repositories object for testing
function createMockRepos(runs: OrchestratorRun[]): Repositories {
  const runsMap = new Map(runs.map(r => [r.id, r]));

  const mockOrchestratorRuns: Repositories['orchestratorRuns'] = {
    findById: async (id) => runsMap.get(id) ?? null,
    findByRepo: async (repoId, options) => {
      let filtered = runs.filter(r => r.repoId === repoId);
      if (options?.usedLLM !== undefined) {
        filtered = filtered.filter(r => r.usedLLM === options.usedLLM);
      }
      if (options?.limit) {
        filtered = filtered.slice(0, options.limit);
      }
      return filtered;
    },
    findRecent: async () => [],
    save: async () => {},
    deleteOlderThan: async () => 0,
  };

  return {
    orchestratorRuns: mockOrchestratorRuns,
  } as Repositories;
}

describe('Orchestrator Run Queries', () => {
  describe('ListOrchestratorRuns', () => {
    it('creates query with correct type', () => {
      const query = createListOrchestratorRunsQuery('repo-1');
      assert.strictEqual(query.type, 'ListOrchestratorRuns');
      assert.strictEqual(query.repoId, 'repo-1');
    });

    it('creates query with options', () => {
      const query = createListOrchestratorRunsQuery('repo-1', { limit: 10, usedLLM: true });
      assert.strictEqual(query.limit, 10);
      assert.strictEqual(query.usedLLM, true);
    });

    it('returns empty array when no runs exist', async () => {
      const repos = createMockRepos([]);
      const query = createListOrchestratorRunsQuery('repo-1');
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, []);
    });

    it('returns runs for the specified repo', async () => {
      const runs = [
        createMockOrchestratorRun('run-1', 'repo-1', { reasoning: 'First run' }),
        createMockOrchestratorRun('run-2', 'repo-1', { reasoning: 'Second run' }),
        createMockOrchestratorRun('run-3', 'repo-2', { reasoning: 'Other repo' }),
      ];
      const repos = createMockRepos(runs);

      const query = createListOrchestratorRunsQuery('repo-1');
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 2);
      assert.strictEqual(result.data?.[0].reasoning, 'First run');
      assert.strictEqual(result.data?.[1].reasoning, 'Second run');
    });

    it('filters by usedLLM when specified', async () => {
      const runs = [
        createMockOrchestratorRun('run-1', 'repo-1', { usedLLM: true, reasoning: 'LLM run' }),
        createMockOrchestratorRun('run-2', 'repo-1', { usedLLM: false, reasoning: 'Deterministic run' }),
      ];
      const repos = createMockRepos(runs);

      const query = createListOrchestratorRunsQuery('repo-1', { usedLLM: true });
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 1);
      assert.strictEqual(result.data?.[0].reasoning, 'LLM run');
    });

    it('respects limit parameter', async () => {
      const runs = [
        createMockOrchestratorRun('run-1', 'repo-1'),
        createMockOrchestratorRun('run-2', 'repo-1'),
        createMockOrchestratorRun('run-3', 'repo-1'),
      ];
      const repos = createMockRepos(runs);

      const query = createListOrchestratorRunsQuery('repo-1', { limit: 2 });
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 2);
    });

    it('returns summary with correct fields', async () => {
      const runs = [
        createMockOrchestratorRun('run-1', 'repo-1', {
          reasoning: 'Process pending edits first',
          workItems: [
            { agentType: 'wiki-editor', reason: 'Process edits' },
            { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Analyze commit' },
          ],
          workItemsCreated: ['work-1', 'work-2'],
          costUsd: 0.0015,
          durationMs: 2000,
          wikiPages: 15,
          pendingEditRequests: 5,
        }),
      ];
      const repos = createMockRepos(runs);

      const query = createListOrchestratorRunsQuery('repo-1');
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, true);
      const summary = result.data?.[0];
      assert.ok(summary);
      assert.strictEqual(summary.id, 'run-1');
      assert.strictEqual(summary.reasoning, 'Process pending edits first');
      assert.strictEqual(summary.workItemsRequested, 2);
      assert.strictEqual(summary.workItemsCreated, 2);
      assert.strictEqual(summary.costUsd, 0.0015);
      assert.strictEqual(summary.durationMs, 2000);
      assert.strictEqual(summary.usedLLM, true);
      assert.strictEqual(summary.contextSnapshot.wikiPages, 15);
      assert.strictEqual(summary.contextSnapshot.pendingEditRequests, 5);
      assert.strictEqual(summary.workItems.length, 2);
      assert.strictEqual(summary.workItems[0].agentType, 'wiki-editor');
    });

    it('handles repository errors gracefully', async () => {
      const mockOrchestratorRuns: Repositories['orchestratorRuns'] = {
        findById: async () => null,
        findByRepo: async () => { throw new Error('Database connection failed'); },
        findRecent: async () => [],
        save: async () => {},
        deleteOlderThan: async () => 0,
      };
      const repos = { orchestratorRuns: mockOrchestratorRuns } as Repositories;

      const query = createListOrchestratorRunsQuery('repo-1');
      const result = await handleListOrchestratorRuns(query, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Database connection failed'));
    });
  });

  describe('GetOrchestratorRun', () => {
    it('creates query with correct type', () => {
      const query = createGetOrchestratorRunQuery('run-123');
      assert.strictEqual(query.type, 'GetOrchestratorRun');
      assert.strictEqual(query.runId, 'run-123');
    });

    it('returns run when found', async () => {
      const runs = [
        createMockOrchestratorRun('run-1', 'repo-1', { reasoning: 'Found run' }),
      ];
      const repos = createMockRepos(runs);

      const query = createGetOrchestratorRunQuery('run-1');
      const result = await handleGetOrchestratorRun(query, repos);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.id, 'run-1');
      assert.strictEqual(result.data?.decision.reasoning, 'Found run');
    });

    it('returns not found when run does not exist', async () => {
      const repos = createMockRepos([]);

      const query = createGetOrchestratorRunQuery('nonexistent');
      const result = await handleGetOrchestratorRun(query, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('handles repository errors gracefully', async () => {
      const mockOrchestratorRuns: Repositories['orchestratorRuns'] = {
        findById: async () => { throw new Error('Database error'); },
        findByRepo: async () => [],
        findRecent: async () => [],
        save: async () => {},
        deleteOlderThan: async () => 0,
      };
      const repos = { orchestratorRuns: mockOrchestratorRuns } as Repositories;

      const query = createGetOrchestratorRunQuery('run-1');
      const result = await handleGetOrchestratorRun(query, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Database error'));
    });
  });
});
