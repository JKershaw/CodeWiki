import type { WikiPageHistoryRepository } from '../interfaces/wiki-page-history-repository.js';
import type { WikiPageHistory } from '../../domain/wiki-page-history.js';
import { createDateNormalizer } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<WikiPageHistory>({
  required: ['timestamp'],
  optional: [],
});

/**
 * Sort history records by timestamp descending, with sequenceNumber as tiebreaker.
 * When timestamps are equal (same millisecond), higher sequence numbers come first.
 */
function sortByTimestampAndSequence(a: WikiPageHistory, b: WikiPageHistory): number {
  const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  // When timestamps are equal, use sequence number (higher = more recent)
  return (b.sequenceNumber ?? 0) - (a.sequenceNumber ?? 0);
}

export class FileWikiPageHistoryRepository implements WikiPageHistoryRepository {
  private store: FileStore<WikiPageHistory>;

  constructor(baseDir: string) {
    this.store = new FileStore<WikiPageHistory>(baseDir, 'wiki-page-history');
  }

  async findById(id: string): Promise<WikiPageHistory | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByPage(pageId: string): Promise<WikiPageHistory[]> {
    const results = await this.store.find(h => h.pageId === pageId);
    return results
      .map(hydrateDates)
      .sort(sortByTimestampAndSequence);
  }

  async findByWiki(wikiId: string): Promise<WikiPageHistory[]> {
    const results = await this.store.find(h => h.wikiId === wikiId);
    return results
      .map(hydrateDates)
      .sort(sortByTimestampAndSequence);
  }

  async findByAgentRun(agentRunId: string): Promise<WikiPageHistory[]> {
    const results = await this.store.find(h => h.agentRunId === agentRunId);
    return results
      .map(hydrateDates)
      .sort(sortByTimestampAndSequence);
  }

  async findByTimeRange(wikiId: string, start: Date, end: Date): Promise<WikiPageHistory[]> {
    const results = await this.store.find(h => {
      if (h.wikiId !== wikiId) return false;
      const timestamp = new Date(h.timestamp);
      return timestamp >= start && timestamp <= end;
    });
    return results
      .map(hydrateDates)
      .sort(sortByTimestampAndSequence);
  }

  async findByPagePath(wikiId: string, pagePath: string): Promise<WikiPageHistory[]> {
    const results = await this.store.find(h =>
      h.wikiId === wikiId && h.pagePath === pagePath
    );
    return results
      .map(hydrateDates)
      .sort(sortByTimestampAndSequence);
  }

  async getLatestByPage(pageId: string): Promise<WikiPageHistory | null> {
    const results = await this.findByPage(pageId);
    return results.length > 0 ? results[0]! : null;
  }

  async countByWiki(wikiId: string): Promise<number> {
    const results = await this.store.find(h => h.wikiId === wikiId);
    return results.length;
  }

  async getNextSequenceNumber(wikiId: string): Promise<number> {
    const results = await this.store.find(h => h.wikiId === wikiId);
    if (results.length === 0) {
      return 1;
    }
    const maxSeq = Math.max(...results.map(h => h.sequenceNumber ?? 0));
    return maxSeq + 1;
  }

  async save(history: WikiPageHistory): Promise<void> {
    await this.store.set(history);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany(h => h.wikiId === wikiId);
  }

  async deleteByPage(pageId: string): Promise<void> {
    await this.store.deleteMany(h => h.pageId === pageId);
  }
}
