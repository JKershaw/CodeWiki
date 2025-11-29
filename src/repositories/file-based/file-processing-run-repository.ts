import type { ProcessingRunRepository } from '../interfaces/processing-run-repository.js';
import type { ProcessingRun, ProcessingRunStatus } from '../../domain/processing-run.js';
import { FileStore } from './file-store.js';

export class FileProcessingRunRepository implements ProcessingRunRepository {
  private store: FileStore<ProcessingRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<ProcessingRun>(baseDir, 'processing-runs');
  }

  async findById(id: string): Promise<ProcessingRun | null> {
    const result = await this.store.get(id);
    return result ? this.hydrateDates(result) : null;
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
    results = results.map(r => this.hydrateDates(r));
    results.sort((a, b) => this.getTime(b.startedAt) - this.getTime(a.startedAt));

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async findActive(repoId: string): Promise<ProcessingRun | null> {
    const results = await this.store.find(r =>
      r.repoId === repoId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return this.hydrateDates(results[0]!);
  }

  async findMostRecent(repoId: string): Promise<ProcessingRun | null> {
    let results = await this.store.find(r => r.repoId === repoId);
    if (results.length === 0) return null;

    results = results.map(r => this.hydrateDates(r));
    results.sort((a, b) => this.getTime(b.startedAt) - this.getTime(a.startedAt));
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

  /** Safely get time from a Date or ISO string */
  private getTime(date: Date | string): number {
    if (date instanceof Date) return date.getTime();
    return new Date(date).getTime();
  }

  /** Ensure all date fields are proper Date objects */
  private hydrateDates(run: ProcessingRun): ProcessingRun {
    return {
      ...run,
      startedAt: run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt),
      completedAt: run.completedAt instanceof Date ? run.completedAt :
        (run.completedAt ? new Date(run.completedAt) : null),
    };
  }
}
