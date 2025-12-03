import type { Collection, Db, Document } from 'mongodb';
import type { RepoRepository } from '../interfaces/repo-repository.js';
import type { Repo, RepoStatus } from '../../domain/repo.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoRepoRepository implements RepoRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('repos');
  }

  async findById(id: string): Promise<Repo | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Repo>(doc);
  }

  async findByFullName(fullName: string): Promise<Repo | null> {
    const doc = await this.collection.findOne({ fullName });
    return toEntity<Repo>(doc);
  }

  async findByStatus(status: RepoStatus): Promise<Repo[]> {
    const docs = await this.collection.find({ status }).toArray();
    return toEntities<Repo>(docs);
  }

  async findAll(): Promise<Repo[]> {
    const docs = await this.collection.find({}).toArray();
    return toEntities<Repo>(docs);
  }

  async save(repo: Repo): Promise<void> {
    const doc = toDocument(repo);
    await this.collection.replaceOne(byId(repo.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async updateStatus(id: string, status: RepoStatus): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: { status } });
  }

  async updateLastProcessed(id: string, timestamp: Date): Promise<void> {
    await this.collection.updateOne(byId(id), { $set: { lastProcessedAt: timestamp } });
  }
}
