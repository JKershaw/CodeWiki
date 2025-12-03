import type { BenchmarkRepository } from '../interfaces/benchmark-repository.js';
import type { BenchmarkRun, BenchmarkRunStatus, BenchmarkResult, BenchmarkSummary } from '../../domain/benchmark.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<BenchmarkRun>({
  required: ['startedAt'],
  optional: ['completedAt'],
});

export class FileBenchmarkRepository implements BenchmarkRepository {
  private store: FileStore<BenchmarkRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<BenchmarkRun>(baseDir, 'benchmarks');
  }

  async findById(id: string): Promise<BenchmarkRun | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: BenchmarkRunStatus;
  }): Promise<BenchmarkRun[]> {
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

  async findLatest(repoId: string, limit = 10): Promise<BenchmarkRun[]> {
    return this.findByRepo(repoId, { limit });
  }

  async findByWiki(wikiId: string, options?: {
    limit?: number;
    offset?: number;
    status?: BenchmarkRunStatus;
  }): Promise<BenchmarkRun[]> {
    let results = await this.store.find(r => {
      if (r.wikiId !== wikiId) return false;
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

  async findLatestByWiki(wikiId: string, limit = 10): Promise<BenchmarkRun[]> {
    return this.findByWiki(wikiId, { limit });
  }

  async findRunning(repoId: string): Promise<BenchmarkRun | null> {
    const results = await this.store.find(r =>
      r.repoId === repoId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return hydrateDates(results[0]!);
  }

  async findRunningByWiki(wikiId: string): Promise<BenchmarkRun | null> {
    const results = await this.store.find(r =>
      r.wikiId === wikiId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return hydrateDates(results[0]!);
  }

  async save(run: BenchmarkRun): Promise<void> {
    await this.store.set(run);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(r => r.repoId === repoId);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany(r => r.wikiId === wikiId);
  }

  async complete(
    id: string,
    results: BenchmarkResult[],
    summary: BenchmarkSummary,
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
}
