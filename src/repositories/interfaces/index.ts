/**
 * Repository interfaces for CodeWiki.
 *
 * These interfaces abstract storage, allowing different implementations:
 * - MongoDB: Used in production, staging, and CI/CD tests
 * - File-based: Used in local development and restricted environments
 */

export * from './repo-repository.js';
export * from './wiki-repository.js';
export * from './commit-repository.js';
export * from './wiki-page-repository.js';
export * from './agent-run-repository.js';
export * from './work-queue-repository.js';
export * from './conflict-repository.js';
export * from './learning-repository.js';
export * from './orchestrator-run-repository.js';
export * from './processing-run-repository.js';
export * from './iteration-repository.js';
export * from './findings-repository.js';

import type { RepoRepository } from './repo-repository.js';
import type { WikiRepository } from './wiki-repository.js';
import type { CommitRepository } from './commit-repository.js';
import type { WikiPageRepository } from './wiki-page-repository.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import type { WorkQueueRepository } from './work-queue-repository.js';
import type { ConflictRepository } from './conflict-repository.js';
import type { LearningRepository } from './learning-repository.js';
import type { OrchestratorRunRepository } from './orchestrator-run-repository.js';
import type { ProcessingRunRepository } from './processing-run-repository.js';
import type { IterationRepository } from './iteration-repository.js';
import type { FindingsRepository } from './findings-repository.js';

/**
 * Collection of all repositories.
 * Used for dependency injection.
 */
export interface Repositories {
  repos: RepoRepository;
  wikis: WikiRepository;
  commits: CommitRepository;
  wikiPages: WikiPageRepository;
  agentRuns: AgentRunRepository;
  workQueue: WorkQueueRepository;
  conflicts: ConflictRepository;
  learnings: LearningRepository;
  orchestratorRuns: OrchestratorRunRepository;
  processingRuns: ProcessingRunRepository;
  iterations: IterationRepository;
  findings: FindingsRepository;
}
