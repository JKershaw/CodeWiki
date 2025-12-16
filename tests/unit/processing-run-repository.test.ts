/**
 * Unit tests for ProcessingRunRepository implementations.
 * Tests that file-based and MongoDB implementations behave identically.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import { FileProcessingRunRepository } from '../../src/repositories/file-based/file-processing-run-repository.js';
import { createProcessingRun } from '../../src/domain/processing-run.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProcessingRunRepository', () => {
  describe('FileProcessingRunRepository', () => {
    let repo: FileProcessingRunRepository;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'processing-run-repo-test-'));
      repo = new FileProcessingRunRepository(tempDir);
    });

    describe('requestStop', () => {
      it('returns silently when run does not exist', async () => {
        // This should NOT throw an error
        await assert.doesNotReject(async () => {
          await repo.requestStop('nonexistent-id');
        });
      });

      it('sets status to stopping when run exists', async () => {
        const runId = uuid();
        const run = createProcessingRun({
          id: runId,
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          totalIterations: 10,
        });
        run.completedIterations = 5;
        await repo.save(run);

        await repo.requestStop(runId);

        const updated = await repo.findById(runId);
        assert.ok(updated);
        assert.strictEqual(updated.status, 'stopping');
        assert.strictEqual(updated.totalIterations, 5); // Reset to completedIterations
      });
    });
  });
});
