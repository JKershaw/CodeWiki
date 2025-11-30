import type { WikiRepository } from '../interfaces/wiki-repository.js';
import type { Wiki, WikiStatus } from '../../domain/wiki.js';
import { FileStore } from './file-store.js';

export class FileWikiRepository implements WikiRepository {
  private store: FileStore<Wiki>;

  constructor(baseDir: string) {
    this.store = new FileStore<Wiki>(baseDir, 'wikis');
  }

  async findById(id: string): Promise<Wiki | null> {
    return this.store.get(id);
  }

  async findBySlug(repoId: string, slug: string): Promise<Wiki | null> {
    return this.store.findOne(wiki => wiki.repoId === repoId && wiki.slug === slug);
  }

  async findByRepo(repoId: string): Promise<Wiki[]> {
    return this.store.find(wiki => wiki.repoId === repoId);
  }

  async findActive(repoId: string): Promise<Wiki | null> {
    return this.store.findOne(wiki => wiki.repoId === repoId && wiki.isActive);
  }

  async findByStatus(repoId: string, status: WikiStatus): Promise<Wiki[]> {
    return this.store.find(wiki => wiki.repoId === repoId && wiki.status === status);
  }

  async save(wiki: Wiki): Promise<void> {
    await this.store.set(wiki);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(wiki => wiki.repoId === repoId);
  }

  async setActive(id: string): Promise<void> {
    const wiki = await this.store.get(id);
    if (!wiki) return;

    // Deactivate all other wikis for this repo
    const repoWikis = await this.findByRepo(wiki.repoId);
    for (const w of repoWikis) {
      if (w.id !== id && w.isActive) {
        await this.store.update(w.id, { isActive: false, updatedAt: new Date() });
      }
    }

    // Activate the target wiki
    await this.store.update(id, { isActive: true, updatedAt: new Date() });
  }

  async updateStatus(id: string, status: WikiStatus): Promise<void> {
    await this.store.update(id, { status, updatedAt: new Date() });
  }

  async updateLastProcessedCommit(id: string, sha: string): Promise<void> {
    await this.store.update(id, { lastProcessedCommitSha: sha, updatedAt: new Date() });
  }

  async incrementIterations(id: string, count: number): Promise<void> {
    const wiki = await this.store.get(id);
    if (!wiki) return;

    const currentTotal = wiki.totalIterations ?? 0;
    await this.store.update(id, {
      totalIterations: currentTotal + count,
      updatedAt: new Date(),
    });
  }
}
