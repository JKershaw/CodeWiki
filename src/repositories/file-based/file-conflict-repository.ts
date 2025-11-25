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

  async findByRepo(repoId: string, options?: {
    status?: ConflictStatus;
    type?: ConflictType;
  }): Promise<Conflict[]> {
    return this.store.find(c => {
      if (c.repoId !== repoId) return false;
      if (options?.status && c.status !== options.status) return false;
      if (options?.type && c.type !== options.type) return false;
      return true;
    });
  }

  async findOpen(repoId: string): Promise<Conflict[]> {
    return this.store.find(c => c.repoId === repoId && c.status === 'open');
  }

  async findByPage(repoId: string, pagePath: string): Promise<Conflict[]> {
    return this.store.find(c =>
      c.repoId === repoId && c.pagePathaffected === pagePath
    );
  }

  async countByStatus(repoId: string): Promise<Record<ConflictStatus, number>> {
    const all = await this.store.find(c => c.repoId === repoId);
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

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(c => c.repoId === repoId);
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
