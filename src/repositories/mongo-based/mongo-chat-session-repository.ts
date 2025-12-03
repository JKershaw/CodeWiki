import type { Collection, Db, Document } from 'mongodb';
import type { ChatSessionRepository } from '../interfaces/chat-session-repository.js';
import type { ChatSession, ChatMessage } from '../../domain/chat-session.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoChatSessionRepository implements ChatSessionRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('chat-sessions');
  }

  async findById(id: string): Promise<ChatSession | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<ChatSession>(doc);
  }

  async findByRun(selfImprovementRunId: string): Promise<ChatSession[]> {
    const docs = await this.collection
      .find({ selfImprovementRunId })
      .sort({ createdAt: -1 })
      .toArray();
    return toEntities<ChatSession>(docs);
  }

  async findByRepo(repoId: string): Promise<ChatSession[]> {
    const docs = await this.collection
      .find({ repoId })
      .sort({ createdAt: -1 })
      .toArray();
    return toEntities<ChatSession>(docs);
  }

  async findActive(repoId: string): Promise<ChatSession[]> {
    const docs = await this.collection
      .find({ repoId, status: 'active' })
      .sort({ createdAt: -1 })
      .toArray();
    return toEntities<ChatSession>(docs);
  }

  async save(session: ChatSession): Promise<void> {
    const doc = toDocument(session);
    await this.collection.replaceOne(byId(session.id), doc, { upsert: true });
  }

  async addMessage(sessionId: string, message: ChatMessage, costUsd: number = 0): Promise<void> {
    await this.collection.updateOne(byId(sessionId), {
      $push: { messages: message },
      $set: { updatedAt: new Date() },
      $inc: { totalCostUsd: costUsd },
    } as unknown as Document);
  }

  async close(sessionId: string): Promise<void> {
    await this.collection.updateOne(
      byId(sessionId),
      {
        $set: {
          status: 'closed',
          updatedAt: new Date(),
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

  async deleteByRun(selfImprovementRunId: string): Promise<void> {
    await this.collection.deleteMany({ selfImprovementRunId });
  }
}
