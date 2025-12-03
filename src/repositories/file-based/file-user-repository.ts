/**
 * File-based implementation of UserRepository.
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { UserRepository } from '../interfaces/user-repository.js';
import type { User, GitHubTokens } from '../../domain/user.js';

/**
 * File-based user repository.
 * Stores users as JSON files in a users directory.
 */
export class FileUserRepository implements UserRepository {
  constructor(private readonly basePath: string) {}

  /**
   * Get the directory path for users.
   */
  private getUsersDir(): string {
    return join(this.basePath, 'users');
  }

  /**
   * Get the file path for a specific user.
   */
  private getUserPath(id: string): string {
    return join(this.getUsersDir(), `${id}.json`);
  }

  /**
   * Ensure the directory exists.
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.getUsersDir(), { recursive: true });
  }

  /**
   * Serialize a user for storage.
   */
  private serialize(user: User): string {
    return JSON.stringify(user, null, 2);
  }

  /**
   * Deserialize a user from storage.
   */
  private deserialize(data: string): User {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastLoginAt: new Date(parsed.lastLoginAt),
      tokenExpiresAt: new Date(parsed.tokenExpiresAt),
    };
  }

  /**
   * Read all users from the directory.
   */
  private async readAll(): Promise<User[]> {
    try {
      const usersDir = this.getUsersDir();
      const files = await readdir(usersDir).catch(() => []);
      const users: User[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(usersDir, file), 'utf-8');
          users.push(this.deserialize(data));
        } catch {
          // Skip invalid files
        }
      }

      return users;
    } catch {
      return [];
    }
  }

  async findById(id: string): Promise<User | null> {
    try {
      const userPath = this.getUserPath(id);
      const data = await readFile(userPath, 'utf-8');
      return this.deserialize(data);
    } catch {
      return null;
    }
  }

  async findByGitHubId(githubId: number): Promise<User | null> {
    const users = await this.readAll();
    return users.find(u => u.githubId === githubId) ?? null;
  }

  async findByLogin(login: string): Promise<User | null> {
    const users = await this.readAll();
    return users.find(u => u.login === login) ?? null;
  }

  async findAll(): Promise<User[]> {
    const users = await this.readAll();
    // Sort by createdAt descending (newest first)
    users.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return users;
  }

  async save(user: User): Promise<void> {
    await this.ensureDir();
    const userPath = this.getUserPath(user.id);
    await writeFile(userPath, this.serialize(user), 'utf-8');
  }

  async updateTokens(id: string, tokens: GitHubTokens): Promise<void> {
    const user = await this.findById(id);
    if (!user) return;

    user.accessToken = tokens.accessToken;
    user.refreshToken = tokens.refreshToken;
    user.tokenExpiresAt = tokens.tokenExpiresAt;
    user.lastLoginAt = new Date();

    await this.save(user);
  }

  async delete(id: string): Promise<void> {
    const userPath = this.getUserPath(id);
    await unlink(userPath).catch(() => {});
  }
}

/**
 * Create a file-based user repository.
 */
export function createFileUserRepository(basePath: string): UserRepository {
  return new FileUserRepository(basePath);
}
