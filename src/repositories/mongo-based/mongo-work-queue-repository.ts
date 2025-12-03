import type { Collection, Db, Document, Filter } from 'mongodb';
import type { WorkQueueRepository } from '../interfaces/work-queue-repository.js';
import type { WorkItem, WorkItemStatus } from '../../domain/work-item.js';
import { getTargetCommitId, getWorkTargetKey, legacyToWorkTarget } from '../../domain/work-item.js';
import { selectItemsForBatch } from '../../domain/work-queue-logic.js';
import { toEntity, toEntities, toDocument, byId, byIds, replaceOp } from './mongo-utils.js';
import type { AgentType } from '../../agents/registry.js';

/**
 * Normalize a WorkItem to handle legacy data that has targetCommitId/targetPath
 * instead of the newer target field.
 */
function normalizeWorkItem(item: WorkItem & { targetCommitId?: string | null; targetPath?: string | null }): WorkItem {
  const target = item.target ?? legacyToWorkTarget(
    item.targetCommitId ?? null,
    item.targetPath ?? null
  );

  return {
    ...item,
    target,
  };
}

/**
 * Convert a document to a normalized WorkItem.
 */
function toWorkItem(doc: Document | null): WorkItem | null {
  const item = toEntity<WorkItem>(doc);
  return item ? normalizeWorkItem(item) : null;
}

/**
 * Convert multiple documents to normalized WorkItems.
 */
function toWorkItems(docs: Document[]): WorkItem[] {
  return toEntities<WorkItem>(docs).map(normalizeWorkItem);
}

export class MongoWorkQueueRepository implements WorkQueueRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('work-queue');
  }

  async findById(id: string): Promise<WorkItem | null> {
    const doc = await this.collection.findOne(byId(id));
    return toWorkItem(doc);
  }

  async findPending(repoId: string, limit: number): Promise<WorkItem[]> {
    const docs = await this.collection
      .find({ repoId, status: 'pending' })
      .sort({ priority: -1, createdAt: 1 })
      .limit(limit)
      .toArray();

    return toWorkItems(docs);
  }

  async findByRepo(
    repoId: string,
    options?: { status?: WorkItemStatus; agentType?: AgentType }
  ): Promise<WorkItem[]> {
    const filter: Filter<Document> = { repoId };

    if (options?.status) {
      filter.status = options.status;
    }
    if (options?.agentType) {
      filter.agentType = options.agentType;
    }

    const docs = await this.collection.find(filter).toArray();
    return toWorkItems(docs);
  }

  async countPending(repoId: string): Promise<number> {
    return this.collection.countDocuments({ repoId, status: 'pending' });
  }

  async countByStatus(repoId: string): Promise<Record<WorkItemStatus, number>> {
    const pipeline = [
      { $match: { repoId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();

    const counts: Record<WorkItemStatus, number> = {
      pending: 0,
      claimed: 0,
      completed: 0,
      failed: 0,
    };

    for (const result of results) {
      const status = result._id as WorkItemStatus;
      counts[status] = result.count;
    }

    return counts;
  }

  async save(item: WorkItem): Promise<void> {
    const doc = toDocument(item);
    await this.collection.replaceOne(byId(item.id), doc, { upsert: true });
  }

  async saveMany(items: WorkItem[]): Promise<void> {
    if (items.length === 0) return;

    const operations = items.map(item => replaceOp(item));
    await this.collection.bulkWrite(operations);
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async claimNext(repoId: string): Promise<WorkItem | null> {
    // Atomically find and update the highest priority pending item
    const result = await this.collection.findOneAndUpdate(
      { repoId, status: 'pending' },
      { $set: { status: 'claimed', claimedAt: new Date() } },
      { sort: { priority: -1, createdAt: 1 }, returnDocument: 'after' }
    );

    return result ? toWorkItem(result) : null;
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

    if (itemsToClaim.length === 0) return [];

    // Mark items as claimed
    const claimedAt = new Date();
    const ids = itemsToClaim.map(item => item.id);

    await this.collection.updateMany(byIds(ids), { $set: { status: 'claimed', claimedAt } });

    // Update the in-memory items
    for (const item of itemsToClaim) {
      item.status = 'claimed';
      item.claimedAt = claimedAt;
    }

    return itemsToClaim;
  }

  async complete(id: string, agentRunId: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          agentRunId,
        },
      }
    );
  }

  async fail(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
        },
      }
    );
  }

  async exists(
    repoId: string,
    agentType: AgentType,
    targetCommitId: string
  ): Promise<boolean> {
    // Find items that match agentType and are pending/claimed
    const docs = await this.collection
      .find({
        repoId,
        agentType,
        status: { $in: ['pending', 'claimed'] },
      })
      .toArray();

    const items = toWorkItems(docs);

    // Check if any item targets this commit
    for (const item of items) {
      if (getTargetCommitId(item) === targetCommitId) {
        return true;
      }
    }

    return false;
  }

  async getPendingKeys(repoId: string): Promise<Set<string>> {
    const docs = await this.collection
      .find({
        repoId,
        status: { $in: ['pending', 'claimed'] },
      })
      .toArray();

    const items = toWorkItems(docs);

    const keys = new Set<string>();
    for (const item of items) {
      const targetKey = getWorkTargetKey(item.target);
      const key = `${item.agentType}:${targetKey}`;
      keys.add(key);
    }

    return keys;
  }
}
