/**
 * Repository interface for Users.
 */

import type { User, GitHubTokens } from '../../domain/user.js';

/**
 * Repository for managing GitHub-authenticated users.
 */
export interface UserRepository {
  /**
   * Find a user by ID.
   */
  findById(id: string): Promise<User | null>;

  /**
   * Find a user by GitHub ID.
   */
  findByGitHubId(githubId: number): Promise<User | null>;

  /**
   * Find a user by GitHub login.
   */
  findByLogin(login: string): Promise<User | null>;

  /**
   * Get all users.
   */
  findAll(): Promise<User[]>;

  /**
   * Save a user (create or update).
   */
  save(user: User): Promise<void>;

  /**
   * Update a user's OAuth tokens.
   */
  updateTokens(id: string, tokens: GitHubTokens): Promise<void>;

  /**
   * Delete a user by ID.
   */
  delete(id: string): Promise<void>;
}
