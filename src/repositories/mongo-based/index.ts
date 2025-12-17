/**
 * MongoDB-based repository implementations.
 *
 * Used in production, staging, and CI/CD environments
 * where MongoDB is available.
 */

import type { Db } from 'mongodb';
import type { Repositories } from '../interfaces/index.js';

export * from './mongo-utils.js';
export * from './mongo-repo-repository.js';
export * from './mongo-wiki-repository.js';
export * from './mongo-commit-repository.js';
export * from './mongo-wiki-page-repository.js';
export * from './mongo-agent-run-repository.js';
export * from './mongo-work-queue-repository.js';
export * from './mongo-conflict-repository.js';
export * from './mongo-learning-repository.js';
export * from './mongo-orchestrator-run-repository.js';
export * from './mongo-processing-run-repository.js';
export * from './mongo-iteration-repository.js';
export * from './mongo-findings-repository.js';
export * from './mongo-benchmark-repository.js';
export * from './mongo-quality-benchmark-repository.js';
export * from './mongo-self-improvement-repository.js';
export * from './mongo-chat-session-repository.js';
export * from './mongo-user-repository.js';
export * from './mongo-wiki-page-history-repository.js';
export * from './mongo-auto-benchmark-repository.js';

import { MongoRepoRepository } from './mongo-repo-repository.js';
import { MongoWikiRepository } from './mongo-wiki-repository.js';
import { MongoCommitRepository } from './mongo-commit-repository.js';
import { MongoWikiPageRepository } from './mongo-wiki-page-repository.js';
import { MongoAgentRunRepository } from './mongo-agent-run-repository.js';
import { MongoWorkQueueRepository } from './mongo-work-queue-repository.js';
import { MongoConflictRepository } from './mongo-conflict-repository.js';
import { MongoLearningRepository } from './mongo-learning-repository.js';
import { MongoOrchestratorRunRepository } from './mongo-orchestrator-run-repository.js';
import { MongoProcessingRunRepository } from './mongo-processing-run-repository.js';
import { MongoIterationRepository } from './mongo-iteration-repository.js';
import { MongoFindingsRepository } from './mongo-findings-repository.js';
import { MongoBenchmarkRepository } from './mongo-benchmark-repository.js';
import { MongoQualityBenchmarkRepository } from './mongo-quality-benchmark-repository.js';
import { MongoSelfImprovementRepository } from './mongo-self-improvement-repository.js';
import { MongoChatSessionRepository } from './mongo-chat-session-repository.js';
import { MongoUserRepository } from './mongo-user-repository.js';
import { MongoWikiPageHistoryRepository } from './mongo-wiki-page-history-repository.js';
import { MongoAutoBenchmarkRepository } from './mongo-auto-benchmark-repository.js';

/**
 * Create all MongoDB-based repositories.
 *
 * @param db - MongoDB database instance
 */
export function createMongoRepositories(db: Db): Repositories {
  return {
    repos: new MongoRepoRepository(db),
    wikis: new MongoWikiRepository(db),
    commits: new MongoCommitRepository(db),
    wikiPages: new MongoWikiPageRepository(db),
    agentRuns: new MongoAgentRunRepository(db),
    workQueue: new MongoWorkQueueRepository(db),
    conflicts: new MongoConflictRepository(db),
    learnings: new MongoLearningRepository(db),
    orchestratorRuns: new MongoOrchestratorRunRepository(db),
    processingRuns: new MongoProcessingRunRepository(db),
    iterations: new MongoIterationRepository(db),
    findings: new MongoFindingsRepository(db),
    benchmarks: new MongoBenchmarkRepository(db),
    qualityBenchmarks: new MongoQualityBenchmarkRepository(db),
    selfImprovements: new MongoSelfImprovementRepository(db),
    chatSessions: new MongoChatSessionRepository(db),
    users: new MongoUserRepository(db),
    wikiPageHistory: new MongoWikiPageHistoryRepository(db),
    autoBenchmarks: new MongoAutoBenchmarkRepository(db),
  };
}

/**
 * Create indexes for all MongoDB collections.
 * Should be called once during application startup.
 *
 * @param db - MongoDB database instance
 */
