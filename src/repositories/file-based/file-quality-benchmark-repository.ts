import type { QualityBenchmarkRepository } from '../interfaces/quality-benchmark-repository.js';
import type {
  QualityBenchmarkRun,
  QualityBenchmarkRunStatus,
  PageQualityResult,
  QualityBenchmarkSummary,
} from '../../domain/quality-benchmark.js';
import { FileStore } from './file-store.js';

export class FileQualityBenchmarkRepository implements QualityBenchmarkRepository {
  private store: FileStore<QualityBenchmarkRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<QualityBenchmarkRun>(baseDir, 'quality-benchmarks');
  }

  async findById(id: string): Promise<QualityBenchmarkRun | null> {
    const result = await this.store.get(id);
    return result ? this.hydrateDates(result) : null;
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: QualityBenchmarkRunStatus;
  }): Promise<QualityBenchmarkRun[]> {
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

  async findLatest(repoId: string, limit = 10): Promise<QualityBenchmarkRun[]> {
    return this.findByRepo(repoId, { limit });
  }

  async findRunning(repoId: string): Promise<QualityBenchmarkRun | null> {
    const results = await this.store.find(r =>
      r.repoId === repoId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return this.hydrateDates(results[0]!);
  }

  async save(run: QualityBenchmarkRun): Promise<void> {
    await this.store.set(run);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(r => r.repoId === repoId);
  }

  async complete(
    id: string,
    results: PageQualityResult[],
    summary: QualityBenchmarkSummary,
    totalCostUsd: number
  ): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      completedAt: new Date(),
      results,
      summary,
      totalCostUsd,
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      completedAt: new Date(),
      error,
    });
  }

  /** Safely get time from a Date or ISO string */
  private getTime(date: Date | string): number {
    if (date instanceof Date) return date.getTime();
    return new Date(date).getTime();
  }

  /** Ensure all date fields are proper Date objects */
  private hydrateDates(run: QualityBenchmarkRun): QualityBenchmarkRun {
    return {
      ...run,
      startedAt: run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt),
      completedAt: run.completedAt instanceof Date ? run.completedAt :
        (run.completedAt ? new Date(run.completedAt) : null),
    };
  }
}
