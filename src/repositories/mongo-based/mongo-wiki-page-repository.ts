import type { Collection, Db, Document } from 'mongodb';
import type { WikiPageRepository } from '../interfaces/wiki-page-repository.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { toEntity, toEntities, toDocument, byId } from './mongo-utils.js';

export class MongoWikiPageRepository implements WikiPageRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('wiki-pages');
  }

  async findById(id: string): Promise<WikiPage | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<WikiPage>(doc);
  }

  async findByPath(wikiId: string, path: string): Promise<WikiPage | null> {
    const doc = await this.collection.findOne({ wikiId, path });
    return toEntity<WikiPage>(doc);
  }

  async findByWiki(wikiId: string): Promise<WikiPage[]> {
    const docs = await this.collection.find({ wikiId }).toArray();
    return toEntities<WikiPage>(docs);
  }

  async findLowConfidence(wikiId: string, threshold: number): Promise<WikiPage[]> {
    const docs = await this.collection
      .find({ wikiId, confidence: { $lt: threshold } })
      .toArray();
    return toEntities<WikiPage>(docs);
  }

  async findRecentlyUpdated(wikiId: string, since: Date): Promise<WikiPage[]> {
    const docs = await this.collection
      .find({ wikiId, updatedAt: { $gte: since } })
      .toArray();
    return toEntities<WikiPage>(docs);
  }

  async search(wikiId: string, query: string): Promise<WikiPage[]> {
    // Simple case-insensitive regex search on title and content
    const regex = new RegExp(query, 'i');
    const docs = await this.collection
      .find({
        wikiId,
        $or: [{ title: { $regex: regex } }, { content: { $regex: regex } }],
      })
      .toArray();
    return toEntities<WikiPage>(docs);
  }

  async save(page: WikiPage): Promise<void> {
    const doc = toDocument(page);
    await this.collection.replaceOne(byId(page.id), doc, { upsert: true });
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }

  async updateContent(
    id: string,
    updates: {
      content: string;
      title?: string;
      confidence?: number;
      sourceCommitId?: string;
      sourceAgentRunId?: string;
    }
  ): Promise<void> {
    const setFields: Record<string, unknown> = {
      content: updates.content,
      updatedAt: new Date(),
    };

    if (updates.title !== undefined) {
      setFields.title = updates.title;
    }
    if (updates.confidence !== undefined) {
      setFields.confidence = updates.confidence;
    }
    if (updates.sourceCommitId !== undefined) {
      setFields.sourceCommitId = updates.sourceCommitId;
    }
    if (updates.sourceAgentRunId !== undefined) {
      setFields.sourceAgentRunId = updates.sourceAgentRunId;
    }

    await this.collection.updateOne(byId(id), { $set: setFields });
  }

  async addBacklink(pageId: string, linkingPagePath: string): Promise<void> {
    await this.collection.updateOne(
      byId(pageId),
      { $addToSet: { backlinks: linkingPagePath } } as unknown as Document
    );
  }

  async removeBacklink(pageId: string, linkingPagePath: string): Promise<void> {
    await this.collection.updateOne(
      byId(pageId),
      { $pull: { backlinks: linkingPagePath } } as unknown as Document
    );
  }
}
