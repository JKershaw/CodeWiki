import type { ConflictRepository } from '../interfaces/conflict-repository.js';
import type { Conflict, ConflictStatus, ConflictType, ConflictResolution } from '../../domain/conflict.js';
import { FileStore } from './file-store.js';

export class FileConflictRepository implements ConflictRepository {
  private store: FileStore<Conflict>;

  constructor(baseDir: string) {
    this.store = new FileStore<Conflict>(baseDir, 'conflicts');
  }

  async findById(id: string): Promise<Conflict | null> {
    return this.store.get(id);
  }

  async findByWiki(wikiId: string, options?: {
    status?: ConflictStatus;
    type?: ConflictType;
  }): Promise<Conflict[]> {
    return this.store.find(c => {
      if (c.wikiId !== wikiId) return false;
      if (options?.status && c.status !== options.status) return false;
      if (options?.type && c.type !== options.type) return false;
      return true;
    });
  }

  async findOpen(wikiId: string): Promise<Conflict[]> {
    return this.store.find(c => c.wikiId === wikiId && c.status === 'open');
  }

  async findByPage(wikiId: string, pagePath: string): Promise<Conflict[]> {
    return this.store.find(c =>
      c.wikiId === wikiId && c.pagePathaffected === pagePath
    );
  }

  async countByStatus(wikiId: string): Promise<Record<ConflictStatus, number>> {
    const all = await this.store.find(c => c.wikiId === wikiId);
    const counts: Record<ConflictStatus, number> = {
      open: 0,
      'auto-resolved': 0,
      manual: 0,
      deferred: 0,
    };
    for (const conflict of all) {
      counts[conflict.status]++;
    }
    return counts;
  }

  async save(conflict: Conflict): Promise<void> {
    await this.store.set(conflict);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany(c => c.wikiId === wikiId);
  }

  async resolve(id: string, resolution: ConflictResolution): Promise<void> {
    const conflict = await this.store.get(id);
    if (conflict) {
      conflict.resolution = resolution;
      conflict.status = resolution.method === 'manual' ? 'manual' : 'auto-resolved';
      conflict.resolvedAt = new Date();
      await this.store.set(conflict);
    }
  }
}
