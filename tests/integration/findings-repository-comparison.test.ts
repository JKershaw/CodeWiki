/**
 * Integration tests comparing MongoDB and file-based FindingsRepository implementations.
 * Verifies both implementations return identical results for the same queries.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { MongoClient, Db } from 'mongodb';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileFindingsRepository } from '../../src/repositories/file-based/file-findings-repository.js';
import { MongoFindingsRepository } from '../../src/repositories/mongo-based/mongo-findings-repository.js';
import { createFinding, type Finding, type FindingType } from '../../src/domain/finding.js';

describe('FindingsRepository implementation comparison', () => {
  let tempDir: string;
  let fileRepo: FileFindingsRepository;
  let mongoRepo: MongoFindingsRepository | null = null;
  let mongoClient: MongoClient | null = null;
  let db: Db | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'findings-comparison-test-'));
    fileRepo = new FileFindingsRepository(tempDir);

    // Try to connect to MongoDB if MONGODB_URI is set
    const mongoUri = process.env['MONGODB_URI'];
    if (mongoUri) {
      try {
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        db = mongoClient.db('codewiki-test-' + uuid());
        mongoRepo = new MongoFindingsRepository(db);
      } catch (error) {
        console.log('MongoDB not available, skipping MongoDB tests:', error);
      }
    }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (mongoClient && db) {
      await db.dropDatabase();
      await mongoClient.close();
    }
  });

  describe('sorting and limiting consistency', () => {
    it('both implementations return identical results when sorting and limiting', async () => {
      // Create findings with clear priority order
      const now = Date.now();

      const findings: Finding[] = [
        { type: 'contradiction' as FindingType, priority: 100, time: now - 1000, desc: 'Contradiction' },
        { type: 'inaccurate' as FindingType, priority: 95, time: now - 2000, desc: 'Inaccurate' },
        { type: 'broken_link' as FindingType, priority: 90, time: now - 3000, desc: 'Broken link' },
        { type: 'duplicate_title' as FindingType, priority: 80, time: now - 4000, desc: 'Duplicate' },
        { type: 'similar_content' as FindingType, priority: 60, time: now - 5000, desc: 'Similar' },
        { type: 'terminology' as FindingType, priority: 50, time: now - 6000, desc: 'Terminology' },
        { type: 'category_mismatch' as FindingType, priority: 40, time: now - 7000, desc: 'Category' },
        { type: 'orphaned_page' as FindingType, priority: 30, time: now - 8000, desc: 'Orphaned' },
        { type: 'low_quality' as FindingType, priority: 20, time: now - 9000, desc: 'Low quality' },
      ].map((f, i) => {
        const finding = createFinding({
          id: `finding-${i}`,
          wikiId: 'wiki-1',
          repoId: 'repo-1',
          sourceAgentRunId: 'run-1',
          type: f.type,
          description: f.desc,
          affectedPaths: [`path/${i}`],
          severity: 'medium',
        });
        finding.detectedAt = new Date(f.time);
        return finding;
      });

      // Save to file-based repo
      await fileRepo.saveMany(findings);

      // Get results from file-based repo with limit
      const fileResults = await fileRepo.findByWiki('wiki-1', { limit: 3 });

      // Verify file-based returns top 3 by priority
      assert.strictEqual(fileResults.length, 3, 'File-based should return exactly 3 items');
      assert.strictEqual(fileResults[0]!.type, 'contradiction', 'File: First should be contradiction (priority 100)');
      assert.strictEqual(fileResults[1]!.type, 'inaccurate', 'File: Second should be inaccurate (priority 95)');
      assert.strictEqual(fileResults[2]!.type, 'broken_link', 'File: Third should be broken_link (priority 90)');

      // If MongoDB is available, test it too
      if (mongoRepo) {
        await mongoRepo.saveMany(findings);
        const mongoResults = await mongoRepo.findByWiki('wiki-1', { limit: 3 });

        // MongoDB should return the SAME results as file-based
        assert.strictEqual(mongoResults.length, 3, 'MongoDB should return exactly 3 items');
        assert.strictEqual(mongoResults[0]!.type, 'contradiction', 'Mongo: First should be contradiction (priority 100)');
        assert.strictEqual(mongoResults[1]!.type, 'inaccurate', 'Mongo: Second should be inaccurate (priority 95)');
        assert.strictEqual(mongoResults[2]!.type, 'broken_link', 'Mongo: Third should be broken_link (priority 90)');

        // Verify both implementations return identical IDs in the same order
        assert.deepStrictEqual(
          mongoResults.map(r => r.id),
          fileResults.map(r => r.id),
          'MongoDB and file-based should return identical results in the same order'
        );
      }
    });

    it('both implementations handle secondary sort (detectedAt) consistently', async () => {
      const now = Date.now();

      // Create multiple findings with the SAME priority but different timestamps
      const findings: Finding[] = [
        { time: now - 5000, desc: 'Oldest' },
        { time: now - 4000, desc: 'Old' },
        { time: now - 3000, desc: 'Medium' },
        { time: now - 2000, desc: 'Recent' },
        { time: now - 1000, desc: 'Newest' },
      ].map((f, i) => {
        const finding = createFinding({
          id: `finding-${i}`,
          wikiId: 'wiki-1',
          repoId: 'repo-1',
          sourceAgentRunId: 'run-1',
          type: 'broken_link', // All same priority
          description: f.desc,
          affectedPaths: [`path/${i}`],
          severity: 'medium',
        });
        finding.detectedAt = new Date(f.time);
        return finding;
      });

      // Save to file-based repo
      await fileRepo.saveMany(findings);

      // Get top 3 from file-based repo
      const fileResults = await fileRepo.findByWiki('wiki-1', { limit: 3 });

      // Should return the 3 NEWEST (secondary sort by detectedAt descending)
      assert.strictEqual(fileResults.length, 3);
      assert.strictEqual(fileResults[0]!.description, 'Newest', 'File: First should be newest');
      assert.strictEqual(fileResults[1]!.description, 'Recent', 'File: Second should be recent');
      assert.strictEqual(fileResults[2]!.description, 'Medium', 'File: Third should be medium');

      // If MongoDB is available, verify it matches
      if (mongoRepo) {
        await mongoRepo.saveMany(findings);
        const mongoResults = await mongoRepo.findByWiki('wiki-1', { limit: 3 });

        assert.strictEqual(mongoResults.length, 3);
        assert.strictEqual(mongoResults[0]!.description, 'Newest', 'Mongo: First should be newest');
        assert.strictEqual(mongoResults[1]!.description, 'Recent', 'Mongo: Second should be recent');
        assert.strictEqual(mongoResults[2]!.description, 'Medium', 'Mongo: Third should be medium');

        // Verify exact match
        assert.deepStrictEqual(
          mongoResults.map(r => r.id),
          fileResults.map(r => r.id),
          'MongoDB and file-based should return identical results'
        );
      }
    });
  });
});
