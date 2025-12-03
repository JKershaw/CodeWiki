import type { Collection, Db, Document } from 'mongodb';
import type { IterationRepository } from '../interfaces/iteration-repository.js';
import type { Iteration } from '../../domain/iteration.js';
import type { AgentType } from '../../domain/agent-run.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoIterationRepository implements IterationRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('iterations');
  }

  async findById(id: string): Promise<Iteration | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Iteration>(doc);
  }

  async findByProcessingRun(processingRunId: string): Promise<Iteration[]> {
    const docs = await this.collection
      .find({ processingRunId })
      .sort({ iterationNumber: 1 })
      .toArray();
    return toEntities<Iteration>(docs);
  }

  async findRunning(processingRunId: string): Promise<Iteration | null> {
    const doc = await this.collection.findOne({
      processingRunId,
      status: 'running',
    });
    return toEntity<Iteration>(doc);
  }

  async findMostRecent(processingRunId: string): Promise<Iteration | null> {
    const docs = await this.collection
      .find({ processingRunId })
      .sort({ startedAt: -1 })
      .limit(1)
      .toArray();

    return docs.length > 0 ? toEntity<Iteration>(docs[0]!) : null;
  }

  async save(iteration: Iteration): Promise<void> {
    const doc = toDocument(iteration);
    await this.collection.replaceOne(byId(iteration.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByProcessingRun(processingRunId: string): Promise<void> {
    await this.collection.deleteMany({ processingRunId });
  }

  async updateWorkItem(
    id: string,
    updates: { workItemId: string; agentType: AgentType }
  ): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: updates });
  }

  async complete(
    id: string,
    result: {
      agentRunId: string;
      durationMs: number;
      costUsd: number;
      pagesCreated: number;
      pagesUpdated: number;
    }
  ): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          ...result,
        },
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

  async skip(id: string, reason: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'skipped',
          error: reason,
          completedAt: new Date(),
        },
      }
    );
  }
}
