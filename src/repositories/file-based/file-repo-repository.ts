import type { RepoRepository } from '../interfaces/repo-repository.js';
import type { Repo, RepoStatus } from '../../domain/repo.js';
import { FileStore } from './file-store.js';

export class FileRepoRepository implements RepoRepository {
  private store: FileStore<Repo>;

  constructor(baseDir: string) {
    this.store = new FileStore<Repo>(baseDir, 'repos');
  }

  async findById(id: string): Promise<Repo | null> {
    return this.store.get(id);
  }

  async findByFullName(fullName: string): Promise<Repo | null> {
    return this.store.findOne(repo => repo.fullName === fullName);
  }

  async findByStatus(status: RepoStatus): Promise<Repo[]> {
    return this.store.find(repo => repo.status === status);
  }

  async findAll(): Promise<Repo[]> {
    return this.store.getAll();
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