export async function createMongoIndexes(db: Db): Promise<void> {
  // Repos collection
  await db.collection('repos').createIndexes([
    { key: { fullName: 1 }, unique: true },
    { key: { status: 1 } },
  ]);

  // Wikis collection
  await db.collection('wikis').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, slug: 1 }, unique: true },
    { key: { repoId: 1, isActive: 1 } },
    { key: { status: 1 } },
  ]);

  // Commits collection
  await db.collection('commits').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, sha: 1 }, unique: true },
    { key: { repoId: 1, committedAt: -1 } },
  ]);

  // Wiki pages collection
  await db.collection('wiki-pages').createIndexes([
    { key: { wikiId: 1 } },
    { key: { wikiId: 1, path: 1 }, unique: true },
    { key: { wikiId: 1, confidence: 1 } },
    { key: { wikiId: 1, updatedAt: -1 } },
    { key: { title: 'text', content: 'text' } },
  ]);

  // Agent runs collection
  await db.collection('agent-runs').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { repoId: 1, agentType: 1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { targetCommitId: 1 } },
  ]);

  // Work queue collection (FIFO ordering by createdAt)
  await db.collection('work-queue').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { repoId: 1, status: 1, createdAt: 1 } },
    { key: { repoId: 1, agentType: 1, status: 1 } },
  ]);

  // Processing runs collection
  await db.collection('processing-runs').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { repoId: 1, status: 1 } },
  ]);

  // Iterations collection
  await db.collection('iterations').createIndexes([
    { key: { processingRunId: 1 } },
    { key: { processingRunId: 1, startedAt: -1 } },
    { key: { processingRunId: 1, status: 1 } },
  ]);

  // Conflicts collection
  await db.collection('conflicts').createIndexes([
    { key: { wikiId: 1 } },
    { key: { wikiId: 1, status: 1 } },
    { key: { wikiId: 1, pagePath: 1 } },
  ]);

  // Learnings collection
  await db.collection('learnings').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, incorporated: 1 } },
    { key: { repoId: 1, importance: 1 } },
  ]);

  // Orchestrator runs collection
  await db.collection('orchestrator-runs').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, timestamp: -1 } },
    { key: { repoId: 1, usedLLM: 1 } },
  ]);

  // Findings collection
  await db.collection('findings').createIndexes([
    { key: { wikiId: 1 } },
    { key: { wikiId: 1, status: 1 } },
    { key: { wikiId: 1, type: 1 } },
    { key: { sourceAgentRunId: 1 } },
    { key: { affectedPaths: 1 } },
  ]);

  // Benchmarks collection
  await db.collection('benchmarks').createIndexes([
    { key: { repoId: 1 } },
    { key: { wikiId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { wikiId: 1, startedAt: -1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { wikiId: 1, status: 1 } },
  ]);

  // Quality benchmarks collection
  await db.collection('quality-benchmarks').createIndexes([
    { key: { repoId: 1 } },
    { key: { wikiId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { wikiId: 1, startedAt: -1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { wikiId: 1, status: 1 } },
  ]);

  // Self-improvement runs collection
  await db.collection('self-improvements').createIndexes([
    { key: { repoId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { repoId: 1, status: 1 } },
  ]);

  // Chat sessions collection
  await db.collection('chat-sessions').createIndexes([
    { key: { repoId: 1 } },
    { key: { selfImprovementRunId: 1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { repoId: 1, createdAt: -1 } },
  ]);

  // Users collection
  await db.collection('users').createIndexes([
    { key: { githubId: 1 }, unique: true },
    { key: { login: 1 }, unique: true },
    { key: { createdAt: -1 } },
  ]);

  // Wiki page history collection
  await db.collection('wiki-page-history').createIndexes([
    { key: { wikiId: 1 } },
    { key: { pageId: 1 } },
    { key: { wikiId: 1, timestamp: -1 } },
    { key: { pageId: 1, timestamp: -1 } },
    { key: { wikiId: 1, pagePath: 1 } },
    { key: { agentRunId: 1 } },
  ]);

  // Auto-benchmarks collection
  await db.collection('auto_benchmarks').createIndexes([
    { key: { repoId: 1 } },
    { key: { wikiId: 1 } },
    { key: { repoId: 1, startedAt: -1 } },
    { key: { wikiId: 1, startedAt: -1 } },
    { key: { repoId: 1, status: 1 } },
    { key: { wikiId: 1, status: 1 } },
    { key: { status: 1 } },
  ]);
}
