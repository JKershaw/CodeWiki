import type { WorkQueueRepository } from '../interfaces/work-queue-repository.js';
import type { WorkItem, WorkItemStatus } from '../../domain/work-item.js';
import { getTargetCommitId, getWorkTargetKey, legacyToWorkTarget } from '../../domain/work-item.js';
import { normalizeDate, normalizeDateOrNull } from '../../domain/date-utils.js';
import { selectItemsForBatch } from '../../domain/work-queue-logic.js';
import { FileStore } from './file-store.js';

// Import agent type definitions from central registry
import { type AgentType } from '../../agents/registry.js';

/**
 * Normalize work item from JSON storage.
 * Handles date conversion and legacy targetCommitId/targetPath migration.
 */
function normalizeWorkItem(item: WorkItem & { targetCommitId?: string | null; targetPath?: string | null }): WorkItem {
  // Handle legacy items that have targetCommitId/targetPath instead of target
  const target = item.target ?? legacyToWorkTarget(
    item.targetCommitId ?? null,
    item.targetPath ?? null
  );

  return {
    ...item,
    target,
    createdAt: normalizeDate(item.createdAt),
    claimedAt: normalizeDateOrNull(item.claimedAt),
    completedAt: normalizeDateOrNull(item.completedAt),
  };
}

export class FileWorkQueueRepository implements WorkQueueRepository {
  private store: FileStore<WorkItem>;

  constructor(baseDir: string) {
    this.store = new FileStore<WorkItem>(baseDir, 'work-queue');
  }

  async findById(id: string): Promise<WorkItem | null> {
    const item = await this.store.get(id);
    return item ? normalizeWorkItem(item) : null;
  }

  async findPending(repoId: string, limit: number): Promise<WorkItem[]> {
    const pending = (await this.store.find(w =>
      w.repoId === repoId && w.status === 'pending'
    )).map(normalizeWorkItem);
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
    return items.map(normalizeWorkItem);
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

    // Use shared business logic to select which items to claim
    const { itemsToClaim } = selectItemsForBatch(pending, maxItems, processedCommits);

    // Mark items as claimed
    const claimedAt = new Date();
    for (const item of itemsToClaim) {
      item.status = 'claimed';
      item.claimedAt = claimedAt;
    }

    // Persist all claimed items
    if (itemsToClaim.length > 0) {
      await this.store.setMany(itemsToClaim);
    }

    return itemsToClaim;
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
    const items = (await this.store.find(w =>
      w.repoId === repoId &&
      w.agentType === agentType &&
      (w.status === 'pending' || w.status === 'claimed')
    )).map(normalizeWorkItem);

    return items.some(item => getTargetCommitId(item) === targetCommitId);
  }

  async getPendingKeys(repoId: string): Promise<Set<string>> {
    const items = (await this.store.find(w =>
      w.repoId === repoId &&
      (w.status === 'pending' || w.status === 'claimed')
    )).map(normalizeWorkItem);

    const keys = new Set<string>();
    for (const item of items) {
      // Key format: "agentType:commit:sha" or "agentType:path:dir" or "agentType:wiki"
      const targetKey = getWorkTargetKey(item.target);
      const key = `${item.agentType}:${targetKey}`;
      keys.add(key);
    }
    return keys;
  }
}
