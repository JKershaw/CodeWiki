/**
 * File-based implementation of ChatSessionRepository.
 */

import { readFile, writeFile, mkdir, readdir, unlink, rm } from 'fs/promises';
import { join } from 'path';
import type { ChatSessionRepository } from '../interfaces/chat-session-repository.js';
import type { ChatSession, ChatMessage } from '../../domain/chat-session.js';

/**
 * File-based chat session repository.
 * Stores sessions as JSON files organized by repository.
 */
export class FileChatSessionRepository implements ChatSessionRepository {
  constructor(private readonly basePath: string) {}

  /**
   * Get the directory path for a repository's chat sessions.
   */
  private getRepoDir(repoId: string): string {
    return join(this.basePath, 'chat-sessions', repoId);
  }

  /**
   * Get the file path for a specific session.
   */
  private getSessionPath(repoId: string, sessionId: string): string {
    return join(this.getRepoDir(repoId), `${sessionId}.json`);
  }

  /**
   * Ensure the directory exists.
   */
  private async ensureDir(repoId: string): Promise<void> {
    await mkdir(this.getRepoDir(repoId), { recursive: true });
  }

  /**
   * Serialize a session for storage.
   */
  private serialize(session: ChatSession): string {
    return JSON.stringify(session, null, 2);
  }

  /**
   * Deserialize a session from storage.
   */
  private deserialize(data: string): ChatSession {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
      messages: parsed.messages.map((m: ChatMessage & { timestamp: string }) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    };
  }

  async findById(id: string): Promise<ChatSession | null> {
    // Search across all repos since we only have the ID
    try {
      const sessionsDir = join(this.basePath, 'chat-sessions');
      const repoDirs = await readdir(sessionsDir).catch(() => []);

      for (const repoId of repoDirs) {
        const sessionPath = this.getSessionPath(repoId, id);
        try {
          const data = await readFile(sessionPath, 'utf-8');
          return this.deserialize(data);
        } catch {
          // File doesn't exist in this repo, continue
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async findByRun(selfImprovementRunId: string): Promise<ChatSession[]> {
    try {
      const sessionsDir = join(this.basePath, 'chat-sessions');
      const repoDirs = await readdir(sessionsDir).catch(() => []);
      const sessions: ChatSession[] = [];

      for (const repoId of repoDirs) {
        const repoDir = this.getRepoDir(repoId);
        const files = await readdir(repoDir).catch(() => []);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = await readFile(join(repoDir, file), 'utf-8');
            const session = this.deserialize(data);
            if (session.selfImprovementRunId === selfImprovementRunId) {
              sessions.push(session);
            }
          } catch {
            // Skip invalid files
          }
        }
      }

      // Sort by createdAt descending (newest first)
      sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return sessions;
    } catch {
      return [];
    }
  }

  async findByRepo(repoId: string): Promise<ChatSession[]> {
    try {
      const repoDir = this.getRepoDir(repoId);
      const files = await readdir(repoDir).catch(() => []);
      const sessions: ChatSession[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(repoDir, file), 'utf-8');
          sessions.push(this.deserialize(data));
        } catch {
          // Skip invalid files
        }
      }

      // Sort by createdAt descending (newest first)
      sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return sessions;
    } catch {
      return [];
    }
  }

  async findActive(repoId: string): Promise<ChatSession[]> {
    const sessions = await this.findByRepo(repoId);
    return sessions.filter(s => s.status === 'active');
  }

  async save(session: ChatSession): Promise<void> {
    await this.ensureDir(session.repoId);
    const sessionPath = this.getSessionPath(session.repoId, session.id);
    await writeFile(sessionPath, this.serialize(session), 'utf-8');
  }

  async addMessage(sessionId: string, message: ChatMessage, costUsd: number = 0): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session) return;

    session.messages.push(message);
    session.updatedAt = new Date();
    session.totalCostUsd += costUsd;

    await this.save(session);
  }

  async close(sessionId: string): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session) return;

    session.status = 'closed';
    session.updatedAt = new Date();

    await this.save(session);
  }

  async delete(id: string): Promise<void> {
    const session = await this.findById(id);
    if (session) {
      const sessionPath = this.getSessionPath(session.repoId, id);
      await unlink(sessionPath).catch(() => {});
    }
  }

  async deleteByRepo(repoId: string): Promise<void> {
    const repoDir = this.getRepoDir(repoId);
    await rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }

  async deleteByRun(selfImprovementRunId: string): Promise<void> {
    const sessions = await this.findByRun(selfImprovementRunId);
    for (const session of sessions) {
      await this.delete(session.id);
    }
  }
}

/**
 * Create a file-based chat session repository.
 */
export function createFileChatSessionRepository(
  basePath: string
): ChatSessionRepository {
  return new FileChatSessionRepository(basePath);
}
