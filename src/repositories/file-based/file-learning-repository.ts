import type { LearningRepository } from '../interfaces/learning-repository.js';
import type { Learning, LearningType } from '../../domain/learning.js';
import { FileStore } from './file-store.js';

export class FileLearningRepository implements LearningRepository {
  private store: FileStore<Learning>;

  constructor(baseDir: string) {
    this.store = new FileStore<Learning>(baseDir, 'learnings');
  }

  async findById(id: string): Promise<Learning | null> {
    return this.store.get(id);
  }

  async findByRepo(repoId: string, options?: {
    type?: LearningType;
    incorporated?: boolean;
  }): Promise<Learning[]> {
    return this.store.find(l => {
      if (l.repoId !== repoId) return false;
      if (options?.type && l.type !== options.type) return false;
      if (options?.incorporated !== undefined && l.incorporated !== options.incorporated) return false;
      return true;
    });
  }

  async findUnincorporated(repoId: string): Promise<Learning[]> {
    return this.store.find(l => l.repoId === repoId && !l.incorporated);
  }

  async findHighImportance(repoId: string): Promise<Learning[]> {
    return this.store.find(l => l.repoId === repoId && l.importance === 'high');
  }

  async save(learning: Learning): Promise<void> {
    await this.store.set(learning);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByRepo(repoId: string): Promise<void> {
    await this.store.deleteMany(l => l.repoId === repoId);
  }

  async markIncorporated(id: string, incorporatedInto: string[]): Promise<void> {
    const learning = await this.store.get(id);
    if (learning) {
      learning.incorporated = true;
      learning.incorporatedInto = incorporatedInto;
      learning.incorporatedAt = new Date();
      await this.store.set(learning);
    }
  }
}
