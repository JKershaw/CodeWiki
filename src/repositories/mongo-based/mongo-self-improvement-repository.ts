import type { Collection, Db, Document } from 'mongodb';
import type { SelfImprovementRepository } from '../interfaces/self-improvement-repository.js';
import type { SelfImprovementRun, AnalysisTrace } from '../../domain/self-improvement.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoSelfImprovementRepository implements SelfImprovementRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('self-improvements');
  }

  async findById(id: string): Promise<SelfImprovementRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<SelfImprovementRun>(doc);
  }

  async findByRepo(repoId: string): Promise<SelfImprovementRun[]> {
    const docs = await this.collection
      .find({ repoId })
      .sort({ startedAt: -1 })
      .toArray();
    return toEntities<SelfImprovementRun>(docs);
  }

  async findLatest(repoId: string, limit: number = 10): Promise<SelfImprovementRun[]> {
    const docs = await this.collection
      .find({ repoId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();
    return toEntities<SelfImprovementRun>(docs);
  }

  async findRunning(repoId: string): Promise<SelfImprovementRun | null> {
    const doc = await this.collection.findOne({ repoId, status: 'running' });
    return toEntity<SelfImprovementRun>(doc);
  }

  async save(run: SelfImprovementRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async complete(
    id: string,
    report: string,
    costUsd: number,
    analysisTrace?: AnalysisTrace
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status: 'completed',
      report,
      costUsd,
      completedAt: new Date(),
    };

    if (analysisTrace) {
      updates.analysisTrace = analysisTrace;
    }

    await this.collection.updateOne(byId(id), { $set: updates });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'failed',
          error,
          completedAt: new Date(),
        },
      }
    );
  }
}
