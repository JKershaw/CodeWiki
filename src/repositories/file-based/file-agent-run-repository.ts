import type { AgentRunRepository } from '../interfaces/agent-run-repository.js';
import type { AgentRun, AgentType, AgentRunStatus, AgentResult } from '../../domain/agent-run.js';
import { FileStore } from './file-store.js';

export class FileAgentRunRepository implements AgentRunRepository {
  private store: FileStore<AgentRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<AgentRun>(baseDir, 'agent-runs');
  }

  async findById(id: string): Promise<AgentRun | null> {
    return this.store.get(id);
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    offset?: number;
    agentType?: AgentType;
    status?: AgentRunStatus;
  }): Promise<AgentRun[]> {
    let results = await this.store.find(r => {
      if (r.repoId !== repoId) return false;
      if (options?.agentType && r.agentType !== options.agentType) return false;
      if (options?.status && r.status !== options.status) return false;
      return true;
    });

    // Sort by start time, newest first
    results.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async findByCommit(commitId: string): Promise<AgentRun[]> {
    return this.store.find(r => r.targetCommitId === commitId);
  }

  async findRecentByType(repoId: string, agentType: AgentType, limit: number): Promise<AgentRun[]> {
    const results = await this.store.find(r =>
      r.repoId === repoId && r.agentType === agentType
    );
    results.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return results.slice(0, limit);
  }

  async countByStatus(repoId: string): Promise<Record<AgentRunStatus, number>> {
    const all = await this.store.find(r => r.repoId === repoId);
    const counts: Record<AgentRunStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const run of all) {
      counts[run.status]++;
    }
    return counts;
  }

  async calculateTotalCost(repoId: string, options?: { since?: Date; until?: Date }): Promise<number> {
    const all = await this.store.find(r => {
      if (r.repoId !== repoId) return false;
      if (options?.since && r.startedAt < options.since) return false;
      if (options?.until && r.startedAt > options.until) return false;
      return true;
    });
    return all.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  }

  async save(run: AgentRun): Promise<void> {
    await this.store.set(run);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(r => r.repoId === repoId);
  }

  async updateStatus(id: string, status: AgentRunStatus): Promise<void> {
    await this.store.update(id, { status });
  }

  async complete(id: string, result: AgentResult, durationMs: number, costUsd: number): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      result,
      durationMs,
      costUsd,
      completedAt: new Date(),
    });
  }

  async fail(id: string, error: string, durationMs: number): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      error,
      durationMs,
      completedAt: new Date(),
    });
  }
}
