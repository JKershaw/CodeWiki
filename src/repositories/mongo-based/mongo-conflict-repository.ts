import type { Collection, Db, Document, Filter } from 'mongodb';
import type { ConflictRepository } from '../interfaces/conflict-repository.js';
import type {
  Conflict,
  ConflictStatus,
  ConflictType,
  ConflictResolution,
} from '../../domain/conflict.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoConflictRepository implements ConflictRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('conflicts');
  }

  async findById(id: string): Promise<Conflict | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Conflict>(doc);
  }

  async findByWiki(
    wikiId: string,
    options?: { status?: ConflictStatus; type?: ConflictType }
  ): Promise<Conflict[]> {
    const filter: Filter<Document> = { wikiId };

    if (options?.status) {
      filter.status = options.status;
    }
    if (options?.type) {
      filter.type = options.type;
    }

    const docs = await this.collection.find(filter).toArray();
    return toEntities<Conflict>(docs);
  }

  async findOpen(wikiId: string): Promise<Conflict[]> {
    const docs = await this.collection.find({ wikiId, status: 'open' }).toArray();
    return toEntities<Conflict>(docs);
  }

  async findByPage(wikiId: string, pagePath: string): Promise<Conflict[]> {
    const docs = await this.collection
      .find({ wikiId, pagePathaffected: pagePath })
      .toArray();
    return toEntities<Conflict>(docs);
  }

  async countByStatus(wikiId: string): Promise<Record<ConflictStatus, number>> {
    const pipeline = [
      { $match: { wikiId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();

    const counts: Record<ConflictStatus, number> = {
      'open': 0,
      'auto-resolved': 0,
      'manual': 0,
      'deferred': 0,
    };

    for (const result of results) {
      const status = result._id as ConflictStatus;
      counts[status] = result.count;
    }

    return counts;
  }

  async save(conflict: Conflict): Promise<void> {
    const doc = toDocument(conflict);
    await this.collection.replaceOne(byId(conflict.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }

  async resolve(id: string, resolution: ConflictResolution): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'manual',
          resolution,
          resolvedAt: new Date(),
        },
      }
    );
  }
}
