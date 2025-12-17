/**
 * File-based repository implementations.
 *
 * Used in local development and restricted environments
 * where external database connections aren't available.
 */

export * from './file-store.js';
export * from './file-repo-repository.js';
export * from './file-wiki-repository.js';
export * from './file-commit-repository.js';
export * from './file-wiki-page-repository.js';
export * from './file-agent-run-repository.js';
export * from './file-work-queue-repository.js';
export * from './file-conflict-repository.js';
export * from './file-learning-repository.js';
export * from './file-orchestrator-run-repository.js';
export * from './file-processing-run-repository.js';
export * from './file-iteration-repository.js';
export * from './file-findings-repository.js';
export * from './file-benchmark-repository.js';
export * from './file-quality-benchmark-repository.js';
export * from './file-self-improvement-repository.js';
export * from './file-chat-session-repository.js';
export * from './file-user-repository.js';
export * from './file-wiki-page-history-repository.js';
export * from './file-auto-benchmark-repository.js';

import type { Repositories } from '../interfaces/index.js';
import { FileRepoRepository } from './file-repo-repository.js';
import { FileWikiRepository } from './file-wiki-repository.js';
import { FileCommitRepository } from './file-commit-repository.js';
import { FileWikiPageRepository } from './file-wiki-page-repository.js';
import { FileAgentRunRepository } from './file-agent-run-repository.js';
import { FileWorkQueueRepository } from './file-work-queue-repository.js';
import { FileConflictRepository } from './file-conflict-repository.js';
import { FileLearningRepository } from './file-learning-repository.js';
import { FileOrchestratorRunRepository } from './file-orchestrator-run-repository.js';
import { FileProcessingRunRepository } from './file-processing-run-repository.js';
import { FileIterationRepository } from './file-iteration-repository.js';
import { FileFindingsRepository } from './file-findings-repository.js';
import { FileBenchmarkRepository } from './file-benchmark-repository.js';
import { FileQualityBenchmarkRepository } from './file-quality-benchmark-repository.js';
import { FileSelfImprovementRepository } from './file-self-improvement-repository.js';
import { FileChatSessionRepository } from './file-chat-session-repository.js';
import { FileUserRepository } from './file-user-repository.js';
import { FileWikiPageHistoryRepository } from './file-wiki-page-history-repository.js';
import { FileAutoBenchmarkRepository } from './file-auto-benchmark-repository.js';

/**
 * Create all file-based repositories.
 *
 * @param baseDir - Base directory for storing JSON files.
 *                  Defaults to '.codewiki-data' in current directory.
 */
export function createFileRepositories(baseDir = '.codewiki-data'): Repositories {
  return {
    repos: new FileRepoRepository(baseDir),
    wikis: new FileWikiRepository(baseDir),
    commits: new FileCommitRepository(baseDir),
    wikiPages: new FileWikiPageRepository(baseDir),
    agentRuns: new FileAgentRunRepository(baseDir),
    workQueue: new FileWorkQueueRepository(baseDir),
    conflicts: new FileConflictRepository(baseDir),
    learnings: new FileLearningRepository(baseDir),
    orchestratorRuns: new FileOrchestratorRunRepository(baseDir),
    processingRuns: new FileProcessingRunRepository(baseDir),
    iterations: new FileIterationRepository(baseDir),
    findings: new FileFindingsRepository(baseDir),
    benchmarks: new FileBenchmarkRepository(baseDir),
    qualityBenchmarks: new FileQualityBenchmarkRepository(baseDir),
    selfImprovements: new FileSelfImprovementRepository(baseDir),
    chatSessions: new FileChatSessionRepository(baseDir),
    users: new FileUserRepository(baseDir),
    wikiPageHistory: new FileWikiPageHistoryRepository(baseDir),
    autoBenchmarks: new FileAutoBenchmarkRepository(baseDir),
  };
}
