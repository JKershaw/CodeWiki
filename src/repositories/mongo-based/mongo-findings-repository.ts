import type { Collection, Db, Document, Filter } from 'mongodb';
import type { FindingsRepository } from '../interfaces/findings-repository.js';
import type {
  Finding,
  FindingType,
  FindingStatus,
  FindingGroup,
} from '../../domain/finding.js';
import { FindingPriority } from '../../domain/finding.js';
import { groupFindings } from '../../domain/finding-logic.js';
import { toEntity, toEntities, toDocument, byId, replaceOp } from './mongo-utils.js';

export class MongoFindingsRepository implements FindingsRepository {
  private collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection('findings');
  }

  async findById(id: string): Promise<Finding | null> {
    const doc = await this.collection.findOne(byId(id));
    return toEntity<Finding>(doc);
  }

  async findByWiki(
    wikiId: string,
    options?: { status?: FindingStatus; type?: FindingType; limit?: number }
  ): Promise<Finding[]> {
    const filter: Filter<Document> = { wikiId };

    if (options?.status) {
      filter.status = options.status;
    }
    if (options?.type) {
      filter.type = options.type;
    }

    let cursor = this.collection.find(filter);

    if (options?.limit) {
      cursor = cursor.limit(options.limit);
    }

    const docs = await cursor.toArray();
    const findings = toEntities<Finding>(docs);

    // Sort by priority (type-based) then by detection time
    findings.sort((a, b) => {
      const priorityDiff = (FindingPriority[b.type] ?? 0) - (FindingPriority[a.type] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });

    return findings;
  }

  async findOpen(wikiId: string): Promise<Finding[]> {
    return this.findByWiki(wikiId, { status: 'open' });
  }

  async findByPaths(wikiId: string, paths: string[]): Promise<Finding[]> {
    const docs = await this.collection
      .find({
        wikiId,
        affectedPaths: { $in: paths },
      })
      .toArray();
    return toEntities<Finding>(docs);
  }

  async findByAgentRun(agentRunId: string): Promise<Finding[]> {
    const docs = await this.collection.find({ sourceAgentRunId: agentRunId }).toArray();
    return toEntities<Finding>(docs);
  }

  async groupOpenFindings(wikiId: string): Promise<FindingGroup[]> {
    const openFindings = await this.findOpen(wikiId);
    return groupFindings(openFindings);
  }

  async countOpenByType(wikiId: string): Promise<Record<FindingType, number>> {
    const pipeline = [
      { $match: { wikiId, status: 'open' } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    const counts: Record<string, number> = {};

    for (const result of results) {
      counts[result._id] = result.count;
    }

    return counts as Record<FindingType, number>;
  }

  async save(finding: Finding): Promise<void> {
    const doc = toDocument(finding);
    await this.collection.replaceOne(byId(finding.id), doc, { upsert: true });
  }

  async saveMany(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    const operations = findings.map(finding => replaceOp(finding));
    await this.collection.bulkWrite(operations);
  }

  async markInProgress(id: string, agentRunId: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'in_progress',
          addressedByAgentRunId: agentRunId,
        },
      }
    );
  }

  async markAddressed(id: string, agentRunId: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'addressed',
          addressedByAgentRunId: agentRunId,
          addressedAt: new Date(),
        },
      }
    );
  }

  async markDismissed(id: string): Promise<void> {
    await this.collection.updateOne(
      byId(id),
      {
        $set: {
          status: 'dismissed',
          addressedAt: new Date(),
        },
      }
    );
  }

  async delete(id: string): Promise<void> {
    await this.collection.deleteOne(byId(id));
  }

  async deleteByWiki(wikiId: string): Promise<void> {
    await this.collection.deleteMany({ wikiId });
  }

  async deleteByAgentRun(agentRunId: string): Promise<void> {
    await this.collection.deleteMany({ sourceAgentRunId: agentRunId });
  }

  async existsSimilar(
    wikiId: string,
    type: FindingType,
    affectedPaths: string[]
  ): Promise<boolean> {
    // Find existing open findings of the same type with overlapping paths
    const existing = await this.collection.findOne({
      wikiId,
      type,
      status: { $nin: ['addressed', 'dismissed'] },
      affectedPaths: { $in: affectedPaths },
    });

    if (!existing) return false;

    // Check if there's significant overlap in affected paths
    const existingPaths = new Set(existing.affectedPaths as string[]);
    const commonPaths = affectedPaths.filter(p => existingPaths.has(p));
    return commonPaths.length >= Math.min(affectedPaths.length, existingPaths.size);
  }
}
