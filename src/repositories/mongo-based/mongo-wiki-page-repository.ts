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
      category?: string;
      categoryConfidence?: number;
      filesAccessed?: string[];
      filesReferenced?: string[];
      targetPaths?: string[];
    }
  ): Promise<void> {
    const setFields: Record<string, unknown> = {
      content: updates.content,
      updatedAt: new Date(),
    };
    const addToSetFields: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      setFields.title = updates.title;
    }
    if (updates.confidence !== undefined) {
      setFields.confidence = updates.confidence;
    }
    if (updates.sourceCommitId !== undefined) {
      // Use $addToSet for sourceCommits array
      addToSetFields.sourceCommits = updates.sourceCommitId;
    }
    if (updates.sourceAgentRunId !== undefined) {
      // Use $addToSet for sourceAgentRunIds array
      addToSetFields.sourceAgentRunIds = updates.sourceAgentRunId;
    }
    if (updates.category !== undefined) {
      setFields.category = updates.category;
    }
    if (updates.categoryConfidence !== undefined) {
      setFields.categoryConfidence = updates.categoryConfidence;
    }
    // filesReferenced is replaced (based on current content)
    if (updates.filesReferenced !== undefined) {
      setFields.filesReferenced = updates.filesReferenced;
    }
    // filesAccessed and targetPaths are accumulated
    if (updates.filesAccessed) {
      addToSetFields.filesAccessed = { $each: updates.filesAccessed };
    }
    if (updates.targetPaths) {
      addToSetFields.targetPaths = { $each: updates.targetPaths };
    }

    const updateDoc: Record<string, unknown> = { $set: setFields };
    if (Object.keys(addToSetFields).length > 0) {
      updateDoc.$addToSet = addToSetFields;
    }

    await this.collection.updateOne(byId(id), updateDoc as Document);
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

  async updateLinks(pageId: string, links: string[]): Promise<void> {
    await this.collection.updateOne(
      byId(pageId),
      { $set: { links } }
    );
  }
}
