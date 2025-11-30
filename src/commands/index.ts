/**
 * CQRS Commands for CodeWiki.
 *
 * Commands change state. All state changes flow through commands,
 * providing a clean boundary between core logic and external interfaces.
 *
 * Available commands:
 * - CreateWiki: Create a new wiki for a repository
 * - SetActiveWiki: Set the active wiki for processing
 * - StartProcessingRepo: Begin processing a repository
 * - UpdateWikiPage: Create, update, or merge wiki content
 * - ClaimWorkItem: Claim the next pending work item
 * - SaveWorkItems: Save work items to the queue
 * - CompleteWorkItem: Mark a work item as completed
 * - FailWorkItem: Mark a work item as failed
 * - CreateAgentRun: Create a new agent run record
 * - CompleteAgentRun: Mark an agent run as completed
 * - FailAgentRun: Mark an agent run as failed
 * - StartProcessingRun: Start a new processing session
 * - UpdateProcessingProgress: Update processing run progress
 * - CompleteProcessingRun: Mark processing run as completed
 * - FailProcessingRun: Mark processing run as failed
 * - StopProcessingRun: Mark processing run as stopped
 * - StartIteration: Start a new iteration
 * - UpdateIterationWorkItem: Update iteration with work item details
 * - CompleteIteration: Mark iteration as completed
 * - FailIteration: Mark iteration as failed
 * - SkipIteration: Mark iteration as skipped
 * - RegisterRepository: Register a new repository
 * - LoadRepositoryCommits: Load commits into a repository
 * - UpdateRepositoryStatus: Update repository status
 * - MarkCommitProcessed: Mark a commit as processed by an agent
 * - UpdateWikiSettings: Update wiki configuration
 * - DeleteWiki: Delete a wiki and its pages
 * - SaveOrchestratorRun: Save orchestrator run results
 * - CreateFindings: Create one or more findings
 * - MarkFindingInProgress: Mark a finding as being addressed
 * - MarkFindingAddressed: Mark a finding as addressed
 * - MarkFindingDismissed: Dismiss a finding
 * - ResetFindingToOpen: Reset a finding back to open status
 */

export * from './types.js';
export * from './create-wiki.js';
export * from './set-active-wiki.js';
export * from './start-processing-repo.js';
export * from './update-wiki-page.js';
export * from './work-queue.js';
export * from './agent-run.js';
export * from './processing-run.js';
export * from './iteration.js';
export * from './repository.js';
export * from './wiki.js';
export * from './orchestrator-run.js';
export * from './finding.js';
