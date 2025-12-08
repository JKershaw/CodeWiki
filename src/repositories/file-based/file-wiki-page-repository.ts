import type { WikiPageRepository } from '../interfaces/wiki-page-repository.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<WikiPage>({
  required: ['createdAt', 'updatedAt'],
  optional: [],
});

export class FileWikiPageRepository implements WikiPageRepository {
  private store: FileStore<WikiPage>;

  constructor(baseDir: string) {
    this.store = new FileStore<WikiPage>(baseDir, 'wiki-pages');
  }

  async findById(id: string): Promise<WikiPage | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByPath(wikiId: string, path: string): Promise<WikiPage | null> {
    const result = await this.store.findOne(p => p.wikiId === wikiId && p.path === path);
    return result ? hydrateDates(result) : null;
  }

  async findByWiki(wikiId: string): Promise<WikiPage[]> {
    const results = await this.store.find(p => p.wikiId === wikiId);
    return results.map(hydrateDates);
  }

  async findLowConfidence(wikiId: string, threshold: number): Promise<WikiPage[]> {
    const results = await this.store.find(p => p.wikiId === wikiId && p.confidence < threshold);
    return results.map(hydrateDates);
  }

  async findRecentlyUpdated(wikiId: string, since: Date): Promise<WikiPage[]> {
    const sinceTime = getTime(since);
    const results = await this.store.find(p => p.wikiId === wikiId && getTime(p.updatedAt) >= sinceTime);
    return results.map(hydrateDates);
  }

  async search(wikiId: string, query: string): Promise<WikiPage[]> {
    const lowerQuery = query.toLowerCase();
    const results = await this.store.find(p =>
      p.wikiId === wikiId &&
      (p.title.toLowerCase().includes(lowerQuery) ||
       p.content.toLowerCase().includes(lowerQuery))
    );
    return results.map(hydrateDates);
  }

  async save(page: WikiPage): Promise<void> {
    await this.store.set(page);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany(p => p.wikiId === wikiId);
  }

  async updateContent(id: string, updates: {
    content: string;
    title?: string;
    confidence?: number;
    sourceCommitId?: string;
    sourceAgentRunId?: string;
  }): Promise<void> {
    const page = await this.store.get(id);
    if (page) {
      page.content = updates.content;
      page.updatedAt = new Date();
      if (updates.title !== undefined) {
        page.title = updates.title;
      }
      if (updates.confidence !== undefined) {
        page.confidence = updates.confidence;
      }
      if (updates.sourceCommitId && !page.sourceCommits.includes(updates.sourceCommitId)) {
        page.sourceCommits.push(updates.sourceCommitId);
      }
      // Initialize sourceAgentRunIds if it doesn't exist (for backwards compatibility)
      if (!page.sourceAgentRunIds) {
        page.sourceAgentRunIds = [];
      }
      if (updates.sourceAgentRunId && !page.sourceAgentRunIds.includes(updates.sourceAgentRunId)) {
        page.sourceAgentRunIds.push(updates.sourceAgentRunId);
      }
      await this.store.set(page);
    }
  }

  async addBacklink(pageId: string, linkingPagePath: string): Promise<void> {
    const page = await this.store.get(pageId);
    if (page && !page.backlinks.includes(linkingPagePath)) {
      page.backlinks.push(linkingPagePath);
      await this.store.set(page);
    }
  }

  async removeBacklink(pageId: string, linkingPagePath: string): Promise<void> {
    const page = await this.store.get(pageId);
    if (page) {
      page.backlinks = page.backlinks.filter(l => l !== linkingPagePath);
      await this.store.set(page);
    }
  }

  async updateLinks(pageId: string, links: string[]): Promise<void> {
    const page = await this.store.get(pageId);
    if (page) {
      page.links = links;
      await this.store.set(page);
    }
  }
}
