import type { AutoBenchmarkRepository } from '../interfaces/auto-benchmark-repository.js';
import type { AutoBenchmarkRun, AutoBenchmarkStatus, AutoBenchmarkPhase } from '../../domain/auto-benchmark.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<AutoBenchmarkRun>({
  required: ['startedAt'],
  optional: ['completedAt'],
});

export class FileAutoBenchmarkRepository implements AutoBenchmarkRepository {
  private store: FileStore<AutoBenchmarkRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<AutoBenchmarkRun>(baseDir, 'auto-benchmarks');
  }

  async findById(id: string): Promise<AutoBenchmarkRun | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    status?: AutoBenchmarkStatus;
  }): Promise<AutoBenchmarkRun[]> {
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

  async findByWiki(wikiId: string, options?: {
    limit?: number;
    offset?: number;
    status?: AutoBenchmarkStatus;
  }): Promise<AutoBenchmarkRun[]> {
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

  async findRunning(repoId: string): Promise<AutoBenchmarkRun | null> {
    const results = await this.store.find(r =>
      r.repoId === repoId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return hydrateDates(results[0]!);
  }

  async findRunningByWiki(wikiId: string): Promise<AutoBenchmarkRun | null> {
    const results = await this.store.find(r =>
      r.wikiId === wikiId && r.status === 'running'
    );
    if (results.length === 0) return null;
    return hydrateDates(results[0]!);
  }

  async findAllRunning(): Promise<AutoBenchmarkRun[]> {
    const results = await this.store.find(r => r.status === 'running');
    return results.map(hydrateDates);
  }

  async save(run: AutoBenchmarkRun): Promise<void> {
    await this.store.set(run);
  }

  async updateProgress(id: string, cycle: number, phase: AutoBenchmarkPhase): Promise<void> {
    await this.store.update(id, {
      currentCycle: cycle,
      currentPhase: phase,
    });
  }

  async complete(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      completedAt: new Date(),
      currentPhase: 'complete',
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      completedAt: new Date(),
      error,
    });
  }

  async stop(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'stopped',
      completedAt: new Date(),
    });
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
}
