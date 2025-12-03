import type { EditRequestRepository } from '../interfaces/edit-request-repository.js';
import type { EditRequest, EditRequestStatus } from '../../domain/edit-request.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<EditRequest>({
  required: ['sourceCommitTimestamp', 'createdAt'],
  optional: ['processedAt'],
});

export class FileEditRequestRepository implements EditRequestRepository {
  private store: FileStore<EditRequest>;

  constructor(baseDir: string) {
    this.store = new FileStore<EditRequest>(baseDir, 'edit-requests');
  }

  async findById(id: string): Promise<EditRequest | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findPending(wikiId: string): Promise<EditRequest[]> {
    let results = await this.store.find(
      (er) => er.wikiId === wikiId && er.status === 'pending'
    );

    results = results.map(hydrateDates);

    // Sort by commit timestamp (oldest first) to process in chronological order
    results.sort(
      (a, b) =>
        getTime(a.sourceCommitTimestamp) -
        getTime(b.sourceCommitTimestamp)
    );

    return results;
  }

  async findByPagePath(wikiId: string, pagePath: string): Promise<EditRequest[]> {
    const results = await this.store.find(
      (er) => er.wikiId === wikiId && er.targetPagePath === pagePath
    );
    return results.map(hydrateDates);
  }

  async findByCommit(repoId: string, commitSha: string): Promise<EditRequest[]> {
    const results = await this.store.find(
      (er) => er.repoId === repoId && er.sourceCommitSha === commitSha
    );
    return results.map(hydrateDates);
  }

  async findByAgentRun(agentRunId: string): Promise<EditRequest[]> {
    const results = await this.store.find(
      (er) => er.sourceAgentRunId === agentRunId
    );
    return results.map(hydrateDates);
  }

  async findByStatus(
    wikiId: string,
    status: EditRequestStatus
  ): Promise<EditRequest[]> {
    let results = await this.store.find(
      (er) => er.wikiId === wikiId && er.status === status
    );

    results = results.map(hydrateDates);

    // Sort by commit timestamp
    results.sort(
      (a, b) =>
        getTime(a.sourceCommitTimestamp) -
        getTime(b.sourceCommitTimestamp)
    );

    return results;
  }

  async countPending(wikiId: string): Promise<number> {
    const pending = await this.store.find(
      (er) => er.wikiId === wikiId && er.status === 'pending'
    );
    return pending.length;
  }

  async hasPendingForPage(wikiId: string, pagePath: string): Promise<boolean> {
    const pending = await this.store.findOne(
      (er) =>
        er.wikiId === wikiId &&
        er.targetPagePath === pagePath &&
        er.status === 'pending'
    );
    return pending !== null;
  }

  async save(editRequest: EditRequest): Promise<void> {
    await this.store.set(editRequest);
  }

  async saveMany(editRequests: EditRequest[]): Promise<void> {
    await this.store.setMany(editRequests);
  }

  async markProcessed(
    id: string,
    status: EditRequestStatus,
    processingNotes: string,
    processedByAgentRunId: string
  ): Promise<void> {
    await this.store.update(id, {
      status,
      processingNotes,
      processedByAgentRunId,
      processedAt: new Date(),
    } as Partial<EditRequest>);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany((er) => er.wikiId === wikiId);
  }

  async deleteByAgentRun(agentRunId: string): Promise<void> {
    await this.store.deleteMany((er) => er.sourceAgentRunId === agentRunId);
  }

  async getOldestPendingTimestamp(wikiId: string): Promise<Date | null> {
    const pending = await this.findPending(wikiId);
    if (pending.length === 0) {
      return null;
    }
    // Already sorted by timestamp, so first is oldest
    return pending[0]!.sourceCommitTimestamp;
  }

}
