import type { IterationRepository } from '../interfaces/iteration-repository.js';
import type { Iteration } from '../../domain/iteration.js';
import type { AgentType } from '../../domain/agent-run.js';
import { FileStore } from './file-store.js';

export class FileIterationRepository implements IterationRepository {
  private store: FileStore<Iteration>;

  constructor(baseDir: string) {
    this.store = new FileStore<Iteration>(baseDir, 'iterations');
  }

  async findById(id: string): Promise<Iteration | null> {
    const result = await this.store.get(id);
    return result ? this.hydrateDates(result) : null;
  }

  async findByProcessingRun(processingRunId: string): Promise<Iteration[]> {
    let results = await this.store.find(i => i.processingRunId === processingRunId);
    results = results.map(i => this.hydrateDates(i));
    // Sort by iteration number
    results.sort((a, b) => a.iterationNumber - b.iterationNumber);
    return results;
  }

  async findRunning(processingRunId: string): Promise<Iteration | null> {
    const results = await this.store.find(i =>
      i.processingRunId === processingRunId && i.status === 'running'
    );
    if (results.length === 0) return null;
    return this.hydrateDates(results[0]!);
  }

  async findMostRecent(processingRunId: string): Promise<Iteration | null> {
    let results = await this.store.find(i => i.processingRunId === processingRunId);
    if (results.length === 0) return null;

    results = results.map(i => this.hydrateDates(i));
    results.sort((a, b) => b.iterationNumber - a.iterationNumber);
    return results[0]!;
  }

  async save(iteration: Iteration): Promise<void> {
    await this.store.set(iteration);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByProcessingRun(processingRunId: string): Promise<void> {
    await this.store.deleteMany(i => i.processingRunId === processingRunId);
  }

  async updateWorkItem(id: string, updates: {
    workItemId: string;
    agentType: AgentType;
  }): Promise<void> {
    await this.store.update(id, updates);
  }

  async complete(id: string, result: {
    agentRunId: string;
    durationMs: number;
    costUsd: number;
    pagesCreated: number;
    pagesUpdated: number;
  }): Promise<void> {
    await this.store.update(id, {
      status: 'completed',
      agentRunId: result.agentRunId,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      pagesCreated: result.pagesCreated,
      pagesUpdated: result.pagesUpdated,
      completedAt: new Date(),
    });
  }

  async fail(id: string, error: string, durationMs: number): Promise<void> {
    await this.store.update(id, {
      status: 'failed',
      error,
      durationMs,
      completedAt: new Date(),
    });
  }

  async skip(id: string, reason: string): Promise<void> {
    await this.store.update(id, {
      status: 'skipped',
      error: reason,
      completedAt: new Date(),
    });
  }

  /** Safely get time from a Date or ISO string */
  private getTime(date: Date | string): number {
    if (date instanceof Date) return date.getTime();
    return new Date(date).getTime();
  }

  /** Ensure all date fields are proper Date objects */
  private hydrateDates(iteration: Iteration): Iteration {
    return {
      ...iteration,
      startedAt: iteration.startedAt instanceof Date ? iteration.startedAt : new Date(iteration.startedAt),
      completedAt: iteration.completedAt instanceof Date ? iteration.completedAt :
        (iteration.completedAt ? new Date(iteration.completedAt) : null),
    };
  }
}
