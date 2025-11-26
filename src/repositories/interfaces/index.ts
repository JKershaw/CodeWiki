/**
 * Repository interfaces for CodeWiki.
 *
 * These interfaces abstract storage, allowing different implementations:
 * - MongoDB: Used in production, staging, and CI/CD tests
 * - File-based: Used in local development and restricted environments
 */

export * from './repo-repository.js';
export * from './commit-repository.js';
export * from './wiki-page-repository.js';
export * from './agent-run-repository.js';
export * from './work-queue-repository.js';
export * from './conflict-repository.js';
export * from './learning-repository.js';
export * from './orchestrator-run-repository.js';

import type { RepoRepository } from './repo-repository.js';
import type { CommitRepository } from './commit-repository.js';
import type { WikiPageRepository } from './wiki-page-repository.js';
import type { AgentRunRepository } from './agent-run-repository.js';
import type { WorkQueueRepository } from './work-queue-repository.js';
import type { ConflictRepository } from './conflict-repository.js';
import type { LearningRepository } from './learning-repository.js';
import type { OrchestratorRunRepository } from './orchestrator-run-repository.js';

/**
 * Collection of all repositories.
 * Used for dependency injection.
 */
export interface Repositories {
  repos: RepoRepository;
  commits: CommitRepository;
  wikiPages: WikiPageRepository;
  agentRuns: AgentRunRepository;
  workQueue: WorkQueueRepository;
  conflicts: ConflictRepository;
  learnings: LearningRepository;
  orchestratorRuns: OrchestratorRunRepository;
}
