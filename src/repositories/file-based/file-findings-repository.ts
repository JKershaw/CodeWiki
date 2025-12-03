import type { FindingsRepository } from '../interfaces/findings-repository.js';
import type { Finding, FindingType, FindingStatus, FindingGroup } from '../../domain/finding.js';
import { FindingPriority } from '../../domain/finding.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
import { groupFindings } from '../../domain/finding-logic.js';
import { FileStore } from './file-store.js';

const hydrateDates = createDateNormalizer<Finding>({
  required: ['detectedAt'],
  optional: ['addressedAt'],
});

export class FileFindingsRepository implements FindingsRepository {
  private store: FileStore<Finding>;

  constructor(baseDir: string) {
    this.store = new FileStore<Finding>(baseDir, 'findings');
  }

  async findById(id: string): Promise<Finding | null> {
    const result = await this.store.get(id);
    return result ? hydrateDates(result) : null;
  }

  async findByWiki(wikiId: string, options?: {
    status?: FindingStatus;
    type?: FindingType;
    limit?: number;
  }): Promise<Finding[]> {
    let results = await this.store.find(f => {
      if (f.wikiId !== wikiId) return false;
      if (options?.status && f.status !== options.status) return false;
      if (options?.type && f.type !== options.type) return false;
      return true;
    });

    results = results.map(hydrateDates);

    // Sort by priority (type-based) then by detection time
    results.sort((a, b) => {
      const priorityDiff = (FindingPriority[b.type] ?? 0) - (FindingPriority[a.type] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return getTime(b.detectedAt) - getTime(a.detectedAt);
    });

    if (options?.limit) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  async findOpen(wikiId: string): Promise<Finding[]> {
    return this.findByWiki(wikiId, { status: 'open' });
  }

  async findByPaths(wikiId: string, paths: string[]): Promise<Finding[]> {
    const pathSet = new Set(paths);
    const results = await this.store.find(f => {
      if (f.wikiId !== wikiId) return false;
      return f.affectedPaths.some(p => pathSet.has(p));
    });
    return results.map(hydrateDates);
  }

  async findByAgentRun(agentRunId: string): Promise<Finding[]> {
    const results = await this.store.find(f => f.sourceAgentRunId === agentRunId);
    return results.map(hydrateDates);
  }

  async groupOpenFindings(wikiId: string): Promise<FindingGroup[]> {
    const openFindings = await this.findOpen(wikiId);
    return groupFindings(openFindings);
  }

  async countOpenByType(wikiId: string): Promise<Record<FindingType, number>> {
    const openFindings = await this.findOpen(wikiId);
    const counts: Record<string, number> = {};

    for (const finding of openFindings) {
      counts[finding.type] = (counts[finding.type] ?? 0) + 1;
    }

    return counts as Record<FindingType, number>;
  }

  async save(finding: Finding): Promise<void> {
    await this.store.set(finding);
  }

  async saveMany(findings: Finding[]): Promise<void> {
    await this.store.setMany(findings);
  }

  async markInProgress(id: string, agentRunId: string): Promise<void> {
    await this.store.update(id, {
      status: 'in_progress',
      addressedByAgentRunId: agentRunId,
    } as Partial<Finding>);
  }

  async markAddressed(id: string, agentRunId: string): Promise<void> {
    await this.store.update(id, {
      status: 'addressed',
      addressedByAgentRunId: agentRunId,
      addressedAt: new Date(),
    } as Partial<Finding>);
  }

  async markDismissed(id: string): Promise<void> {
    await this.store.update(id, {
      status: 'dismissed',
      addressedAt: new Date(),
    } as Partial<Finding>);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.store.deleteMany(f => f.wikiId === wikiId);
  }

  async deleteByAgentRun(agentRunId: string): Promise<void> {
    await this.store.deleteMany(f => f.sourceAgentRunId === agentRunId);
  }

  async existsSimilar(wikiId: string, type: FindingType, affectedPaths: string[]): Promise<boolean> {
    const pathSet = new Set(affectedPaths);
    const existing = await this.store.findOne(f => {
      if (f.wikiId !== wikiId) return false;
      if (f.type !== type) return false;
      if (f.status === 'addressed' || f.status === 'dismissed') return false;

      // Check if there's significant overlap in affected paths
      const commonPaths = f.affectedPaths.filter(p => pathSet.has(p));
      return commonPaths.length >= Math.min(affectedPaths.length, f.affectedPaths.length);
    });

    return existing !== null;
  }
}
