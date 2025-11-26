import type { OrchestratorRunRepository } from '../interfaces/orchestrator-run-repository.js';
import type { OrchestratorRun } from '../../domain/orchestrator-run.js';
import { FileStore } from './file-store.js';

export class FileOrchestratorRunRepository implements OrchestratorRunRepository {
  private store: FileStore<OrchestratorRun>;

  constructor(baseDir: string) {
    this.store = new FileStore<OrchestratorRun>(baseDir, 'orchestrator-runs');
  }

  async findById(id: string): Promise<OrchestratorRun | null> {
    return this.store.get(id);
  }

  async findByRepo(repoId: string, options?: {
    limit?: number;
    usedLLM?: boolean;
  }): Promise<OrchestratorRun[]> {
    let runs = await this.store.find(r => {
      if (r.repoId !== repoId) return false;
      if (options?.usedLLM !== undefined && r.usedLLM !== options.usedLLM) return false;
      return true;
    });

    // Sort by timestamp descending (most recent first)
    runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (options?.limit) {
      runs = runs.slice(0, options.limit);
    }

    return runs;
  }

  async findRecent(repoId: string, since: Date): Promise<OrchestratorRun[]> {
    const runs = await this.store.find(r =>
      r.repoId === repoId && new Date(r.timestamp) > since
    );

    // Sort by timestamp descending
    runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return runs;
  }

  async save(run: OrchestratorRun): Promise<void> {
    await this.store.set(run);
  }

  async deleteOlderThan(repoId: string, olderThan: Date): Promise<number> {
    const toDelete = await this.store.find(r =>
      r.repoId === repoId && new Date(r.timestamp) < olderThan
    );

    for (const run of toDelete) {
      await this.store.delete(run.id);
    }

    return toDelete.length;
  }
}
