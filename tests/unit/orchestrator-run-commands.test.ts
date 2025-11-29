/**
 * Unit tests for Orchestrator Run CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createSaveOrchestratorRunCommand,
  handleSaveOrchestratorRun,
} from '../../src/commands/orchestrator-run.js';
import { createOrchestratorRun, type OrchestratorRun } from '../../src/domain/orchestrator-run.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const orchestratorRuns = new Map<string, OrchestratorRun>();

  const mockOrchestratorRuns: Repositories['orchestratorRuns'] = {
    findById: async (id) => orchestratorRuns.get(id) ?? null,
    findByRepo: async () => [],
    findRecent: async () => [],
    save: async (run) => { orchestratorRuns.set(run.id, run); },
    deleteOlderThan: async () => 0,
  };

  return {
    orchestratorRuns: mockOrchestratorRuns,
  } as Repositories;
}

describe('Orchestrator Run Commands', () => {
  describe('SaveOrchestratorRun', () => {
    it('saves an orchestrator run record', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createOrchestratorRun({
        id: runId,
        repoId: 'repo-1',
        context: {
          wikiStatus: { isEmpty: false, pageCount: 5, recentlyUpdatedCount: 1, lowConfidenceCount: 0 },
          commitQueue: { unprocessedCount: 10, oldestUnprocessed: null },
          recentAgentRuns: { last24h: 5, successRate: 0.9, averageCostUsd: 0.05 },
          currentWorkQueue: { pendingCount: 0, topPriorities: [] },
        },
        promptSent: 'Generate work items...',
      });

      // Simulate orchestrator filling in results
      run.rawResponse = '{"reasoning":"Process commits","workItems":[...]}';
      run.decision = { reasoning: 'Process commits', workItems: [] };
      run.workItemsCreated = ['work-1', 'work-2'];
      run.model = 'claude-3-haiku';
      run.costUsd = 0.001;
      run.durationMs = 1500;
      run.usedLLM = true;

      const command = createSaveOrchestratorRunCommand(run);
      const result = await handleSaveOrchestratorRun(command, repos);

      assert.strictEqual(result.success, true);

      const saved = await repos.orchestratorRuns.findById(runId);
      assert.ok(saved);
      assert.strictEqual(saved.repoId, 'repo-1');
      assert.strictEqual(saved.usedLLM, true);
      assert.strictEqual(saved.costUsd, 0.001);
      assert.deepStrictEqual(saved.workItemsCreated, ['work-1', 'work-2']);
    });

    it('saves deterministic fallback run (usedLLM=false)', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const run = createOrchestratorRun({
        id: runId,
        repoId: 'repo-1',
        context: {
          wikiStatus: { isEmpty: false, pageCount: 5, recentlyUpdatedCount: 1, lowConfidenceCount: 0 },
          commitQueue: { unprocessedCount: 10, oldestUnprocessed: null },
          recentAgentRuns: { last24h: 5, successRate: 0.9, averageCostUsd: 0.05 },
          currentWorkQueue: { pendingCount: 0, topPriorities: [] },
        },
        promptSent: '',
      });

      run.rawResponse = '';
      run.decision = { reasoning: 'Deterministic fallback', workItems: [] };
      run.workItemsCreated = ['work-1'];
      run.model = 'deterministic';
      run.costUsd = 0;
      run.durationMs = 5;
      run.usedLLM = false;

      const command = createSaveOrchestratorRunCommand(run);
      const result = await handleSaveOrchestratorRun(command, repos);

      assert.strictEqual(result.success, true);

      const saved = await repos.orchestratorRuns.findById(runId);
      assert.strictEqual(saved?.usedLLM, false);
      assert.strictEqual(saved?.model, 'deterministic');
    });

    it('has correct command type', () => {
      const run = createOrchestratorRun({
        id: 'run-1',
        repoId: 'repo-1',
        context: {
          wikiStatus: { isEmpty: false, pageCount: 0, recentlyUpdatedCount: 0, lowConfidenceCount: 0 },
          commitQueue: { unprocessedCount: 0, oldestUnprocessed: null },
          recentAgentRuns: { last24h: 0, successRate: 0, averageCostUsd: 0 },
          currentWorkQueue: { pendingCount: 0, topPriorities: [] },
        },
        promptSent: '',
      });

      const command = createSaveOrchestratorRunCommand(run);
      assert.strictEqual(command.type, 'SaveOrchestratorRun');
      assert.ok(command.run);
    });
  });
});
