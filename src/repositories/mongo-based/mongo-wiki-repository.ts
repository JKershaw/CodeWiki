import type { Collection, Db, Document, Filter } from 'mongodb';
import type { WikiRepository } from '../interfaces/wiki-repository.js';
import type { Wiki, WikiStatus } from '../../domain/wiki.js';
import { toEntity, toEntities, toDocument, byId, idNotEqual } from './mongo-utils.js';

export class MongoWikiRepository implements WikiRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('wikis');
  }

  async findById(id: string): Promise<Wiki | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Wiki>(doc);
  }

  async findBySlug(repoId: string, slug: string): Promise<Wiki | null> {
    const doc = await this.collection.findOne({ repoId, slug });
    return toEntity<Wiki>(doc);
  }

  async findByRepo(repoId: string): Promise<Wiki[]> {
    const docs = await this.collection.find({ repoId }).toArray();
    return toEntities<Wiki>(docs);
  }

  async findActive(repoId: string): Promise<Wiki | null> {
    const doc = await this.collection.findOne({ repoId, isActive: true });
    return toEntity<Wiki>(doc);
  }

  async findByStatus(repoId: string, status: WikiStatus): Promise<Wiki[]> {
    const docs = await this.collection.find({ repoId, status }).toArray();
    return toEntities<Wiki>(docs);
  }

  async save(wiki: Wiki): Promise<void> {
    const doc = toDocument(wiki);
    await this.collection.replaceOne(byId(wiki.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.collection.deleteMany({ repoId });
  }

  async setActive(id: string): Promise<void> {
    const wiki = await this.findById(id);
    if (!wiki) return;

    // Deactivate all other wikis for this repo
    await this.collection.updateMany(
      { repoId: wiki.repoId, ...idNotEqual(id) } as Filter<Document>,
      { $set: { isActive: false, updatedAt: new Date() } }
    );

    // Activate the target wiki
    await this.collection.updateOne(byId(id), { $set: { isActive: true, updatedAt: new Date() } });
  }

  async updateStatus(id: string, status: WikiStatus): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: { status, updatedAt: new Date() } });
  }

  async updateLastProcessedCommit(id: string, sha: string): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: { lastProcessedCommitSha: sha, updatedAt: new Date() } });
  }

  async incrementIterations(id: string, count: number): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $inc: { totalIterations: count },
        $set: { updatedAt: new Date() },
      }
    );
  }
}
