/**
 * Repository interface for Chat Sessions.
 */

import type { ChatSession, ChatMessage } from '../../domain/chat-session.js';

/**
 * Repository for managing Q&A chat sessions linked to self-improvement runs.
 */
export interface ChatSessionRepository {
  /**
   * Find a chat session by ID.
   */
  findById(id: string): Promise<ChatSession | null>;

  /**
   * Find all chat sessions for a self-improvement run.
   */
  findByRun(selfImprovementRunId: string): Promise<ChatSession[]>;

  /**
   * Find all chat sessions for a repository.
   */
  findByRepo(repoId: string): Promise<ChatSession[]>;

  /**
   * Find active chat sessions for a repository.
   */
  findActive(repoId: string): Promise<ChatSession[]>;

  /**
   * Save a chat session.
   */
  save(session: ChatSession): Promise<void>;

  /**
   * Add a message to a chat session.
   * Also updates the session's updatedAt timestamp and totalCostUsd.
   */
  addMessage(sessionId: string, message: ChatMessage, costUsd?: number): Promise<void>;

  /**
   * Close a chat session.
   */
  close(sessionId: string): Promise<void>;

  /**
   * Delete a chat session.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all chat sessions for a repository.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Delete all chat sessions for a self-improvement run.
   */
  deleteByRun(selfImprovementRunId: string): Promise<void>;
}
