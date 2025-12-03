import type { Collection, Db, Document } from 'mongodb';
import type { UserRepository } from '../interfaces/user-repository.js';
import type { User, GitHubTokens } from '../../domain/user.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoUserRepository implements UserRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('users');
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<User>(doc);
  }

  async findByGitHubId(githubId: number): Promise<User | null> {
    const doc = await this.collection.findOne({ githubId });
    return toEntity<User>(doc);
  }

  async findByLogin(login: string): Promise<User | null> {
    const doc = await this.collection.findOne({ login });
    return toEntity<User>(doc);
  }

  async findAll(): Promise<User[]> {
    const docs = await this.collection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return toEntities<User>(docs);
  }

  async save(user: User): Promise<void> {
    const doc = toDocument(user);
    await this.collection.replaceOne(byId(user.id), doc, { upsert: true });
  }

  async updateTokens(id: string, tokens: GitHubTokens): Promise<void> {
    await this.collection.updateOne(byId(id), {
      $set: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.tokenExpiresAt,
        lastLoginAt: new Date(),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }
}
