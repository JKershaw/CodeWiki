import type { Collection, Db, Document, Filter } from 'mongodb';
import type { QualityBenchmarkRepository } from '../interfaces/quality-benchmark-repository.js';
import type {
  QualityBenchmarkRun,
  QualityBenchmarkRunStatus,
  PageQualityResult,
  QualityBenchmarkSummary,
} from '../../domain/quality-benchmark.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoQualityBenchmarkRepository implements QualityBenchmarkRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('quality-benchmarks');
  }

  async findById(id: string): Promise<QualityBenchmarkRun | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<QualityBenchmarkRun>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { limit?: number; offset?: number; status?: QualityBenchmarkRunStatus }
  ): Promise<QualityBenchmarkRun[]> {
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

    return toEntities<QualityBenchmarkRun>(docs);
  }

  async findByWiki(
    wikiId: string,
    options?: { limit?: number; offset?: number; status?: QualityBenchmarkRunStatus }
  ): Promise<QualityBenchmarkRun[]> {
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

    return toEntities<QualityBenchmarkRun>(docs);
  }

  async findLatest(repoId: string, limit: number = 10): Promise<QualityBenchmarkRun[]> {
    const docs = await this.collection
      .find({ repoId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();

    return toEntities<QualityBenchmarkRun>(docs);
  }

  async findLatestByWiki(wikiId: string, limit: number = 10): Promise<QualityBenchmarkRun[]> {
    const docs = await this.collection
      .find({ wikiId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();

    return toEntities<QualityBenchmarkRun>(docs);
  }

  async findRunning(repoId: string): Promise<QualityBenchmarkRun | null> {
    const doc = await this.collection.findOne({ repoId, status: 'running' });
    return toEntity<QualityBenchmarkRun>(doc);
  }

  async findRunningByWiki(wikiId: string): Promise<QualityBenchmarkRun | null> {
    const doc = await this.collection.findOne({ wikiId, status: 'running' });
    return toEntity<QualityBenchmarkRun>(doc);
  }

  async save(run: QualityBenchmarkRun): Promise<void> {
    const doc = toDocument(run);
    await this.collection.replaceOne(byId(run.id), doc, { upsert: true });
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

  async complete(
    id: string,
    results: PageQualityResult[],
    summary: QualityBenchmarkSummary,
    totalCostUsd: number
  ): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'completed',
          results,
          summary,
          totalCostUsd,
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
}
