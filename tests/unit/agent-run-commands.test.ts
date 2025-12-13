/**
 * Unit tests for Agent Run CQRS commands.
 * Tests the commands in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createCreateAgentRunCommand,
  handleCreateAgentRun,
  createCompleteAgentRunCommand,
  handleCompleteAgentRun,
  createFailAgentRunCommand,
  handleFailAgentRun,
} from '../../src/commands/agent-run.js';
import { createAgentRun } from '../../src/domain/agent-run.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { AgentRun, AgentResult, ToolMetrics } from '../../src/domain/agent-run.js';

// Create a minimal mock repositories object for testing
function createMockRepos(): Repositories {
  const agentRuns = new Map<string, AgentRun>();

  const mockAgentRuns: Repositories['agentRuns'] = {
    findById: async (id) => agentRuns.get(id) ?? null,
    findByRepo: async () => [],
    findByCommit: async () => [],
    findRecentByType: async () => [],
    countByStatus: async () => ({ pending: 0, running: 0, completed: 0, failed: 0 }),
    calculateTotalCost: async () => 0,
    save: async (run) => { agentRuns.set(run.id, run); },
    deleteByRepo: async () => {},
    updateStatus: async (id, status) => {
      const run = agentRuns.get(id);
      if (run) run.status = status;
    },
    complete: async (id, result, durationMs, costUsd, toolMetrics) => {
      const run = agentRuns.get(id);
      if (run) {
        run.status = 'completed';
        run.result = result;
        run.durationMs = durationMs;
        run.costUsd = costUsd;
        run.completedAt = new Date();
        if (toolMetrics) {
          run.toolMetrics = toolMetrics;
        }
      }
    },
    fail: async (id, error, durationMs) => {
      const run = agentRuns.get(id);
      if (run) {
        run.status = 'failed';
        run.error = error;
        run.durationMs = durationMs;
        run.completedAt = new Date();
      }
    },
  };

  return {
    agentRuns: mockAgentRuns,
  } as Repositories;
}

describe('Agent Run Commands', () => {
  describe('CreateAgentRun', () => {
    it('creates a new agent run record', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const command = createCreateAgentRunCommand({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
        targetCommitId: 'commit-123',
      });
      const result = await handleCreateAgentRun(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.id, runId);
      assert.strictEqual(result.data.repoId, 'repo-1');
      assert.strictEqual(result.data.wikiId, 'wiki-1');
      assert.strictEqual(result.data.agentType, 'code-change');
      assert.strictEqual(result.data.targetCommitId, 'commit-123');
      assert.strictEqual(result.data.status, 'running');
    });

    it('creates agent run without target commit', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const command = createCreateAgentRunCommand({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'link',
      });
      const result = await handleCreateAgentRun(command, repos);

      assert.strictEqual(result.success, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.targetCommitId, null);
    });

    it('has correct command type', () => {
      const command = createCreateAgentRunCommand({
        id: 'run-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      assert.strictEqual(command.type, 'CreateAgentRun');
    });
  });

  describe('CompleteAgentRun', () => {
    it('marks an agent run as completed with results', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // First create a run
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      agentRun.status = 'running';
      await repos.agentRuns.save(agentRun);

      const result: AgentResult = {
        summary: 'Analyzed code changes',
        findings: [{
          type: 'new-feature',
          description: 'Added authentication module',
          relatedPaths: ['src/auth/index.ts'],
          importance: 'high',
        }],
        confidence: 0.9,
      };

      const command = createCompleteAgentRunCommand(runId, result, 1500, 0.05);
      const cmdResult = await handleCompleteAgentRun(command, repos);

      assert.strictEqual(cmdResult.success, true);

      const completed = await repos.agentRuns.findById(runId);
      assert.strictEqual(completed?.status, 'completed');
      assert.strictEqual(completed?.durationMs, 1500);
      assert.strictEqual(completed?.costUsd, 0.05);
      assert.deepStrictEqual(completed?.result, result);
    });

    it('fails when agent run does not exist', async () => {
      const repos = createMockRepos();

      const command = createCompleteAgentRunCommand('nonexistent', {
        summary: 'Test',
        findings: [],
        confidence: 1,
      }, 100, 0.01);
      const result = await handleCompleteAgentRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createCompleteAgentRunCommand('run-1', {
        summary: 'Test',
        findings: [],
        confidence: 1,
      }, 100, 0.01);
      assert.strictEqual(command.type, 'CompleteAgentRun');
      assert.strictEqual(command.agentRunId, 'run-1');
    });

    it('stores toolMetrics when provided', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // First create a run
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      agentRun.status = 'running';
      await repos.agentRuns.save(agentRun);

      const result: AgentResult = {
        summary: 'Analyzed code changes',
        findings: [],
        confidence: 0.9,
      };

      const toolMetrics: ToolMetrics = {
        toolCallCount: 5,
        toolsUsed: { read_file: 3, list_directory: 2 },
        filesRead: ['src/index.ts', 'src/utils.ts', 'package.json'],
      };

      const command = createCompleteAgentRunCommand(runId, result, 1500, 0.05, toolMetrics);
      const cmdResult = await handleCompleteAgentRun(command, repos);

      assert.strictEqual(cmdResult.success, true);

      const completed = await repos.agentRuns.findById(runId);
      assert.deepStrictEqual(completed?.toolMetrics, toolMetrics);
    });

    it('completes without toolMetrics when not provided', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'link',
      });
      agentRun.status = 'running';
      await repos.agentRuns.save(agentRun);

      const result: AgentResult = {
        summary: 'Verified links',
        findings: [],
        confidence: 1.0,
      };

      const command = createCompleteAgentRunCommand(runId, result, 500, 0.02);
      const cmdResult = await handleCompleteAgentRun(command, repos);

      assert.strictEqual(cmdResult.success, true);

      const completed = await repos.agentRuns.findById(runId);
      assert.strictEqual(completed?.toolMetrics, undefined);
    });

    it('includes toolMetrics in command when provided', () => {
      const toolMetrics: ToolMetrics = {
        toolCallCount: 2,
        toolsUsed: { read_file: 2 },
        filesRead: ['src/config.ts'],
      };

      const command = createCompleteAgentRunCommand('run-1', {
        summary: 'Test',
        findings: [],
        confidence: 1,
      }, 100, 0.01, toolMetrics);

      assert.deepStrictEqual(command.toolMetrics, toolMetrics);
    });
  });

  describe('FailAgentRun', () => {
    it('marks an agent run as failed with error', async () => {
      const repos = createMockRepos();
      const runId = uuid();

      // First create a run
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      agentRun.status = 'running';
      await repos.agentRuns.save(agentRun);

      const command = createFailAgentRunCommand(runId, 'LLM rate limit exceeded', 500);
      const cmdResult = await handleFailAgentRun(command, repos);

      assert.strictEqual(cmdResult.success, true);

      const failed = await repos.agentRuns.findById(runId);
      assert.strictEqual(failed?.status, 'failed');
      assert.strictEqual(failed?.error, 'LLM rate limit exceeded');
      assert.strictEqual(failed?.durationMs, 500);
    });

    it('fails when agent run does not exist', async () => {
      const repos = createMockRepos();

      const command = createFailAgentRunCommand('nonexistent', 'Error', 100);
      const result = await handleFailAgentRun(command, repos);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('has correct command type', () => {
      const command = createFailAgentRunCommand('run-1', 'Error message', 100);
      assert.strictEqual(command.type, 'FailAgentRun');
      assert.strictEqual(command.agentRunId, 'run-1');
      assert.strictEqual(command.error, 'Error message');
      assert.strictEqual(command.durationMs, 100);
    });
  });
});
