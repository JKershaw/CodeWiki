import type { AgentType } from './agent-run.js';

/**
 * Status of an edit request in the queue.
 */
export type EditRequestStatus =
  | 'pending'           // Waiting for wiki editor to process
  | 'applied'           // Applied normally (commit was newer or page didn't exist)
  | 'merged-to-history' // Added to historical context section
  | 'skipped'           // Skipped because content was superseded
  | 'conflict';         // Created a conflict for manual review

/**
 * Represents a proposed wiki edit from an analysis agent.
 * Edit requests queue up for the WikiEditorAgent to process intelligently,
 * taking into account commit ordering and existing page state.
 */
export interface EditRequest {
  id: string;
  /** Reference to the repository */
  repoId: string;
  /** Reference to the wiki */
  wikiId: string;

  // Source information
  /** SHA of the commit that produced this edit */
  sourceCommitSha: string;
  /** When the source commit was made (for ordering) */
  sourceCommitTimestamp: Date;
  /** Agent that proposed this edit */
  sourceAgentType: AgentType;
  /** Agent run that produced this edit */
  sourceAgentRunId: string;
  /** Work item that triggered this edit (for provenance tracking) */
  workItemId: string | null;

  // Target
  /** Path of the wiki page to edit */
  targetPagePath: string;
  /** Title for the page (optional) */
  targetPageTitle?: string;

  // Proposed change
  /** Type of update proposed */
  proposedUpdateType: 'create' | 'update' | 'merge' | 'delete';
  /** Proposed content for the page */
  proposedContent: string;
  /** Suggested confidence adjustment */
  confidenceDelta: number;
  /** For delete: optional redirect target */
  redirectTo?: string;

  // Queue metadata
  /** Current status of the edit request */
  status: EditRequestStatus;
  /** When this request was created */
  createdAt: Date;
  /** When this request was processed */
  processedAt: Date | null;
  /** Editor agent's reasoning for the decision */
  processingNotes: string | null;
  /** ID of the agent run that processed this request */
  processedByAgentRunId: string | null;
}

/**
 * Decision made by the WikiEditorAgent about how to handle an edit request.
 */
export interface EditDecision {
  /** How the edit request should be handled */
  action: 'apply' | 'merge-to-history' | 'skip' | 'conflict';
  /** Reasoning for the decision */
  reasoning: string;
  /** Modified content (for apply or merge-to-history) */
  content?: string;
}

/**
 * Create a new edit request.
 */
export function createEditRequest(params: {
  id: string;
  repoId: string;
  wikiId: string;
  sourceCommitSha: string;
  sourceCommitTimestamp: Date;
  sourceAgentType: AgentType;
  sourceAgentRunId: string;
  workItemId?: string;
  targetPagePath: string;
  targetPageTitle?: string;
  proposedUpdateType: 'create' | 'update' | 'merge' | 'delete';
  proposedContent: string;
  confidenceDelta: number;
  redirectTo?: string;
}): EditRequest {
  const editRequest: EditRequest = {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    sourceCommitSha: params.sourceCommitSha,
    sourceCommitTimestamp: params.sourceCommitTimestamp,
    sourceAgentType: params.sourceAgentType,
    sourceAgentRunId: params.sourceAgentRunId,
    workItemId: params.workItemId ?? null,
    targetPagePath: params.targetPagePath,
    proposedUpdateType: params.proposedUpdateType,
    proposedContent: params.proposedContent,
    confidenceDelta: params.confidenceDelta,
    status: 'pending',
    createdAt: new Date(),
    processedAt: null,
    processingNotes: null,
    processedByAgentRunId: null,
  };

  // Add optional properties only if they have values
  if (params.targetPageTitle !== undefined) {
    editRequest.targetPageTitle = params.targetPageTitle;
  }
  if (params.redirectTo !== undefined) {
    editRequest.redirectTo = params.redirectTo;
  }

  return editRequest;
}

/**
 * Convert a WikiPageUpdate to an EditRequest.
 * Used when analysis agents produce updates that should go through the editor queue.
 */
export function wikiPageUpdateToEditRequest(params: {
  id: string;
  repoId: string;
  wikiId: string;
  sourceCommitSha: string;
  sourceCommitTimestamp: Date;
  sourceAgentType: AgentType;
  sourceAgentRunId: string;
  workItemId?: string;
  update: {
    type: 'create' | 'update' | 'merge' | 'delete';
    path: string;
    title?: string;
    content: string;
    confidenceDelta: number;
    redirectTo?: string;
  };
}): EditRequest {
  // Build params object, only including optional properties if they have values
  const createParams: Parameters<typeof createEditRequest>[0] = {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    sourceCommitSha: params.sourceCommitSha,
    sourceCommitTimestamp: params.sourceCommitTimestamp,
    sourceAgentType: params.sourceAgentType,
    sourceAgentRunId: params.sourceAgentRunId,
    targetPagePath: params.update.path,
    proposedUpdateType: params.update.type,
    proposedContent: params.update.content,
    confidenceDelta: params.update.confidenceDelta,
  };

  if (params.workItemId !== undefined) {
    createParams.workItemId = params.workItemId;
  }
  if (params.update.title !== undefined) {
    createParams.targetPageTitle = params.update.title;
  }
  if (params.update.redirectTo !== undefined) {
    createParams.redirectTo = params.update.redirectTo;
  }

  return createEditRequest(createParams);
}
