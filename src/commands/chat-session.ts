/**
 * CQRS Commands for Chat Session operations.
 *
 * These commands handle all chat session state changes.
 */

import type { Command, CommandResult } from './types.js';
import { success, failure } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { AnalysisToolCall } from '../domain/self-improvement.js';
import {
  createChatSession,
  createChatMessage,
  type ChatSession,
} from '../domain/chat-session.js';

// ============================================================================
// StartChatSession Command
// ============================================================================

/**
 * Command to start a new chat session for a self-improvement analysis.
 */
export interface StartChatSessionCommand extends Command {
  readonly type: 'StartChatSession';
  readonly id: string;
  readonly repoId: string;
  readonly wikiId: string;
  readonly selfImprovementRunId: string;
}

export function createStartChatSessionCommand(params: {
  id: string;
  repoId: string;
  wikiId: string;
  selfImprovementRunId: string;
}): StartChatSessionCommand {
  return {
    type: 'StartChatSession',
    ...params,
  };
}

/**
 * Handler for StartChatSession command.
 */
export async function handleStartChatSession(
  command: StartChatSessionCommand,
  repos: Repositories
): Promise<CommandResult<ChatSession>> {
  try {
    // Verify the self-improvement run exists
    const run = await repos.selfImprovements.findById(command.selfImprovementRunId);
    if (!run) {
      return failure(`Self-improvement run not found: ${command.selfImprovementRunId}`);
    }

    // Only allow chat on completed runs
    if (run.status !== 'completed') {
      return failure(`Cannot start chat: self-improvement run is not completed (status: ${run.status})`);
    }

    const session = createChatSession({
      id: command.id,
      repoId: command.repoId,
      wikiId: command.wikiId,
      selfImprovementRunId: command.selfImprovementRunId,
    });

    await repos.chatSessions.save(session);
    return success(session);
  } catch (error) {
    return failure(`Failed to start chat session: ${error}`);
  }
}

// ============================================================================
// AddChatMessage Command
// ============================================================================

/**
 * Command to add a message to a chat session.
 */
export interface AddChatMessageCommand extends Command {
  readonly type: 'AddChatMessage';
  readonly sessionId: string;
  readonly messageId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly toolCalls?: AnalysisToolCall[];
  readonly costUsd?: number;
}

export function createAddChatMessageCommand(params: {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AnalysisToolCall[];
  costUsd?: number;
}): AddChatMessageCommand {
  const command: AddChatMessageCommand = {
    type: 'AddChatMessage',
    sessionId: params.sessionId,
    messageId: params.messageId,
    role: params.role,
    content: params.content,
  };

  if (params.toolCalls) {
    (command as { toolCalls: AnalysisToolCall[] }).toolCalls = params.toolCalls;
  }
  if (params.costUsd !== undefined) {
    (command as { costUsd: number }).costUsd = params.costUsd;
  }

  return command;
}

/**
 * Handler for AddChatMessage command.
 */
export async function handleAddChatMessage(
  command: AddChatMessageCommand,
  repos: Repositories
): Promise<CommandResult<ChatSession>> {
  try {
    const session = await repos.chatSessions.findById(command.sessionId);
    if (!session) {
      return failure(`Chat session not found: ${command.sessionId}`);
    }

    if (session.status === 'closed') {
      return failure(`Cannot add message: chat session is closed`);
    }

    const messageParams: {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: AnalysisToolCall[];
    } = {
      id: command.messageId,
      role: command.role,
      content: command.content,
    };

    if (command.toolCalls) {
      messageParams.toolCalls = command.toolCalls;
    }

    const message = createChatMessage(messageParams);

    await repos.chatSessions.addMessage(
      command.sessionId,
      message,
      command.costUsd ?? 0
    );

    // Return updated session
    const updatedSession = await repos.chatSessions.findById(command.sessionId);
    return success(updatedSession!);
  } catch (error) {
    return failure(`Failed to add chat message: ${error}`);
  }
}

// ============================================================================
// CloseChatSession Command
// ============================================================================

/**
 * Command to close a chat session.
 */
export interface CloseChatSessionCommand extends Command {
  readonly type: 'CloseChatSession';
  readonly sessionId: string;
}

export function createCloseChatSessionCommand(sessionId: string): CloseChatSessionCommand {
  return {
    type: 'CloseChatSession',
    sessionId,
  };
}

/**
 * Handler for CloseChatSession command.
 */
export async function handleCloseChatSession(
  command: CloseChatSessionCommand,
  repos: Repositories
): Promise<CommandResult<void>> {
  try {
    const session = await repos.chatSessions.findById(command.sessionId);
    if (!session) {
      return failure(`Chat session not found: ${command.sessionId}`);
    }

    await repos.chatSessions.close(command.sessionId);
    return success(undefined);
  } catch (error) {
    return failure(`Failed to close chat session: ${error}`);
  }
}
