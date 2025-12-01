/**
 * File-based implementation of SelfImprovementRepository.
 */

import { readFile, writeFile, mkdir, readdir, unlink, rm } from 'fs/promises';
import { join } from 'path';
import type { SelfImprovementRepository } from '../interfaces/self-improvement-repository.js';
import type { SelfImprovementRun } from '../../domain/self-improvement.js';

/**
 * File-based self-improvement repository.
 * Stores runs as JSON files organized by repository.
 */
export class FileSelfImprovementRepository implements SelfImprovementRepository {
  constructor(private readonly basePath: string) {}

  /**
   * Get the directory path for a repository's self-improvement runs.
   */
  private getRepoDir(repoId: string): string {
    return join(this.basePath, 'self-improvements', repoId);
  }

  /**
   * Get the file path for a specific run.
   */
  private getRunPath(repoId: string, runId: string): string {
    return join(this.getRepoDir(repoId), `${runId}.json`);
  }

  /**
   * Ensure the directory exists.
   */
  private async ensureDir(repoId: string): Promise<void> {
    await mkdir(this.getRepoDir(repoId), { recursive: true });
  }

  /**
   * Serialize a run for storage.
   */
  private serialize(run: SelfImprovementRun): string {
    return JSON.stringify(run, null, 2);
  }

  /**
   * Deserialize a run from storage.
   */
  private deserialize(data: string): SelfImprovementRun {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      startedAt: new Date(parsed.startedAt),
      completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null,
    };
  }

  async findById(id: string): Promise<SelfImprovementRun | null> {
    // We need to search across all repos since we only have the ID
    try {
      const reposDir = join(this.basePath, 'self-improvements');
      const repoDirs = await readdir(reposDir).catch(() => []);

      for (const repoId of repoDirs) {
        const runPath = this.getRunPath(repoId, id);
        try {
          const data = await readFile(runPath, 'utf-8');
          return this.deserialize(data);
        } catch {
          // File doesn't exist in this repo, continue
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async findByRepo(repoId: string): Promise<SelfImprovementRun[]> {
    try {
      const repoDir = this.getRepoDir(repoId);
      const files = await readdir(repoDir).catch(() => []);
      const runs: SelfImprovementRun[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(repoDir, file), 'utf-8');
          runs.push(this.deserialize(data));
        } catch {
          // Skip invalid files
        }
      }

      // Sort by startedAt descending
      runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      return runs;
    } catch {
      return [];
    }
  }

  async findLatest(repoId: string, limit: number = 10): Promise<SelfImprovementRun[]> {
    const runs = await this.findByRepo(repoId);
    return runs.slice(0, limit);
  }

  async findRunning(repoId: string): Promise<SelfImprovementRun | null> {
    const runs = await this.findByRepo(repoId);
    return runs.find(r => r.status === 'running') ?? null;
  }

  async save(run: SelfImprovementRun): Promise<void> {
    await this.ensureDir(run.repoId);
    const runPath = this.getRunPath(run.repoId, run.id);
    await writeFile(runPath, this.serialize(run), 'utf-8');
  }

  async delete(id: string): Promise<void> {
    // Find the run first to get the repoId
    const run = await this.findById(id);
    if (run) {
      const runPath = this.getRunPath(run.repoId, id);
      await unlink(runPath).catch(() => {});
    }
  }

  async deleteByRepo(repoId: string): Promise<void> {
    const repoDir = this.getRepoDir(repoId);
    await rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }

  async complete(id: string, report: string, costUsd: number): Promise<void> {
    const run = await this.findById(id);
    if (!run) return;

    run.status = 'completed';
    run.completedAt = new Date();
    run.report = report;
    run.costUsd = costUsd;

    await this.save(run);
  }

  async fail(id: string, error: string): Promise<void> {
    const run = await this.findById(id);
    if (!run) return;

    run.status = 'failed';
    run.completedAt = new Date();
    run.error = error;

    await this.save(run);
  }
}

/**
 * Create a file-based self-improvement repository.
 */
export function createFileSelfImprovementRepository(
  basePath: string
): SelfImprovementRepository {
  return new FileSelfImprovementRepository(basePath);
}
