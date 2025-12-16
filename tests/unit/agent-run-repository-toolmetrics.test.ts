/**
 * Unit tests for AgentRunRepository.complete() toolMetrics parameter.
 * Verifies that both implementations accept and handle the optional toolMetrics parameter.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Collection, Document } from 'mongodb';
import { FileAgentRunRepository } from '../../src/repositories/file-based/file-agent-run-repository.js';
import { MongoAgentRunRepository } from '../../src/repositories/mongo-based/mongo-agent-run-repository.js';
import { createAgentRun } from '../../src/domain/agent-run.js';
import type { AgentResult, ToolMetrics, AgentRun } from '../../src/domain/agent-run.js';

describe('AgentRunRepository.complete() toolMetrics parameter', () => {
  describe('FileAgentRunRepository', () => {
    let repo: FileAgentRunRepository;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'agent-run-test-'));
      repo = new FileAgentRunRepository(tempDir);
    });

    it('stores toolMetrics when provided', async () => {
      const runId = uuid();
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      agentRun.status = 'running';
      await repo.save(agentRun);

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

      await repo.complete(runId, result, 1500, 0.05, toolMetrics);

      const completed = await repo.findById(runId);
      assert.ok(completed, 'Agent run should exist');
      assert.strictEqual(completed.status, 'completed');
      assert.deepStrictEqual(completed.toolMetrics, toolMetrics);
    });

    it('does not store toolMetrics when not provided', async () => {
      const runId = uuid();
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-2',
        wikiId: 'wiki-2',
        agentType: 'link',
      });
      agentRun.status = 'running';
      await repo.save(agentRun);

      const result: AgentResult = {
        summary: 'Verified links',
        findings: [],
        confidence: 1.0,
      };

      await repo.complete(runId, result, 500, 0.02);

      const completed = await repo.findById(runId);
      assert.ok(completed, 'Agent run should exist');
      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.toolMetrics, undefined);
    });
  });

  describe('MongoAgentRunRepository', () => {
    // Mock MongoDB collection for unit testing
    class MockCollection {
      private docs = new Map<string, Document>();

      async findOne(filter: { _id: string }): Promise<Document | null> {
        return this.docs.get(filter._id) || null;
      }

      async updateOne(
        filter: { _id: string },
        update: { $set: Document }
      ): Promise<void> {
        const existing = this.docs.get(filter._id) || {};
        this.docs.set(filter._id, { ...existing, ...update.$set });
      }

      async replaceOne(
        filter: { _id: string },
        doc: Document,
        options?: { upsert?: boolean }
      ): Promise<void> {
        this.docs.set(filter._id, doc);
      }
    }

    // Create a mock DB that returns our mock collection
    function createMockDb() {
      const mockCollection = new MockCollection();
      return {
        collection: () => mockCollection as unknown as Collection<Document>,
      };
    }

    it('stores toolMetrics when provided', async () => {
      const mockDb = createMockDb();
      const repo = new MongoAgentRunRepository(mockDb as any);

      const runId = uuid();
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        agentType: 'code-change',
      });
      agentRun.status = 'running';
      await repo.save(agentRun);

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

      await repo.complete(runId, result, 1500, 0.05, toolMetrics);

      const completed = await repo.findById(runId);
      assert.ok(completed, 'Agent run should exist');
      assert.strictEqual(completed.status, 'completed');
      assert.deepStrictEqual(completed.toolMetrics, toolMetrics);
    });

    it('does not store toolMetrics when not provided', async () => {
      const mockDb = createMockDb();
      const repo = new MongoAgentRunRepository(mockDb as any);

      const runId = uuid();
      const agentRun = createAgentRun({
        id: runId,
        repoId: 'repo-2',
        wikiId: 'wiki-2',
        agentType: 'link',
      });
      agentRun.status = 'running';
      await repo.save(agentRun);

      const result: AgentResult = {
        summary: 'Verified links',
        findings: [],
        confidence: 1.0,
      };

      await repo.complete(runId, result, 500, 0.02);

      const completed = await repo.findById(runId);
      assert.ok(completed, 'Agent run should exist');
      assert.strictEqual(completed.status, 'completed');
      assert.strictEqual(completed.toolMetrics, undefined);
    });

    it('accepts toolMetrics parameter with correct TypeScript signature', () => {
      const mockDb = createMockDb();
      const repo = new MongoAgentRunRepository(mockDb as any);

      const toolMetrics: ToolMetrics = {
        toolCallCount: 10,
        toolsUsed: { read_file: 7, list_directory: 3 },
        filesRead: ['file1.ts', 'file2.ts'],
      };

      // This test verifies TypeScript compilation with toolMetrics parameter
      const result: AgentResult = {
        summary: 'Test',
        findings: [],
        confidence: 1,
      };

      // Type check: should accept 5 parameters (id, result, durationMs, costUsd, toolMetrics)
      const promise: Promise<void> = repo.complete('test-id', result, 100, 0.01, toolMetrics);
      assert.ok(promise instanceof Promise);

      // Type check: should accept 4 parameters (toolMetrics is optional)
      const promise2: Promise<void> = repo.complete('test-id', result, 100, 0.01);
      assert.ok(promise2 instanceof Promise);
    });
  });

  describe('Implementation parity', () => {
    it('both implementations have the same complete() signature', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'agent-run-parity-'));
      const fileRepo = new FileAgentRunRepository(tempDir);

      const mockDb = {
        collection: () => ({
          findOne: async () => null,
          updateOne: async () => ({}),
          replaceOne: async () => ({}),
        }),
      };
      const mongoRepo = new MongoAgentRunRepository(mockDb as any);

      const result: AgentResult = {
        summary: 'Test',
        findings: [],
        confidence: 1,
      };

      const toolMetrics: ToolMetrics = {
        toolCallCount: 5,
        toolsUsed: { read_file: 3, list_directory: 2 },
        filesRead: ['src/index.ts'],
      };

      // Both should accept the same parameters
      type FileCompleteSignature = typeof fileRepo.complete;
      type MongoCompleteSignature = typeof mongoRepo.complete;

      // TypeScript will error if signatures don't match
      const fileComplete: FileCompleteSignature = mongoRepo.complete.bind(mongoRepo);
      const mongoComplete: MongoCompleteSignature = fileRepo.complete.bind(fileRepo);

      // Verify both accept the toolMetrics parameter
      assert.ok(fileComplete);
      assert.ok(mongoComplete);

      // Clean up
      await rm(tempDir, { recursive: true, force: true });
    });
  });
});
