import type { Collection, Db, Document, Filter } from 'mongodb';
import type { AutoBenchmarkRepository } from '../interfaces/auto-benchmark-repository.js';
import type { AutoBenchmarkRun, AutoBenchmarkStatus, AutoBenchmarkPhase } from '../../domain/auto-benchmark.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoAutoBenchmarkRepository implements AutoBenchmarkRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('auto_benchmarks');
  }

  async findById(id: string): Promise<AutoBenchmarkRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<AutoBenchmarkRun>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { limit?: number; offset?: number; status?: AutoBenchmarkStatus }
  ): Promise<AutoBenchmarkRun[]> {
    const filter: Filter<Document> = { repoId };

    if (options?.status) {
      filter.status = options.status;
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const docs = await this.collection
      .find(filter)
      .sort({ startedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return toEntities<AutoBenchmarkRun>(docs);
  }

  async findByWiki(
    wikiId: string,
    options?: { limit?: number; offset?: number; status?: AutoBenchmarkStatus }
  ): Promise<AutoBenchmarkRun[]> {
    const filter: Filter<Document> = { wikiId };

    if (options?.status) {
      filter.status = options.status;
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const docs = await this.collection
      .find(filter)
      .sort({ startedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return toEntities<AutoBenchmarkRun>(docs);
  }

  async findRunning(repoId: string): Promise<AutoBenchmarkRun | null> {
    const doc = await this.collection.findOne({ repoId, status: 'running' });
    return toEntity<AutoBenchmarkRun>(doc);
  }

  async findRunningByWiki(wikiId: string): Promise<AutoBenchmarkRun | null> {
    const doc = await this.collection.findOne({ wikiId, status: 'running' });
    return toEntity<AutoBenchmarkRun>(doc);
  }

  async findAllRunning(): Promise<AutoBenchmarkRun[]> {
    const docs = await this.collection
      .find({ status: 'running' })
      .sort({ startedAt: -1 })
      .toArray();

    return toEntities<AutoBenchmarkRun>(docs);
  }

  async save(run: AutoBenchmarkRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
  }

  async updateProgress(id: string, cycle: number, phase: AutoBenchmarkPhase): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          currentCycle: cycle,
          currentPhase: phase,
        },
      }
    );
  }

  async complete(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'completed',
          currentPhase: 'complete',
          completedAt: new Date(),
        },
      }
    );
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

  async stop(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'stopped',
          completedAt: new Date(),
        },
      }
    );
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }
}
