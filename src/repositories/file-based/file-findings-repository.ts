import type { FindingsRepository } from '../interfaces/findings-repository.js';
import type { Finding, FindingType, FindingStatus, FindingGroup } from '../../domain/finding.js';
import { FindingPriority } from '../../domain/finding.js';
import { createDateNormalizer, getTime } from '../../domain/date-utils.js';
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
    let results = await this.store.find(f => {
      if (f.wikiId !== wikiId) return false;
      return f.affectedPaths.some(p => pathSet.has(p));
    });
    return results.map(hydrateDates);
  }

  async findByAgentRun(agentRunId: string): Promise<Finding[]> {
    let results = await this.store.find(f => f.sourceAgentRunId === agentRunId);
    return results.map(hydrateDates);
  }

  async groupOpenFindings(wikiId: string): Promise<FindingGroup[]> {
    const openFindings = await this.findOpen(wikiId);

    if (openFindings.length === 0) {
      return [];
    }

    // Group by type
    const byType = new Map<FindingType, Finding[]>();
    for (const finding of openFindings) {
      if (!byType.has(finding.type)) {
        byType.set(finding.type, []);
      }
      byType.get(finding.type)!.push(finding);
    }

    // Create finding groups
    const groups: FindingGroup[] = [];
    for (const [type, findings] of byType) {
      // For duplicate_title and similar_content, further group by affected paths
      if (type === 'duplicate_title' || type === 'similar_content') {
        // Group findings that share common affected paths
        const pathGroups = this.groupBySharedPaths(findings);
        for (const groupFindings of pathGroups) {
          const allPaths = new Set<string>();
          let highestSeverity: 'low' | 'medium' | 'high' = 'low';

          for (const f of groupFindings) {
            f.affectedPaths.forEach(p => allPaths.add(p));
            if (f.severity === 'high') highestSeverity = 'high';
            else if (f.severity === 'medium' && highestSeverity !== 'high') {
              highestSeverity = 'medium';
            }
          }

          groups.push({
            type,
            findings: groupFindings,
            affectedPaths: Array.from(allPaths),
            severity: highestSeverity,
          });
        }
      } else {
        // For other types, create one group per type
        const allPaths = new Set<string>();
        let highestSeverity: 'low' | 'medium' | 'high' = 'low';

        for (const f of findings) {
          f.affectedPaths.forEach(p => allPaths.add(p));
          if (f.severity === 'high') highestSeverity = 'high';
          else if (f.severity === 'medium' && highestSeverity !== 'high') {
            highestSeverity = 'medium';
          }
        }

        groups.push({
          type,
          findings,
          affectedPaths: Array.from(allPaths),
          severity: highestSeverity,
        });
      }
    }

    // Sort groups by priority
    groups.sort((a, b) => {
      const priorityDiff = (FindingPriority[b.type] ?? 0) - (FindingPriority[a.type] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      // Secondary sort by severity
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    return groups;
  }

  /**
   * Group findings that share common affected paths.
   */
  private groupBySharedPaths(findings: Finding[]): Finding[][] {
    if (findings.length <= 1) {
      return [findings];
    }

    // Use Union-Find to group findings with overlapping paths
    const parent = new Map<string, string>();
    const findRoot = (path: string): string => {
      if (!parent.has(path)) {
        parent.set(path, path);
      }
      if (parent.get(path) !== path) {
        parent.set(path, findRoot(parent.get(path)!));
      }
      return parent.get(path)!;
    };

    const union = (path1: string, path2: string): void => {
      const root1 = findRoot(path1);
      const root2 = findRoot(path2);
      if (root1 !== root2) {
        parent.set(root1, root2);
      }
    };

    // Connect all paths within each finding
    for (const finding of findings) {
      if (finding.affectedPaths.length > 1) {
        for (let i = 1; i < finding.affectedPaths.length; i++) {
          union(finding.affectedPaths[0]!, finding.affectedPaths[i]!);
        }
      }
    }

    // Group findings by their root path
    const groups = new Map<string, Finding[]>();
    for (const finding of findings) {
      if (finding.affectedPaths.length === 0) continue;
      const root = findRoot(finding.affectedPaths[0]!);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(finding);
    }

    return Array.from(groups.values());
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
