/**
 * Unit tests for CommitRepository.
 * Tests commit storage, querying, and processing record management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection } from '../../src/repositories/index.js';
import type { CommitRepository } from '../../src/repositories/interfaces/commit-repository.js';
import { createCommit, type AgentProcessingRecord } from '../../src/domain/commit.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CommitRepository', () => {
  let repo: CommitRepository;
  let tempDir: string;
  let connection: RepositoryConnection;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'commit-test-'));
    connection = await createRepositories({ fileBasePath: tempDir });
    repo = connection.repositories.commits;
  });

  afterEach(async () => {
    await connection.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('addProcessingRecord', () => {
    it('prevents duplicate records for the same agentType', async () => {
      // Create a commit
      const commit = createCommit({
        id: uuid(),
        repoId: 'repo-1',
        sha: 'abc123',
        message: 'Test commit',
        authorName: 'Test Author',
        authorEmail: 'test@example.com',
        committedAt: new Date('2024-01-01T00:00:00Z'),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 0,
          affectedFiles: ['file.txt'],
        },
      });

      await repo.save(commit);

      // Add first processing record
      const record1: AgentProcessingRecord = {
        agentType: 'test-agent',
        agentRunId: 'run-1',
        processedAt: new Date('2024-01-01T01:00:00Z'),
      };
      await repo.addProcessingRecord(commit.id, record1);

      // Add second processing record for the same agent type
      const record2: AgentProcessingRecord = {
        agentType: 'test-agent',
        agentRunId: 'run-2',
        processedAt: new Date('2024-01-01T02:00:00Z'),
      };
      await repo.addProcessingRecord(commit.id, record2);

      // Verify only one record exists for the agent type
      const updated = await repo.findById(commit.id);
      assert.ok(updated);
      assert.strictEqual(updated.processedBy.length, 1, 'Should have exactly one processing record');
      assert.strictEqual(updated.processedBy[0]!.agentType, 'test-agent');
      assert.strictEqual(updated.processedBy[0]!.agentRunId, 'run-2', 'Should keep the most recent record');
      assert.deepStrictEqual(updated.processedBy[0]!.processedAt, new Date('2024-01-01T02:00:00Z'));
    });

    it('allows multiple records for different agent types', async () => {
      // Create a commit
      const commit = createCommit({
        id: uuid(),
        repoId: 'repo-1',
        sha: 'abc123',
        message: 'Test commit',
        authorName: 'Test Author',
        authorEmail: 'test@example.com',
        committedAt: new Date('2024-01-01T00:00:00Z'),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 0,
          affectedFiles: ['file.txt'],
        },
      });

      await repo.save(commit);

      // Add records for different agent types
      const record1: AgentProcessingRecord = {
        agentType: 'agent-a',
        agentRunId: 'run-1',
        processedAt: new Date('2024-01-01T01:00:00Z'),
      };
      await repo.addProcessingRecord(commit.id, record1);

      const record2: AgentProcessingRecord = {
        agentType: 'agent-b',
        agentRunId: 'run-2',
        processedAt: new Date('2024-01-01T02:00:00Z'),
      };
      await repo.addProcessingRecord(commit.id, record2);

      // Verify both records exist
      const updated = await repo.findById(commit.id);
      assert.ok(updated);
      assert.strictEqual(updated.processedBy.length, 2, 'Should have two processing records');

      const agentTypes = updated.processedBy.map(r => r.agentType).sort();
      assert.deepStrictEqual(agentTypes, ['agent-a', 'agent-b']);
    });
  });
});
