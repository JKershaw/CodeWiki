import type { Collection, Db, Document, Filter } from 'mongodb';
import type { OrchestratorRunRepository } from '../interfaces/orchestrator-run-repository.js';
import type { OrchestratorRun } from '../../domain/orchestrator-run.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoOrchestratorRunRepository implements OrchestratorRunRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('orchestrator-runs');
  }

  async findById(id: string): Promise<OrchestratorRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<OrchestratorRun>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { limit?: number; usedLLM?: boolean }
  ): Promise<OrchestratorRun[]> {
    const filter: Filter<Document> = { repoId };

    if (options?.usedLLM !== undefined) {
      filter.usedLLM = options.usedLLM;
    }

    const limit = options?.limit ?? 100;

    const docs = await this.collection
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return toEntities<OrchestratorRun>(docs);
  }

  async findRecent(repoId: string, since: Date): Promise<OrchestratorRun[]> {
    const docs = await this.collection
      .find({
        repoId,
        timestamp: { $gte: since },
      })
      .sort({ timestamp: -1 })
      .toArray();

    return toEntities<OrchestratorRun>(docs);
  }

  async save(run: OrchestratorRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
  }

  async deleteOlderThan(repoId: string, olderThan: Date): Promise<number> {
    const result = await this.collection.deleteMany({
      repoId,
      timestamp: { $lt: olderThan },
    });
    return result.deletedCount;
  }
}
