/**
 * Domain types for the Self-Improvement Chat system.
 *
 * Allows users to have Q&A conversations about completed self-improvement
 * analysis runs, with the LLM able to use tools to investigate further.
 */

import type { AnalysisToolCall } from './self-improvement.js';

// ============================================================================
// Chat Message
// ============================================================================

/**
 * A single message in a chat conversation.
 */
export interface ChatMessage {
  /** Unique identifier for this message */
  id: string;
  /** Role of the message sender */
  role: 'user' | 'assistant';
  /** Text content of the message */
  content: string;
  /** Tool calls made by the assistant (if any) */
  toolCalls?: AnalysisToolCall[];
  /** When this message was created */
  timestamp: Date;
}

// ============================================================================
// Chat Session
// ============================================================================

/**
 * Status of a chat session.
 */
export type ChatSessionStatus = 'active' | 'closed';

/**
 * A Q&A chat session linked to a self-improvement analysis run.
 */
export interface ChatSession {
  /** Unique identifier */
  id: string;
  /** Repository being discussed */
  repoId: string;
  /** Wiki being discussed */
  wikiId: string;
  /** The self-improvement run this chat is about */
  selfImprovementRunId: string;
  /** All messages in the conversation */
  messages: ChatMessage[];
  /** Current status */
  status: ChatSessionStatus;
  /** When the session was created */
  createdAt: Date;
  /** When the session was last updated */
  updatedAt: Date;
  /** Total LLM cost for this chat session */
  totalCostUsd: number;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new chat session.
 */
export function createChatSession(params: {
  id: string;
  repoId: string;
  wikiId: string;
  selfImprovementRunId: string;
}): ChatSession {
  const now = new Date();
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    selfImprovementRunId: params.selfImprovementRunId,
    messages: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    totalCostUsd: 0,
  };
}

/**
 * Create a new chat message.
 */
export function createChatMessage(params: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AnalysisToolCall[];
}): ChatMessage {
  const message: ChatMessage = {
    id: params.id,
    role: params.role,
    content: params.content,
    timestamp: new Date(),
  };

  if (params.toolCalls) {
    message.toolCalls = params.toolCalls;
  }

  return message;
}

/**
 * Add a message to a chat session.
 * Returns a new session with the message added (immutable).
 */
export function addMessageToSession(
  session: ChatSession,
  message: ChatMessage,
  costUsd: number = 0
): ChatSession {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: new Date(),
    totalCostUsd: session.totalCostUsd + costUsd,
  };
}

/**
 * Close a chat session.
 * Returns a new session with status set to 'closed' (immutable).
 */
export function closeChatSession(session: ChatSession): ChatSession {
  return {
    ...session,
    status: 'closed',
    updatedAt: new Date(),
  };
}
