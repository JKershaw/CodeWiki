/**
 * Unit tests for FindingsRepository.
 * Tests findings storage, querying, and grouping functionality.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { createRepositories, type RepositoryConnection } from '../../src/repositories/index.js';
import type { FindingsRepository } from '../../src/repositories/interfaces/findings-repository.js';
import { createFinding, type Finding, type FindingType } from '../../src/domain/finding.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FindingsRepository', () => {
  let repo: FindingsRepository;
  let tempDir: string;
  let connection: RepositoryConnection;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'findings-test-'));
    connection = await createRepositories({ fileBasePath: tempDir });
    repo = connection.repositories.findings;
  });

  afterEach(async () => {
    await connection.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('save and find', () => {
    it('saves and retrieves a finding by id', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Duplicate title found',
        affectedPaths: ['path/a', 'path/b'],
        severity: 'medium',
      });

      await repo.save(finding);
      const retrieved = await repo.findById(finding.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, finding.id);
      assert.strictEqual(retrieved.type, 'duplicate_title');
      assert.strictEqual(retrieved.status, 'open');
    });

    it('returns null for non-existent finding', async () => {
      const result = await repo.findById('nonexistent');
      assert.strictEqual(result, null);
    });
  });

  describe('findByWiki', () => {
    it('finds all findings for a wiki', async () => {
      const finding1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Finding 1',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      const finding2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Finding 2',
        affectedPaths: ['path/b'],
        severity: 'high',
      });

      const finding3 = createFinding({
        id: uuid(),
        wikiId: 'wiki-2',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'terminology',
        description: 'Finding for different wiki',
        affectedPaths: ['path/c'],
        severity: 'low',
      });

      await repo.saveMany([finding1, finding2, finding3]);

      const results = await repo.findByWiki('wiki-1');
      assert.strictEqual(results.length, 2);
    });

    it('filters by status', async () => {
      const openFinding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Open finding',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      await repo.save(openFinding);
      await repo.markAddressed(openFinding.id, 'run-2');

      const addressedFinding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Still open',
        affectedPaths: ['path/b'],
        severity: 'high',
      });
      await repo.save(addressedFinding);

      const openResults = await repo.findByWiki('wiki-1', { status: 'open' });
      assert.strictEqual(openResults.length, 1);
      assert.strictEqual(openResults[0]!.description, 'Still open');

      const addressedResults = await repo.findByWiki('wiki-1', { status: 'addressed' });
      assert.strictEqual(addressedResults.length, 1);
      assert.strictEqual(addressedResults[0]!.description, 'Open finding');
    });

    it('filters by type', async () => {
      const finding1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Duplicate',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      const finding2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Broken',
        affectedPaths: ['path/b'],
        severity: 'high',
      });

      await repo.saveMany([finding1, finding2]);

      const results = await repo.findByWiki('wiki-1', { type: 'broken_link' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.type, 'broken_link');
    });
  });

  describe('findOpen', () => {
    it('returns only open findings', async () => {
      const finding1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Open',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      const finding2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Will be addressed',
        affectedPaths: ['path/b'],
        severity: 'high',
      });

      await repo.saveMany([finding1, finding2]);
      await repo.markAddressed(finding2.id, 'run-2');

      const results = await repo.findOpen('wiki-1');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.description, 'Open');
    });
  });

  describe('groupOpenFindings', () => {
    it('groups findings by type', async () => {
      const finding1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Dup 1',
        affectedPaths: ['path/a', 'path/b'],
        severity: 'medium',
      });

      const finding2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Dup 2',
        affectedPaths: ['path/c', 'path/d'],
        severity: 'high',
      });

      const finding3 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Broken',
        affectedPaths: ['path/e'],
        severity: 'low',
      });

      await repo.saveMany([finding1, finding2, finding3]);

      const groups = await repo.groupOpenFindings('wiki-1');

      // Should have groups for duplicate_title and broken_link
      assert.ok(groups.length >= 1);

      // broken_link has higher priority (90) than duplicate_title (80)
      const brokenLinkGroup = groups.find(g => g.type === 'broken_link');
      assert.ok(brokenLinkGroup);
    });

    it('returns empty array when no open findings', async () => {
      const groups = await repo.groupOpenFindings('wiki-1');
      assert.strictEqual(groups.length, 0);
    });
  });

  describe('markInProgress and markAddressed', () => {
    it('marks finding as in_progress', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Test',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      await repo.save(finding);
      await repo.markInProgress(finding.id, 'run-2');

      const updated = await repo.findById(finding.id);
      assert.strictEqual(updated!.status, 'in_progress');
      assert.strictEqual(updated!.addressedByAgentRunId, 'run-2');
    });

    it('marks finding as addressed with timestamp', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Test',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      await repo.save(finding);
      await repo.markAddressed(finding.id, 'run-2');

      const updated = await repo.findById(finding.id);
      assert.strictEqual(updated!.status, 'addressed');
      assert.strictEqual(updated!.addressedByAgentRunId, 'run-2');
      assert.ok(updated!.addressedAt instanceof Date);
    });
  });

  describe('existsSimilar', () => {
    it('returns true for finding with same type and paths', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Existing',
        affectedPaths: ['path/a', 'path/b'],
        severity: 'medium',
      });

      await repo.save(finding);

      const exists = await repo.existsSimilar('wiki-1', 'duplicate_title', ['path/a', 'path/b']);
      assert.strictEqual(exists, true);
    });

    it('returns false for different type', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Existing',
        affectedPaths: ['path/a', 'path/b'],
        severity: 'medium',
      });

      await repo.save(finding);

      const exists = await repo.existsSimilar('wiki-1', 'broken_link', ['path/a', 'path/b']);
      assert.strictEqual(exists, false);
    });

    it('returns false for addressed findings', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Addressed',
        affectedPaths: ['path/a', 'path/b'],
        severity: 'medium',
      });

      await repo.save(finding);
      await repo.markAddressed(finding.id, 'run-2');

      const exists = await repo.existsSimilar('wiki-1', 'duplicate_title', ['path/a', 'path/b']);
      assert.strictEqual(exists, false);
    });
  });

  describe('delete operations', () => {
    it('deletes a finding by id', async () => {
      const finding = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'To delete',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      await repo.save(finding);
      await repo.delete(finding.id);

      const result = await repo.findById(finding.id);
      assert.strictEqual(result, null);
    });

    it('deletes all findings for a wiki', async () => {
      const finding1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'duplicate_title',
        description: 'Wiki 1',
        affectedPaths: ['path/a'],
        severity: 'medium',
      });

      const finding2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-2',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Wiki 2',
        affectedPaths: ['path/b'],
        severity: 'high',
      });

      await repo.saveMany([finding1, finding2]);
      await repo.deleteByWiki('wiki-1');

      const wiki1Results = await repo.findByWiki('wiki-1');
      const wiki2Results = await repo.findByWiki('wiki-2');

      assert.strictEqual(wiki1Results.length, 0);
      assert.strictEqual(wiki2Results.length, 1);
    });
  });

  describe('sorting and limiting', () => {
    it('sorts by priority (highest first) then by detectedAt (newest first)', async () => {
      // Create findings with different priorities and timestamps
      // Priority order: contradiction=100, broken_link=90, terminology=50, low_quality=20
      const now = Date.now();

      const lowQuality1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'low_quality',
        description: 'Low quality 1',
        affectedPaths: ['path/a'],
        severity: 'low',
      });
      lowQuality1.detectedAt = new Date(now - 4000); // 4 seconds ago

      const terminology1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'terminology',
        description: 'Terminology 1',
        affectedPaths: ['path/b'],
        severity: 'medium',
      });
      terminology1.detectedAt = new Date(now - 3000); // 3 seconds ago

      const brokenLink1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Broken link 1',
        affectedPaths: ['path/c'],
        severity: 'high',
      });
      brokenLink1.detectedAt = new Date(now - 2000); // 2 seconds ago

      const contradiction1 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'contradiction',
        description: 'Contradiction 1',
        affectedPaths: ['path/d'],
        severity: 'high',
      });
      contradiction1.detectedAt = new Date(now - 1000); // 1 second ago

      // Add a second broken_link with older timestamp to test secondary sort
      const brokenLink2 = createFinding({
        id: uuid(),
        wikiId: 'wiki-1',
        repoId: 'repo-1',
        sourceAgentRunId: 'run-1',
        type: 'broken_link',
        description: 'Broken link 2',
        affectedPaths: ['path/e'],
        severity: 'high',
      });
      brokenLink2.detectedAt = new Date(now - 5000); // 5 seconds ago (older)

      await repo.saveMany([lowQuality1, terminology1, brokenLink1, contradiction1, brokenLink2]);

      const results = await repo.findByWiki('wiki-1');

      // Verify sort order
      assert.strictEqual(results.length, 5);
      assert.strictEqual(results[0]!.type, 'contradiction', 'First should be contradiction (priority 100)');
      assert.strictEqual(results[1]!.type, 'broken_link', 'Second should be broken_link (priority 90)');
      assert.strictEqual(results[1]!.description, 'Broken link 1', 'Newer broken_link should come first');
      assert.strictEqual(results[2]!.type, 'broken_link', 'Third should be older broken_link');
      assert.strictEqual(results[2]!.description, 'Broken link 2', 'Older broken_link should come second');
      assert.strictEqual(results[3]!.type, 'terminology', 'Fourth should be terminology (priority 50)');
      assert.strictEqual(results[4]!.type, 'low_quality', 'Fifth should be low_quality (priority 20)');
    });

    it('applies limit AFTER sorting to return top N items', async () => {
      // Create findings with clear priority order
      const now = Date.now();

      const findings = [
        { type: 'contradiction' as FindingType, priority: 100, time: now - 1000 },
        { type: 'inaccurate' as FindingType, priority: 95, time: now - 2000 },
        { type: 'broken_link' as FindingType, priority: 90, time: now - 3000 },
        { type: 'duplicate_title' as FindingType, priority: 80, time: now - 4000 },
        { type: 'similar_content' as FindingType, priority: 60, time: now - 5000 },
        { type: 'terminology' as FindingType, priority: 50, time: now - 6000 },
      ];

      const createdFindings = findings.map((f, i) => {
        const finding = createFinding({
          id: uuid(),
          wikiId: 'wiki-1',
          repoId: 'repo-1',
          sourceAgentRunId: 'run-1',
          type: f.type,
          description: `Finding ${i}`,
          affectedPaths: [`path/${i}`],
          severity: 'medium',
        });
        finding.detectedAt = new Date(f.time);
        return finding;
      });

      await repo.saveMany(createdFindings);

      // Request top 3 items
      const results = await repo.findByWiki('wiki-1', { limit: 3 });

      // Should return the TOP 3 after sorting (highest priority first)
      assert.strictEqual(results.length, 3, 'Should return exactly 3 items');
      assert.strictEqual(results[0]!.type, 'contradiction', 'First should be contradiction (priority 100)');
      assert.strictEqual(results[1]!.type, 'inaccurate', 'Second should be inaccurate (priority 95)');
      assert.strictEqual(results[2]!.type, 'broken_link', 'Third should be broken_link (priority 90)');

      // These should NOT be in the results (they have lower priority)
      const types = results.map(r => r.type);
      assert.ok(!types.includes('duplicate_title'), 'Should not include duplicate_title (priority 80)');
      assert.ok(!types.includes('similar_content'), 'Should not include similar_content (priority 60)');
      assert.ok(!types.includes('terminology'), 'Should not include terminology (priority 50)');
    });
  });
});
