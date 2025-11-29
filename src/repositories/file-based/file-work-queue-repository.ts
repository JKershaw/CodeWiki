import type { WorkQueueRepository } from '../interfaces/work-queue-repository.js';
import type { WorkItem, WorkItemStatus } from '../../domain/work-item.js';
import type { AgentType } from '../../domain/agent-run.js';
import { FileStore } from './file-store.js';

/**
 * Analysis agents that process commits.
 * code-change must run first on a commit before others.
 */
const ANALYSIS_AGENTS: AgentType[] = [
  'code-change',
  'narrative',
  'security',
  'technical-debt',
  'pattern',
  'dependency',
];

/**
 * Meta agents that process the wiki.
 * These should only run when no analysis work is pending.
 */
const META_AGENTS: AgentType[] = [
  'link',
  'structure',
  'quality',
  'consistency',
];

/**
 * Normalize work item dates from JSON storage.
 */
function normalizeWorkItemDates(item: WorkItem): WorkItem {
  return {
    ...item,
    createdAt: item.createdAt instanceof Date
      ? item.createdAt
      : new Date(item.createdAt as unknown as string),
    claimedAt: item.claimedAt
      ? (item.claimedAt instanceof Date ? item.claimedAt : new Date(item.claimedAt as unknown as string))
      : null,
    completedAt: item.completedAt
      ? (item.completedAt instanceof Date ? item.completedAt : new Date(item.completedAt as unknown as string))
      : null,
  };
}

export class FileWorkQueueRepository implements WorkQueueRepository {
  private store: FileStore<WorkItem>;

  constructor(baseDir: string) {
    this.store = new FileStore<WorkItem>(baseDir, 'work-queue');
  }

  async findById(id: string): Promise<WorkItem | null> {
    const item = await this.store.get(id);
    return item ? normalizeWorkItemDates(item) : null;
  }

  async findPending(repoId: string, limit: number): Promise<WorkItem[]> {
    const pending = (await this.store.find(w =>
      w.repoId === repoId && w.status === 'pending'
    )).map(normalizeWorkItemDates);
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
    const items = await this.store.find(w => {
      if (w.repoId !== repoId) return false;
      if (options?.status && w.status !== options.status) return false;
      if (options?.agentType && w.agentType !== options.agentType) return false;
      return true;
    });
    return items.map(normalizeWorkItemDates);
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

  async claimBatch(
    repoId: string,
    maxItems: number,
    processedCommits: Set<string>
  ): Promise<WorkItem[]> {
    // Get extra pending items for filtering
    const pending = await this.findPending(repoId, maxItems * 3);
    if (pending.length === 0) return [];

    // Rule 1: If bootstrap is pending, return only that
    const bootstrapItem = pending.find(w => w.agentType === 'bootstrap');
    if (bootstrapItem) {
      bootstrapItem.status = 'claimed';
      bootstrapItem.claimedAt = new Date();
      await this.store.set(bootstrapItem);
      return [bootstrapItem];
    }

    // Check if there's any analysis work pending (for meta agent gating)
    const hasAnalysisPending = pending.some(w =>
      ANALYSIS_AGENTS.includes(w.agentType as AgentType)
    );

    const batch: WorkItem[] = [];
    const claimedCommitsInBatch = new Set<string>();

    for (const item of pending) {
      if (batch.length >= maxItems) break;

      // Rule 2: Meta agents can only run when no analysis work is pending
      if (META_AGENTS.includes(item.agentType as AgentType)) {
        if (hasAnalysisPending) continue;
      }

      // Rule 3: For commit-targeted non-code-change analysis agents,
      // verify code-change has already processed this commit
      if (
        item.targetCommitId &&
        item.agentType !== 'code-change' &&
        ANALYSIS_AGENTS.includes(item.agentType as AgentType)
      ) {
        if (!processedCommits.has(item.targetCommitId)) {
          continue;
        }
      }

      // Rule 4: Don't claim the same commit twice in one batch
      // (prevents race conditions on same commit)
      if (item.targetCommitId) {
        if (claimedCommitsInBatch.has(item.targetCommitId)) {
          continue;
        }
        claimedCommitsInBatch.add(item.targetCommitId);
      }

      // Claim this item
      item.status = 'claimed';
      item.claimedAt = new Date();
      batch.push(item);
    }

    // Persist all claimed items
    if (batch.length > 0) {
      await this.store.setMany(batch);
    }

    return batch;
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

  async getPendingKeys(repoId: string): Promise<Set<string>> {
    const items = await this.store.find(w =>
      w.repoId === repoId &&
      (w.status === 'pending' || w.status === 'claimed')
    );

    const keys = new Set<string>();
    for (const item of items) {
      // Key format: "agentType:targetCommitId" or "agentType:null"
      const key = `${item.agentType}:${item.targetCommitId ?? 'null'}`;
      keys.add(key);
    }
    return keys;
  }
}
