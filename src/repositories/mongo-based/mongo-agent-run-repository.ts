import type { Collection, Db, Document, Filter } from 'mongodb';
import type { AgentRunRepository } from '../interfaces/agent-run-repository.js';
import type {
  AgentRun,
  AgentType,
  AgentRunStatus,
  AgentResult,
  ToolMetrics,
} from '../../domain/agent-run.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoAgentRunRepository implements AgentRunRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('agent-runs');
  }

  async findById(id: string): Promise<AgentRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<AgentRun>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: {
      limit?: number;
      offset?: number;
      agentType?: AgentType;
      status?: AgentRunStatus;
    }
  ): Promise<AgentRun[]> {
    const filter: Filter<Document> = { repoId };

    if (options?.agentType) {
      filter.agentType = options.agentType;
    }
    if (options?.status) {
      filter.status = options.status;
    }

    const offset = options?.offset ?? 0;

    let cursor = this.collection
      .find(filter)
      .sort({ startedAt: -1 })
      .skip(offset);

    // Only apply limit if explicitly provided
    if (options?.limit !== undefined) {
      cursor = cursor.limit(options.limit);
    }

    const docs = await cursor.toArray();

    return toEntities<AgentRun>(docs);
  }

  async findByCommit(commitId: string): Promise<AgentRun[]> {
    const docs = await this.collection.find({ targetCommitId: commitId }).toArray();
    return toEntities<AgentRun>(docs);
  }

  async findRecentByType(
    repoId: string,
    agentType: AgentType,
    limit: number
  ): Promise<AgentRun[]> {
    const docs = await this.collection
      .find({ repoId, agentType })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();

    return toEntities<AgentRun>(docs);
  }

  async countByStatus(repoId: string): Promise<Record<AgentRunStatus, number>> {
    const pipeline = [
      { $match: { repoId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();

    const counts: Record<AgentRunStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };

    for (const result of results) {
      const status = result._id as AgentRunStatus;
      counts[status] = result.count;
    }

    return counts;
  }

  async calculateTotalCost(
    repoId: string,
    options?: { since?: Date; until?: Date }
  ): Promise<number> {
    const match: Filter<Document> = { repoId };

    if (options?.since || options?.until) {
      match.startedAt = {};
      if (options.since) {
        (match.startedAt as Record<string, Date>).$gte = options.since;
      }
      if (options.until) {
        (match.startedAt as Record<string, Date>).$lte = options.until;
      }
    }

    const pipeline = [
      { $match: match },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$costUsd', 0] } } } },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    return results[0]?.total ?? 0;
  }

  async save(run: AgentRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async updateStatus(id: string, status: AgentRunStatus): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: { status } });
  }

  async complete(
    id: string,
    result: AgentResult,
    durationMs: number,
    costUsd: number,
    toolMetrics?: ToolMetrics
  ): Promise<void> {
    const updates: Partial<AgentRun> = {
      status: 'completed',
      result,
      durationMs,
      costUsd,
      completedAt: new Date(),
    };
    if (toolMetrics) {
      updates.toolMetrics = toolMetrics;
    }
    await this.collection.updateOne(
      byId(id),
      {
        $set: updates,
      }
    );
  }

  async fail(id: string, error: string, durationMs: number): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'failed',
          error,
          durationMs,
          completedAt: new Date(),
        },
      }
    );
  }
}
