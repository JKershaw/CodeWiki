import type { RepoRepository } from '../interfaces/repo-repository.js';
import type { Repo, RepoStatus } from '../../domain/repo.js';
import { createDateNormalizer } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<Repo>({
  required: ['createdAt'],
  optional: ['lastProcessedAt'],
});

export class FileRepoRepository implements RepoRepository {
  private store: FileStore<Repo>;

  constructor(baseDir: string) {
    this.store = new FileStore<Repo>(baseDir, 'repos');
  }

  async findById(id: string): Promise<Repo | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByFullName(fullName: string): Promise<Repo | null> {
    const result = await this.store.findOne(repo => repo.fullName === fullName);
    return result ? hydrateDates(result) : null;
  }

  async findByStatus(status: RepoStatus): Promise<Repo[]> {
    const results = await this.store.find(repo => repo.status === status);
    return results.map(hydrateDates);
  }

  async findAll(): Promise<Repo[]> {
    const results = await this.store.getAll();
    return results.map(hydrateDates);
  }

  async save(repo: Repo): Promise<void> {
    await this.store.set(repo);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async updateStatus(id: string, status: RepoStatus): Promise<void> {
    await this.store.update(id, { status });
  }

  async updateLastProcessed(id: string, timestamp: Date): Promise<void> {
    await this.store.update(id, { lastProcessedAt: timestamp });
  }
}
