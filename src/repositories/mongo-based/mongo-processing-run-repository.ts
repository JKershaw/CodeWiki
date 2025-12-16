import type { Collection, Db, Document, Filter } from 'mongodb';
import type { ProcessingRunRepository } from '../interfaces/processing-run-repository.js';
import type { ProcessingRun, ProcessingRunStatus } from '../../domain/processing-run.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoProcessingRunRepository implements ProcessingRunRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('processing-runs');
  }

  async findById(id: string): Promise<ProcessingRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<ProcessingRun>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { limit?: number; offset?: number; status?: ProcessingRunStatus }
  ): Promise<ProcessingRun[]> {
    const filter: Filter<Document> = { repoId };

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

    return toEntities<ProcessingRun>(docs);
  }

  async findActive(repoId: string): Promise<ProcessingRun | null> {
    const doc = await this.collection.findOne({
      repoId,
      status: { $in: ['running', 'stopping'] },
    });
    return toEntity<ProcessingRun>(doc);
  }

  async findMostRecent(repoId: string): Promise<ProcessingRun | null> {
    const docs = await this.collection
      .find({ repoId })
      .sort({ startedAt: -1 })
      .limit(1)
      .toArray();

    return docs.length > 0 ? toEntity<ProcessingRun>(docs[0]!) : null;
  }

  async save(run: ProcessingRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async updateProgress(
    id: string,
    updates: {
      completedIterations: number;
      successfulIterations: number;
      failedIterations: number;
      totalCostUsd: number;
      wikiPagesCreated: number;
      wikiPagesUpdated: number;
      duplicatesFiltered?: number;
    }
  ): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: updates });
  }

  async complete(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      { $set: { status: 'completed', completedAt: new Date() } }
    );
  }

  async fail(id: string, error: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      { $set: { status: 'failed', error, completedAt: new Date() } }
    );
  }

  async stop(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      { $set: { status: 'stopped', completedAt: new Date() } }
    );
  }

  async requestStop(id: string): Promise<void> {
    const run = await this.findById(id);
    if (!run) return;

    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'stopping',
          totalIterations: run.completedIterations,
        },
      }
    );
  }

  async confirmStop(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      { $set: { status: 'stopped', completedAt: new Date() } }
    );
  }
}
