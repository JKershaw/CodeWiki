import type { LearningRepository } from '../interfaces/learning-repository.js';
import type { Learning, LearningType } from '../../domain/learning.js';
import { createDateNormalizer } from '../../domain/date-utils.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<Learning>({
  required: ['createdAt'],
  optional: ['incorporatedAt'],
});

export class FileLearningRepository implements LearningRepository {
  private store: FileStore<Learning>;

  constructor(baseDir: string) {
    this.store = new FileStore<Learning>(baseDir, 'learnings');
  }

  async findById(id: string): Promise<Learning | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByRepo(repoId: string, options?: {
    type?: LearningType;
    incorporated?: boolean;
  }): Promise<Learning[]> {
    const results = await this.store.find(l => {
      if (l.repoId !== repoId) return false;
      if (options?.type && l.type !== options.type) return false;
      if (options?.incorporated !== undefined && l.incorporated !== options.incorporated) return false;
      return true;
    });
    return results.map(hydrateDates);
  }

  async findUnincorporated(repoId: string): Promise<Learning[]> {
    const results = await this.store.find(l => l.repoId === repoId && !l.incorporated);
    return results.map(hydrateDates);
  }

  async findHighImportance(repoId: string): Promise<Learning[]> {
    const results = await this.store.find(l => l.repoId === repoId && l.importance === 'high');
    return results.map(hydrateDates);
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
