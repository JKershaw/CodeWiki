/**
 * CQRS Queries for Chat Session operations.
 *
 * These queries retrieve chat session data.
 */

import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { ChatSession } from '../domain/chat-session.js';

// ============================================================================
// GetChatSession Query
// ============================================================================

/**
 * Query to get a specific chat session by ID.
 */
export interface GetChatSessionQuery extends Query {
  readonly type: 'GetChatSession';
  readonly sessionId: string;
}

export function createGetChatSessionQuery(sessionId: string): GetChatSessionQuery {
  return {
    type: 'GetChatSession',
    sessionId,
  };
}

/**
 * Handler for GetChatSession query.
 */
export async function handleGetChatSession(
  query: GetChatSessionQuery,
  repos: Repositories
): Promise<QueryResult<ChatSession>> {
  try {
    const session = await repos.chatSessions.findById(query.sessionId);
    if (!session) {
      return notFound(`Chat session not found: ${query.sessionId}`);
    }
    return found(session);
  } catch (error) {
    return queryError(`Failed to get chat session: ${error}`);
  }
}

// ============================================================================
// GetChatSessionsForRun Query
// ============================================================================

/**
 * Query to get all chat sessions for a self-improvement run.
 */
export interface GetChatSessionsForRunQuery extends Query {
  readonly type: 'GetChatSessionsForRun';
  readonly selfImprovementRunId: string;
}

export function createGetChatSessionsForRunQuery(
  selfImprovementRunId: string
): GetChatSessionsForRunQuery {
  return {
    type: 'GetChatSessionsForRun',
    selfImprovementRunId,
  };
}

/**
 * Summary of a chat session for list display.
 */
export interface ChatSessionSummary {
  id: string;
  selfImprovementRunId: string;
  status: 'active' | 'closed';
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  totalCostUsd: number;
}

/**
 * Handler for GetChatSessionsForRun query.
 */
export async function handleGetChatSessionsForRun(
  query: GetChatSessionsForRunQuery,
  repos: Repositories
): Promise<QueryResult<ChatSessionSummary[]>> {
  try {
    const sessions = await repos.chatSessions.findByRun(query.selfImprovementRunId);

    const summaries: ChatSessionSummary[] = sessions.map(session => ({
      id: session.id,
      selfImprovementRunId: session.selfImprovementRunId,
      status: session.status,
      messageCount: session.messages.length,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      totalCostUsd: session.totalCostUsd,
    }));

    return found(summaries);
  } catch (error) {
    return queryError(`Failed to get chat sessions: ${error}`);
  }
}
