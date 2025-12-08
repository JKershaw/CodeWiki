import type { Collection, Db, Document } from 'mongodb';
import type { EditRequestRepository } from '../interfaces/edit-request-repository.js';
import type { EditRequest, EditRequestStatus } from '../../domain/edit-request.js';
import { toEntity, toEntities, toDocument, byId, replaceOp } from './mongo-utils.js';

export class MongoEditRequestRepository implements EditRequestRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('edit-requests');
  }

  async findById(id: string): Promise<EditRequest | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<EditRequest>(doc);
  }

  async findPending(wikiId: string): Promise<EditRequest[]> {
    const docs = await this.collection
      .find({ wikiId, status: 'pending' })
      .sort({ 'source.commitTimestamp': 1 })
      .toArray();
    return toEntities<EditRequest>(docs);
  }

  async findByPagePath(wikiId: string, pagePath: string): Promise<EditRequest[]> {
    const docs = await this.collection.find({ wikiId, targetPagePath: pagePath }).toArray();
    return toEntities<EditRequest>(docs);
  }

  async findByCommit(repoId: string, commitSha: string): Promise<EditRequest[]> {
    const docs = await this.collection.find({ repoId, 'source.type': 'commit', 'source.commitSha': commitSha }).toArray();
    return toEntities<EditRequest>(docs);
  }

  async findByAgentRun(agentRunId: string): Promise<EditRequest[]> {
    const docs = await this.collection.find({ sourceAgentRunId: agentRunId }).toArray();
    return toEntities<EditRequest>(docs);
  }

  async findByStatus(wikiId: string, status: EditRequestStatus): Promise<EditRequest[]> {
    const docs = await this.collection.find({ wikiId, status }).toArray();
    return toEntities<EditRequest>(docs);
  }

  async countPending(wikiId: string): Promise<number> {
    return this.collection.countDocuments({ wikiId, status: 'pending' });
  }

  async hasPendingForPage(wikiId: string, pagePath: string): Promise<boolean> {
    const count = await this.collection.countDocuments({
      wikiId,
      targetPagePath: pagePath,
      status: 'pending',
    });
    return count > 0;
  }

  async save(editRequest: EditRequest): Promise<void> {
    const doc = toDocument(editRequest);
    await this.collection.replaceOne(byId(editRequest.id), doc, { upsert: true });
  }

  async saveMany(editRequests: EditRequest[]): Promise<void> {
    if (editRequests.length === 0) return;

    const operations = editRequests.map(req => replaceOp(req));
    await this.collection.bulkWrite(operations);
  }

  async markProcessed(
    id: string,
    status: EditRequestStatus,
    processingNotes: string,
    processedByAgentRunId: string
  ): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status,
          processingNotes,
          processedByAgentRunId,
          processedAt: new Date(),
        },
      }
    );
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }

  async deleteByAgentRun(agentRunId: string): Promise<void> {
    await this.collection.deleteMany({ sourceAgentRunId: agentRunId });
  }

  async getOldestPendingTimestamp(wikiId: string): Promise<Date | null> {
    const doc = await this.collection
      .find({ wikiId, status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(1)
      .toArray();

    if (doc.length === 0) return null;

    const firstDoc = doc[0];
    if (!firstDoc) return null;

    const createdAt = firstDoc.createdAt;
    return createdAt instanceof Date ? createdAt : new Date(createdAt as string);
  }
}
