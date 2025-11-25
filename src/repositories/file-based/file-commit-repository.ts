import type { CommitRepository } from '../interfaces/commit-repository.js';
import type { Commit, AgentProcessingRecord } from '../../domain/commit.js';
import { FileStore } from './file-store.js';

/**
 * Normalize commit dates from JSON storage.
 * JSON storage may convert Date objects to ISO strings.
 */
function normalizeCommitDates(commit: Commit): Commit {
  return {
    ...commit,
    committedAt: commit.committedAt instanceof Date
      ? commit.committedAt
      : new Date(commit.committedAt as unknown as string),
    createdAt: commit.createdAt instanceof Date
      ? commit.createdAt
      : new Date(commit.createdAt as unknown as string),
    processedBy: commit.processedBy.map(p => ({
      ...p,
      processedAt: p.processedAt instanceof Date
        ? p.processedAt
        : new Date(p.processedAt as unknown as string),
    })),
  };
}

export class FileCommitRepository implements CommitRepository {
  private store: FileStore<Commit>;

  constructor(baseDir: string) {
    this.store = new FileStore<Commit>(baseDir, 'commits');
  }

  async findById(id: string): Promise<Commit | null> {
    const commit = await this.store.get(id);
    return commit ? normalizeCommitDates(commit) : null;
  }

  async findBySha(repoId: string, sha: string): Promise<Commit | null> {
    const commit = await this.store.findOne(c => c.repoId === repoId && c.sha === sha);
    return commit ? normalizeCommitDates(commit) : null;
  }

  async findByRepo(repoId: string, options?: { limit?: number; offset?: number }): Promise<Commit[]> {
    const all = (await this.store.find(c => c.repoId === repoId)).map(normalizeCommitDates);
    // Sort by commit date, newest first
    all.sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async findUnprocessedByAgent(repoId: string, agentType: string): Promise<Commit[]> {
    const commits = await this.store.find(c =>
      c.repoId === repoId &&
      !c.processedBy.some(p => p.agentType === agentType)
    );
    return commits.map(normalizeCommitDates);
  }

  async findByDateRange(repoId: string, start: Date, end: Date): Promise<Commit[]> {
    const commits = await this.store.find(c => {
      const commitDate = c.committedAt instanceof Date ? c.committedAt : new Date(c.committedAt as unknown as string);
      return c.repoId === repoId &&
        commitDate >= start &&
        commitDate <= end;
    });
    return commits.map(normalizeCommitDates);
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
