import type { AgentType } from './agent-run.js';
import {
  type EditSource,
  type CommitEditSource,
  createCommitEditSource,
  legacyToEditSource,
  editSourceToLegacy,
  getEditSourceTimestamp,
  isCommitEditSource,
} from './edit-source.js';

// Re-export EditSource types for convenience
export {
  type EditSource,
  type CommitEditSource,
  type StoryEditSource,
  type ManualEditSource,
  createCommitEditSource,
  createStoryEditSource,
  createManualEditSource,
  isCommitEditSource,
  isStoryEditSource,
  isManualEditSource,
  getEditSourceTimestamp,
} from './edit-source.js';

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

  // Source information (polymorphic)
  /** Source of this edit (commit, story, or manual) */
  source: EditSource;
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
 * Helper to get sourceCommitSha from EditRequest (for backward compatibility).
 */
export function getSourceCommitSha(editRequest: EditRequest): string | null {
  return isCommitEditSource(editRequest.source) ? editRequest.source.commitSha : null;
}

/**
 * Helper to get sourceCommitTimestamp from EditRequest (for backward compatibility).
 */
export function getSourceCommitTimestamp(editRequest: EditRequest): Date | null {
  return isCommitEditSource(editRequest.source) ? editRequest.source.commitTimestamp : null;
}

/**
 * Create a new edit request.
 */
export function createEditRequest(params: {
  id: string;
  repoId: string;
  wikiId: string;
  /** Source of the edit. Takes precedence over sourceCommitSha/sourceCommitTimestamp. */
  source?: EditSource;
  /** @deprecated Use source instead. Kept for backward compatibility. */
  sourceCommitSha?: string;
  /** @deprecated Use source instead. Kept for backward compatibility. */
  sourceCommitTimestamp?: Date;
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
  // Resolve source: prefer explicit source, fall back to legacy fields
  const source = params.source ?? (
    params.sourceCommitSha && params.sourceCommitTimestamp
      ? legacyToEditSource(params.sourceCommitSha, params.sourceCommitTimestamp)
      : createCommitEditSource('unknown', new Date()) // Fallback for malformed calls
  );

  const editRequest: EditRequest = {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    source,
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
  /** Source of the edit. Takes precedence over sourceCommitSha/sourceCommitTimestamp. */
  source?: EditSource;
  /** @deprecated Use source instead. Kept for backward compatibility. */
  sourceCommitSha?: string;
  /** @deprecated Use source instead. Kept for backward compatibility. */
  sourceCommitTimestamp?: Date;
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
    sourceAgentType: params.sourceAgentType,
    sourceAgentRunId: params.sourceAgentRunId,
    targetPagePath: params.update.path,
    proposedUpdateType: params.update.type,
    proposedContent: params.update.content,
    confidenceDelta: params.update.confidenceDelta,
  };

  // Handle source: prefer explicit source, fall back to legacy fields
  if (params.source !== undefined) {
    createParams.source = params.source;
  } else if (params.sourceCommitSha !== undefined && params.sourceCommitTimestamp !== undefined) {
    createParams.sourceCommitSha = params.sourceCommitSha;
    createParams.sourceCommitTimestamp = params.sourceCommitTimestamp;
  }

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
