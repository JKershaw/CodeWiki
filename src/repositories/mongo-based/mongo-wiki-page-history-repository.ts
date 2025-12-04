import type { Collection, Db, Document } from 'mongodb';
import type { WikiPageHistoryRepository } from '../interfaces/wiki-page-history-repository.js';
import type { WikiPageHistory } from '../../domain/wiki-page-history.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoWikiPageHistoryRepository implements WikiPageHistoryRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('wiki-page-history');
  }

  async findById(id: string): Promise<WikiPageHistory | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<WikiPageHistory>(doc);
  }

  async findByPage(pageId: string): Promise<WikiPageHistory[]> {
    const docs = await this.collection
      .find({ pageId })
      .sort({ timestamp: -1 })
      .toArray();
    return toEntities<WikiPageHistory>(docs);
  }

  async findByWiki(wikiId: string): Promise<WikiPageHistory[]> {
    const docs = await this.collection
      .find({ wikiId })
      .sort({ timestamp: -1 })
      .toArray();
    return toEntities<WikiPageHistory>(docs);
  }

  async findByAgentRun(agentRunId: string): Promise<WikiPageHistory[]> {
    const docs = await this.collection
      .find({ agentRunId })
      .sort({ timestamp: -1 })
      .toArray();
    return toEntities<WikiPageHistory>(docs);
  }

  async findByTimeRange(wikiId: string, start: Date, end: Date): Promise<WikiPageHistory[]> {
    const docs = await this.collection
      .find({
        wikiId,
        timestamp: { $gte: start, $lte: end },
      })
      .sort({ timestamp: -1 })
      .toArray();
    return toEntities<WikiPageHistory>(docs);
  }

  async findByPagePath(wikiId: string, pagePath: string): Promise<WikiPageHistory[]> {
    const docs = await this.collection
      .find({ wikiId, pagePath })
      .sort({ timestamp: -1 })
      .toArray();
    return toEntities<WikiPageHistory>(docs);
  }

  async getLatestByPage(pageId: string): Promise<WikiPageHistory | null> {
    const doc = await this.collection
      .findOne({ pageId }, { sort: { timestamp: -1 } });
    return toEntity<WikiPageHistory>(doc);
  }

  async countByWiki(wikiId: string): Promise<number> {
    return await this.collection.countDocuments({ wikiId });
  }

  async save(history: WikiPageHistory): Promise<void> {
    const doc = toDocument(history);
    await this.collection.replaceOne(byId(history.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }

  async deleteByPage(pageId: string): Promise<void> {
    await this.collection.deleteMany({ pageId });
  }
}
