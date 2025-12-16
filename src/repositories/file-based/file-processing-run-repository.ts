import type { ProcessingRunRepository } from '../interfaces/processing-run-repository.js';
import type { ProcessingRun, ProcessingRunStatus } from '../../domain/processing-run.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<ProcessingRun>({
  required: ['startedAt'],
  optional: ['completedAt'],
});

export class FileProcessingRunRepository implements ProcessingRunRepository {
  private store: FileStore<ProcessingRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<ProcessingRun>(baseDir, 'processing-runs');
  }

  async findById(id: string): Promise<ProcessingRun | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: ProcessingRunStatus;
  }): Promise<ProcessingRun[]> {
    let results = await this.store.find(r => {
      if (r.repoId !== repoId) return false;
      if (options?.status && r.status !== options.status) return false;
      return true;
    });

    // Hydrate dates and sort by start time, newest first
    results = results.map(hydrateDates);
    results.sort((a, b) => getTime(b.startedAt) - getTime(a.startedAt));

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async findActive(repoId: string): Promise<ProcessingRun | null> {
    const results = await this.store.find(r =>
      r.repoId === repoId && (r.status === 'running' || r.status === 'stopping')
    );
    if (results.length === 0) return null;
    return hydrateDates(results[0]!);
  }

  async findMostRecent(repoId: string): Promise<ProcessingRun | null> {
    let results = await this.store.find(r => r.repoId === repoId);
    if (results.length === 0) return null;

    results = results.map(hydrateDates);
    results.sort((a, b) => getTime(b.startedAt) - getTime(a.startedAt));
    return results[0]!;
  }

  async save(run: ProcessingRun): Promise<void> {
    await this.store.set(run);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(r => r.repoId === repoId);
  }

  async updateProgress(id: string, updates: {
    completedIterations: number;
    successfulIterations: number;
    failedIterations: number;
    totalCostUsd: number;
    wikiPagesCreated: number;
    wikiPagesUpdated: number;
    duplicatesFiltered?: number;
  }): Promise<void> {
    await this.store.update(id, updates);
  }

  async complete(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      error,
      completedAt: new Date(),
    });
  }

  async stop(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'stopped',
      completedAt: new Date(),
    });
  }

  async requestStop(id: string): Promise<void> {
    const run = await this.store.get(id);
    if (!run) return;

    await this.store.update(id, {
      status: 'stopping',
      totalIterations: run.completedIterations,
    });
  }

  async confirmStop(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'stopped',
      completedAt: new Date(),
    });
  }
}
