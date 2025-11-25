import type { CommitRepository } from '../interfaces/commit-repository.js';
import type { Commit, AgentProcessingRecord } from '../../domain/commit.js';
import { FileStore } from './file-store.js';

export class FileCommitRepository implements CommitRepository {
  private store: FileStore<Commit>;

  constructor(baseDir: string) {
    this.store = new FileStore<Commit>(baseDir, 'commits');
  }

  async findById(id: string): Promise<Commit | null> {
    return this.store.get(id);
  }

  async findBySha(repoId: string, sha: string): Promise<Commit | null> {
    return this.store.findOne(c => c.repoId === repoId && c.sha === sha);
  }

  async findByRepo(repoId: string, options?: { limit?: number; offset?: number }): Promise<Commit[]> {
    const all = await this.store.find(c => c.repoId === repoId);
    // Sort by commit date, newest first
    all.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async findUnprocessedByAgent(repoId: string, agentType: string): Promise<Commit[]> {
    return this.store.find(c =>
      c.repoId === repoId &&
      !c.processedBy.some(p => p.agentType === agentType)
    );
  }

  async findByDateRange(repoId: string, start: Date, end: Date): Promise<Commit[]> {
    return this.store.find(c =>
      c.repoId === repoId &&
      c.committedAt >= start &&
      c.committedAt <= end
    );
  }

  async countByRepo(repoId: string): Promise<number> {
    return this.store.count(c => c.repoId === repoId);
  }

  async countProcessedByAgent(repoId: string, agentType: string): Promise<number> {
    return this.store.count(c =>
      c.repoId === repoId &&
      c.processedBy.some(p => p.agentType === agentType)
    );
  }

  async save(commit: Commit): Promise<void> {
    await this.store.set(commit);
  }

  async saveMany(commits: Commit[]): Promise<void> {
    await this.store.setMany(commits);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(c => c.repoId === repoId);
  }

  async addProcessingRecord(commitId: string, record: AgentProcessingRecord): Promise<void> {
    const commit = await this.store.get(commitId);
    if (commit) {
      commit.processedBy.push(record);
      await this.store.set(commit);
    }
  }
}
