/**
 * Represents a historical record of a wiki page mutation.
 *
 * Captures all changes to wiki pages with full before/after content
 * and provenance information for tracking which agents made changes.
 */

/**
 * Type of mutation operation on a wiki page.
 */
export type WikiPageHistoryOperation = 'create' | 'update' | 'delete';

/**
 * Type of agent that caused the mutation.
 */
export type WikiPageHistoryAgentType = 'bootstrap' | 'wiki-editor' | 'manual' | 'unknown';

/**
 * Historical record of a wiki page mutation.
 */
export interface WikiPageHistory {
  /** Unique identifier for this history record */
  id: string;
  /** Reference to the wiki */
  wikiId: string;
  /** Reference to the WikiPage that was modified */
  pageId: string;
  /** Page path at time of change (pages can be renamed) */
  pagePath: string;

  /** Type of mutation */
  operation: WikiPageHistoryOperation;
  /** When this change occurred */
  timestamp: Date;

  /** Full content before the change (null for 'create') */
  contentBefore: string | null;
  /** Full content after the change (null for 'delete') */
  contentAfter: string | null;

  /** OrchestratorRun or BootstrapRun that caused this change (optional) */
  agentRunId?: string;
  /** WorkItem that led to this change (optional) */
  workItemId?: string;
  /** EditRequest that was applied (optional - wiki-editor path) */
  editRequestId?: string;
  /** Type of agent that made the change */
  agentType: WikiPageHistoryAgentType;
}

/**
 * Parameters for creating a wiki page history record.
 */
export interface CreateWikiPageHistoryParams {
  id: string;
  wikiId: string;
  pageId: string;
  pagePath: string;
  operation: WikiPageHistoryOperation;
  contentBefore: string | null;
  contentAfter: string | null;
  agentRunId?: string;
  workItemId?: string;
  editRequestId?: string;
  agentType: WikiPageHistoryAgentType;
  timestamp?: Date;
}

/**
 * Create a new wiki page history record.
 */
export function createWikiPageHistory(params: CreateWikiPageHistoryParams): WikiPageHistory {
  return {
    id: params.id,
    wikiId: params.wikiId,
    pageId: params.pageId,
    pagePath: params.pagePath,
    operation: params.operation,
    timestamp: params.timestamp ?? new Date(),
    contentBefore: params.contentBefore,
    contentAfter: params.contentAfter,
    agentRunId: params.agentRunId,
    workItemId: params.workItemId,
    editRequestId: params.editRequestId,
    agentType: params.agentType,
  };
}
