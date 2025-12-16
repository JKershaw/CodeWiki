/**
 * Integration tests for repository pagination.
 * Ensures MongoDB and file-based implementations have consistent pagination behavior.
 *
 * Key requirement: When no limit is specified, ALL results should be returned.
 * This test verifies the expected behavior with the file-based implementation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileAgentRunRepository } from '../../src/repositories/file-based/file-agent-run-repository.js';
import { FileCommitRepository } from '../../src/repositories/file-based/file-commit-repository.js';
import { FileProcessingRunRepository } from '../../src/repositories/file-based/file-processing-run-repository.js';
import { MongoAgentRunRepository } from '../../src/repositories/mongo-based/mongo-agent-run-repository.js';
import { MongoCommitRepository } from '../../src/repositories/mongo-based/mongo-commit-repository.js';
import { MongoProcessingRunRepository } from '../../src/repositories/mongo-based/mongo-processing-run-repository.js';
import type { AgentRun } from '../../src/domain/agent-run.js';
import type { Commit } from '../../src/domain/commit.js';
import type { ProcessingRun } from '../../src/domain/processing-run.js';
import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';

describe('Repository Pagination', () => {
  let tempDir: string;
  let mongoClient: MongoClient | null = null;
  let mongoDB: Db | null = null;
  let repoId: string;

  beforeEach(async () => {
    // Setup file-based storage
    tempDir = await mkdtemp(join(tmpdir(), 'pagination-test-'));
    repoId = uuid();

    // Setup MongoDB if MONGODB_URI is provided
    const mongoUri = process.env['MONGODB_URI'];
    if (mongoUri) {
      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();
      mongoDB = mongoClient.db('test-pagination');
    }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });

    if (mongoDB && mongoClient) {
      // Clean up test data
      await mongoDB.collection('agent-runs').deleteMany({ repoId });
      await mongoDB.collection('commits').deleteMany({ repoId });
      await mongoDB.collection('processing-runs').deleteMany({ repoId });
      await mongoClient.close();
      mongoClient = null;
      mongoDB = null;
    }
  });

  describe('AgentRunRepository.findByRepo', () => {
    it('file-based returns ALL results when no limit specified (> 100 items)', async () => {
      const fileRepo = new FileAgentRunRepository(tempDir);

      // Create 150 agent runs to exceed the MongoDB default limit of 100
      const runs: AgentRun[] = [];
      for (let i = 0; i < 150; i++) {
        runs.push({
          id: uuid(),
          repoId,
          agentType: 'test',
          targetCommitId: `commit-${i}`,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          durationMs: 100,
          costUsd: 0.01,
          result: { success: true },
        });
      }

      for (const run of runs) {
        await fileRepo.save(run);
      }

      // Query without limit - should return ALL 150 items
      const results = await fileRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 150, 'File-based should return all 150 items when no limit specified');
    });

    it('mongodb returns ALL results when no limit specified (> 100 items)', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoAgentRunRepository(mongoDB);

      // Create 150 agent runs
      const runs: AgentRun[] = [];
      for (let i = 0; i < 150; i++) {
        runs.push({
          id: uuid(),
          repoId,
          agentType: 'test',
          targetCommitId: `commit-${i}`,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          durationMs: 100,
          costUsd: 0.01,
          result: { success: true },
        });
      }

      for (const run of runs) {
        await mongoRepo.save(run);
      }

      // Query without limit - should return ALL 150 items
      const results = await mongoRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 150, 'MongoDB should return all 150 items when no limit specified');
    });

    it('both implementations return same count without limit', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoAgentRunRepository(mongoDB);
      const fileRepo = new FileAgentRunRepository(tempDir);

      // Create 125 agent runs
      const runs: AgentRun[] = [];
      for (let i = 0; i < 125; i++) {
        runs.push({
          id: uuid(),
          repoId,
          agentType: 'test',
          targetCommitId: `commit-${i}`,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          durationMs: 100,
          costUsd: 0.01,
          result: { success: true },
        });
      }

      for (const run of runs) {
        await mongoRepo.save(run);
        await fileRepo.save(run);
      }

      const mongoResults = await mongoRepo.findByRepo(repoId);
      const fileResults = await fileRepo.findByRepo(repoId);

      assert.strictEqual(mongoResults.length, fileResults.length, 'Both implementations should return same count');
      assert.strictEqual(mongoResults.length, 125, 'Should return all 125 items');
    });

    it('respects explicit limit when provided', async () => {
      const fileRepo = new FileAgentRunRepository(tempDir);

      // Create 50 agent runs
      const runs: AgentRun[] = [];
      for (let i = 0; i < 50; i++) {
        runs.push({
          id: uuid(),
          repoId,
          agentType: 'test',
          targetCommitId: `commit-${i}`,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          durationMs: 100,
          costUsd: 0.01,
          result: { success: true },
        });
      }

      for (const run of runs) {
        await fileRepo.save(run);
      }

      // Query with explicit limit
      const results = await fileRepo.findByRepo(repoId, { limit: 10 });
      assert.strictEqual(results.length, 10, 'Should respect explicit limit');
    });
  });

  describe('CommitRepository.findByRepo', () => {
    it('file-based returns ALL results when no limit specified (> 100 items)', async () => {
      const fileRepo = new FileCommitRepository(tempDir);

      // Create 120 commits
      const commits: Commit[] = [];
      for (let i = 0; i < 120; i++) {
        commits.push({
          id: uuid(),
          repoId,
          sha: `sha-${i}`,
          message: `Commit ${i}`,
          author: 'Test Author',
          committedAt: new Date(Date.now() - i * 1000),
          processedBy: [],
          createdAt: new Date(),
        });
      }

      await fileRepo.saveMany(commits);

      // Query without limit - should return ALL 120 items
      const results = await fileRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 120, 'File-based should return all 120 items when no limit specified');
    });

    it('mongodb returns ALL results when no limit specified (> 100 items)', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoCommitRepository(mongoDB);

      // Create 120 commits
      const commits: Commit[] = [];
      for (let i = 0; i < 120; i++) {
        commits.push({
          id: uuid(),
          repoId,
          sha: `sha-${i}`,
          message: `Commit ${i}`,
          author: 'Test Author',
          committedAt: new Date(Date.now() - i * 1000),
          processedBy: [],
          createdAt: new Date(),
        });
      }

      await mongoRepo.saveMany(commits);

      // Query without limit - should return ALL 120 items
      const results = await mongoRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 120, 'MongoDB should return all 120 items when no limit specified');
    });

    it('both implementations return same count without limit', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoCommitRepository(mongoDB);
      const fileRepo = new FileCommitRepository(tempDir);

      // Create 115 commits
      const commits: Commit[] = [];
      for (let i = 0; i < 115; i++) {
        commits.push({
          id: uuid(),
          repoId,
          sha: `sha-${i}`,
          message: `Commit ${i}`,
          author: 'Test Author',
          committedAt: new Date(Date.now() - i * 1000),
          processedBy: [],
          createdAt: new Date(),
        });
      }

      await mongoRepo.saveMany(commits);
      await fileRepo.saveMany(commits);

      const mongoResults = await mongoRepo.findByRepo(repoId);
      const fileResults = await fileRepo.findByRepo(repoId);

      assert.strictEqual(mongoResults.length, fileResults.length, 'Both implementations should return same count');
      assert.strictEqual(mongoResults.length, 115, 'Should return all 115 items');
    });
  });

  describe('ProcessingRunRepository.findByRepo', () => {
    it('file-based returns ALL results when no limit specified (> 100 items)', async () => {
      const fileRepo = new FileProcessingRunRepository(tempDir);

      // Create 110 processing runs
      const runs: ProcessingRun[] = [];
      for (let i = 0; i < 110; i++) {
        runs.push({
          id: uuid(),
          repoId,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          completedAt: new Date(),
          totalIterations: 10,
          completedIterations: 10,
          successfulIterations: 10,
          failedIterations: 0,
          totalCostUsd: 1.0,
          wikiPagesCreated: 5,
          wikiPagesUpdated: 3,
        });
      }

      for (const run of runs) {
        await fileRepo.save(run);
      }

      // Query without limit - should return ALL 110 items
      const results = await fileRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 110, 'File-based should return all 110 items when no limit specified');
    });

    it('mongodb returns ALL results when no limit specified (> 100 items)', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoProcessingRunRepository(mongoDB);

      // Create 110 processing runs
      const runs: ProcessingRun[] = [];
      for (let i = 0; i < 110; i++) {
        runs.push({
          id: uuid(),
          repoId,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          completedAt: new Date(),
          totalIterations: 10,
          completedIterations: 10,
          successfulIterations: 10,
          failedIterations: 0,
          totalCostUsd: 1.0,
          wikiPagesCreated: 5,
          wikiPagesUpdated: 3,
        });
      }

      for (const run of runs) {
        await mongoRepo.save(run);
      }

      // Query without limit - should return ALL 110 items
      const results = await mongoRepo.findByRepo(repoId);
      assert.strictEqual(results.length, 110, 'MongoDB should return all 110 items when no limit specified');
    });

    it('both implementations return same count without limit', async function () {
      if (!mongoDB) {
        this.skip();
        return;
      }

      const mongoRepo = new MongoProcessingRunRepository(mongoDB);
      const fileRepo = new FileProcessingRunRepository(tempDir);

      // Create 105 processing runs
      const runs: ProcessingRun[] = [];
      for (let i = 0; i < 105; i++) {
        runs.push({
          id: uuid(),
          repoId,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 1000),
          completedAt: new Date(),
          totalIterations: 10,
          completedIterations: 10,
          successfulIterations: 10,
          failedIterations: 0,
          totalCostUsd: 1.0,
          wikiPagesCreated: 5,
          wikiPagesUpdated: 3,
        });
      }

      for (const run of runs) {
        await mongoRepo.save(run);
        await fileRepo.save(run);
      }

      const mongoResults = await mongoRepo.findByRepo(repoId);
      const fileResults = await fileRepo.findByRepo(repoId);

      assert.strictEqual(mongoResults.length, fileResults.length, 'Both implementations should return same count');
      assert.strictEqual(mongoResults.length, 105, 'Should return all 105 items');
    });
  });
});
