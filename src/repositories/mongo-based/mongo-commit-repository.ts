import type { Collection, Db, Document } from 'mongodb';
import type { CommitRepository } from '../interfaces/commit-repository.js';
import type { Commit, AgentProcessingRecord } from '../../domain/commit.js';
import { toEntity, toEntities, toDocument, byId, replaceOp } from './mongo-utils.js';

export class MongoCommitRepository implements CommitRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('commits');
  }

  async findById(id: string): Promise<Commit | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Commit>(doc);
  }

  async findBySha(repoId: string, sha: string): Promise<Commit | null> {
    const doc = await this.collection.findOne({ repoId, sha });
    return toEntity<Commit>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Commit[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const docs = await this.collection
      .find({ repoId })
      .sort({ committedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return toEntities<Commit>(docs);
  }

  async findUnprocessedByAgent(repoId: string, agentType: string): Promise<Commit[]> {
    // Find commits where processedBy array doesn't contain an entry with the given agentType
    // Using $not with $elemMatch to find commits where NO element has the agentType
    const docs = await this.collection
      .find({
        repoId,
        processedBy: {
          $not: {
            $elemMatch: { agentType },
          },
        },
      })
      .sort({ committedAt: -1 })
      .toArray();

    return toEntities<Commit>(docs);
  }

  async findByDateRange(repoId: string, start: Date, end: Date): Promise<Commit[]> {
    const docs = await this.collection
      .find({
        repoId,
        committedAt: { $gte: start, $lte: end },
      })
      .sort({ committedAt: -1 })
      .toArray();

    return toEntities<Commit>(docs);
  }

  async countByRepo(repoId: string): Promise<number> {
    return this.collection.countDocuments({ repoId });
  }

  async countProcessedByAgent(repoId: string, agentType: string): Promise<number> {
    // Count commits where processedBy array contains an entry with the given agentType
    return this.collection.countDocuments({
      repoId,
      'processedBy.agentType': agentType,
    });
  }

  async save(commit: Commit): Promise<void> {
    const doc = toDocument(commit);
    await this.collection.replaceOne(byId(commit.id), doc, { upsert: true });
  }

  async saveMany(commits: Commit[]): Promise<void> {
    if (commits.length === 0) return;

    const operations = commits.map(commit => replaceOp(commit));
    await this.collection.bulkWrite(operations);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async addProcessingRecord(commitId: string, record: AgentProcessingRecord): Promise<void> {
    // Push the record to the processedBy array
    // First remove any existing record for this agent type to avoid duplicates
    await this.collection.updateOne(
      byId(commitId),
      { $pull: { processedBy: { agentType: record.agentType } } } as any
    );
    await this.collection.updateOne(
      byId(commitId),
      { $push: { processedBy: record } } as any
    );
  }
}
