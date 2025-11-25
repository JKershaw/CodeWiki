import type { WorkQueueRepository } from '../interfaces/work-queue-repository.js';
import type { WorkItem, WorkItemStatus } from '../../domain/work-item.js';
import type { AgentType } from '../../domain/agent-run.js';
import { FileStore } from './file-store.js';

export class FileWorkQueueRepository implements WorkQueueRepository {
  private store: FileStore<WorkItem>;

  constructor(baseDir: string) {
    this.store = new FileStore<WorkItem>(baseDir, 'work-queue');
  }

  async findById(id: string): Promise<WorkItem | null> {
    return this.store.get(id);
  }

  async findPending(repoId: string, limit: number): Promise<WorkItem[]> {
    const pending = await this.store.find(w =>
      w.repoId === repoId && w.status === 'pending'
    );
    // Sort by priority (highest first), then by creation time (oldest first)
    pending.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return pending.slice(0, limit);
  }

  async findByRepo(repoId: string, options?: {
    status?: WorkItemStatus;
    agentType?: AgentType;
  }): Promise<WorkItem[]> {
    return this.store.find(w => {
      if (w.repoId !== repoId) return false;
      if (options?.status && w.status !== options.status) return false;
      if (options?.agentType && w.agentType !== options.agentType) return false;
      return true;
    });
  }

  async countPending(repoId: string): Promise<number> {
    return this.store.count(w => w.repoId === repoId && w.status === 'pending');
  }

  async countByStatus(repoId: string): Promise<Record<WorkItemStatus, number>> {
    const all = await this.store.find(w => w.repoId === repoId);
    const counts: Record<WorkItemStatus, number> = {
      pending: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
    };
    for (const item of all) {
      counts[item.status]++;
    }
    return counts;
  }

  async save(item: WorkItem): Promise<void> {
    await this.store.set(item);
  }

  async saveMany(items: WorkItem[]): Promise<void> {
    await this.store.setMany(items);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(w => w.repoId === repoId);
  }

  async claimNext(repoId: string): Promise<WorkItem | null> {
    // Get the highest priority pending item
    const pending = await this.findPending(repoId, 1);
    if (pending.length === 0) return null;

    const item = pending[0]!;
    item.status = 'claimed';
    item.claimedAt = new Date();
    await this.store.set(item);
    return item;
  }

  async complete(id: string, agentRunId: string): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      completedAt: new Date(),
      agentRunId,
    });
  }

  async fail(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      completedAt: new Date(),
    });
  }

  async exists(repoId: string, agentType: AgentType, targetCommitId: string): Promise<boolean> {
    const found = await this.store.findOne(w =>
      w.repoId === repoId &&
      w.agentType === agentType &&
      w.targetCommitId === targetCommitId &&
      (w.status === 'pending' || w.status === 'claimed')
    );
    return found !== null;
  }
}
