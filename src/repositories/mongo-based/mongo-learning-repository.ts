import type { Collection, Db, Document, Filter } from 'mongodb';
import type { LearningRepository } from '../interfaces/learning-repository.js';
import type { Learning, LearningType } from '../../domain/learning.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoLearningRepository implements LearningRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('learnings');
  }

  async findById(id: string): Promise<Learning | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Learning>(doc);
  }

  async findByRepo(
    repoId: string,
    options?: { type?: LearningType; incorporated?: boolean }
  ): Promise<Learning[]> {
    const filter: Filter<Document> = { repoId };

    if (options?.type) {
      filter.type = options.type;
    }
    if (options?.incorporated !== undefined) {
      filter.incorporated = options.incorporated;
    }

    const docs = await this.collection.find(filter).toArray();
    return toEntities<Learning>(docs);
  }

  async findUnincorporated(repoId: string): Promise<Learning[]> {
    const docs = await this.collection
      .find({ repoId, incorporated: false })
      .toArray();
    return toEntities<Learning>(docs);
  }

  async findHighImportance(repoId: string): Promise<Learning[]> {
    const docs = await this.collection
      .find({ repoId, importance: 'high' })
      .toArray();
    return toEntities<Learning>(docs);
  }

  async save(learning: Learning): Promise<void> {
    const doc = toDocument(learning);
    await this.collection.replaceOne(byId(learning.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async markIncorporated(id: string, incorporatedInto: string[]): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          incorporated: true,
          incorporatedInto,
          incorporatedAt: new Date(),
        },
      }
    );
  }
}
