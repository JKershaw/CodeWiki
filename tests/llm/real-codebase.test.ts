/**
 * Real Codebase Tests - Tests against complex, realistic code.
 *
 * These tests replicate production conditions where the LLM receives
 * complex, large inputs that can cause garbled/malformed responses.
 *
 * The simple test repos in other test files don't trigger these issues
 * because they're too small and simple.
 *
 * Run with: node --import tsx --test tests/llm/real-codebase.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';
import {
  assertNoFallbacks,
  checkParseHealth,
  formatParseHealth,
} from './helpers/parse-assert.js';

describe('Real Codebase Tests', { timeout: 300000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
    ctx = await createLLMTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
    await saveTestRun();
  });

  describe('Complex Codebase Scenarios', () => {
    it('handles directory with many interconnected files', async () => {
      const repoId = 'complex-codebase-test';

      // Create a complex, realistic codebase that mirrors production conditions
      // This is what triggers garbled LLM responses in production
      const files: Record<string, string> = {
        'README.md': '# Complex Service Architecture\n\nA realistic service with multiple layers.',
        'package.json': JSON.stringify({
          name: 'complex-service',
          version: '1.0.0',
          type: 'module',
          dependencies: {
            'express': '^4.18.0',
            'pg': '^8.11.0',
          }
        }, null, 2),
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            strict: true,
          }
        }, null, 2),

        // Domain layer - complex types
        'src/domain/user.ts': `
/**
 * User domain entity with complex validation and business logic.
 * This represents a core business entity with multiple states and behaviors.
 */
export interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  location: string | null;
  website: string | null;
  socialLinks: SocialLinks;
}

export interface SocialLinks {
  twitter?: string;
  github?: string;
  linkedin?: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  emailNotifications: boolean;
  pushNotifications: boolean;
  digestFrequency: 'daily' | 'weekly' | 'never';
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  profile: UserProfile;
  preferences: UserPreferences;
  roles: UserRole[];
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
}

export type UserRole = 'user' | 'admin' | 'moderator' | 'premium';
export type UserStatus = 'active' | 'suspended' | 'deleted' | 'pending_verification';

export class UserEntity {
  constructor(private readonly data: User) {}

  get id(): string { return this.data.id; }
  get email(): string { return this.data.email; }
  get isActive(): boolean { return this.data.status === 'active'; }
  get isAdmin(): boolean { return this.data.roles.includes('admin'); }
  get isPremium(): boolean { return this.data.roles.includes('premium'); }

  canPerformAction(action: string): boolean {
    if (this.data.status !== 'active') return false;
    if (this.isAdmin) return true;
    // Complex permission logic would go here
    return action !== 'admin_action';
  }

  validateEmail(): boolean {
    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    return emailRegex.test(this.data.email);
  }

  toPublicProfile(): Partial<User> {
    return {
      id: this.data.id,
      profile: this.data.profile,
      roles: this.data.roles.filter(r => r !== 'admin'),
    };
  }
}
`,

        'src/domain/post.ts': `
/**
 * Post domain entity representing user-generated content.
 */
import type { User } from './user.js';

export interface PostMetadata {
  readTime: number;
  wordCount: number;
  language: string;
  tags: string[];
  category: string;
}

export interface PostEngagement {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  bookmarks: number;
}

export interface Post {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverImage: string | null;
  metadata: PostMetadata;
  engagement: PostEngagement;
  status: PostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PostStatus = 'draft' | 'published' | 'archived' | 'deleted';

export class PostEntity {
  constructor(private readonly data: Post) {}

  get isPublished(): boolean { return this.data.status === 'published'; }
  get hasEngagement(): boolean {
    return this.data.engagement.views > 0 ||
           this.data.engagement.likes > 0 ||
           this.data.engagement.comments > 0;
  }

  calculateScore(): number {
    const { views, likes, comments, shares, bookmarks } = this.data.engagement;
    return views * 0.1 + likes * 2 + comments * 3 + shares * 5 + bookmarks * 4;
  }

  canBeEditedBy(user: { id: string; roles: string[] }): boolean {
    if (user.id === this.data.authorId) return true;
    if (user.roles.includes('admin')) return true;
    if (user.roles.includes('moderator') && this.data.status !== 'deleted') return true;
    return false;
  }
}
`,

        'src/domain/index.ts': `
export * from './user.js';
export * from './post.js';
`,

        // Repository layer
        'src/repositories/user-repository.ts': `
/**
 * User repository interface and implementation.
 * Handles persistence of user entities with complex querying.
 */
import type { User, UserStatus, UserRole } from '../domain/user.js';

export interface UserQueryOptions {
  status?: UserStatus;
  role?: UserRole;
  emailVerified?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'lastLoginAt' | 'email';
  orderDirection?: 'asc' | 'desc';
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findMany(options: UserQueryOptions): Promise<User[]>;
  count(options: Omit<UserQueryOptions, 'limit' | 'offset' | 'orderBy' | 'orderDirection'>): Promise<number>;
  save(user: User): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async findMany(options: UserQueryOptions): Promise<User[]> {
    let results = Array.from(this.users.values());

    if (options.status) {
      results = results.filter(u => u.status === options.status);
    }
    if (options.role) {
      results = results.filter(u => u.roles.includes(options.role!));
    }
    if (options.emailVerified !== undefined) {
      results = results.filter(u =>
        options.emailVerified ? u.emailVerifiedAt !== null : u.emailVerifiedAt === null
      );
    }
    if (options.search) {
      const search = options.search.toLowerCase();
      results = results.filter(u =>
        u.email.toLowerCase().includes(search) ||
        u.profile.displayName.toLowerCase().includes(search)
      );
    }

    // Apply ordering
    if (options.orderBy) {
      results.sort((a, b) => {
        const aVal = a[options.orderBy!];
        const bVal = b[options.orderBy!];
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return options.orderDirection === 'desc' ? -cmp : cmp;
      });
    }

    // Apply pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async count(options: Omit<UserQueryOptions, 'limit' | 'offset' | 'orderBy' | 'orderDirection'>): Promise<number> {
    const results = await this.findMany(options);
    return results.length;
  }

  async save(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async update(id: string, updates: Partial<User>): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) throw new Error(\`User \${id} not found\`);
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.update(id, { status: 'deleted' });
  }
}
`,

        'src/repositories/post-repository.ts': `
/**
 * Post repository for content management.
 */
import type { Post, PostStatus } from '../domain/post.js';

export interface PostQueryOptions {
  authorId?: string;
  status?: PostStatus;
  category?: string;
  tags?: string[];
  publishedAfter?: Date;
  publishedBefore?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PostRepository {
  findById(id: string): Promise<Post | null>;
  findBySlug(slug: string): Promise<Post | null>;
  findMany(options: PostQueryOptions): Promise<Post[]>;
  save(post: Post): Promise<Post>;
  update(id: string, updates: Partial<Post>): Promise<Post>;
  delete(id: string): Promise<void>;
  incrementViews(id: string): Promise<void>;
}

export class InMemoryPostRepository implements PostRepository {
  private posts = new Map<string, Post>();

  async findById(id: string): Promise<Post | null> {
    return this.posts.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Post | null> {
    for (const post of this.posts.values()) {
      if (post.slug === slug) return post;
    }
    return null;
  }

  async findMany(options: PostQueryOptions): Promise<Post[]> {
    let results = Array.from(this.posts.values());

    if (options.authorId) {
      results = results.filter(p => p.authorId === options.authorId);
    }
    if (options.status) {
      results = results.filter(p => p.status === options.status);
    }
    if (options.category) {
      results = results.filter(p => p.metadata.category === options.category);
    }
    if (options.tags?.length) {
      results = results.filter(p =>
        options.tags!.some(tag => p.metadata.tags.includes(tag))
      );
    }

    return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100));
  }

  async save(post: Post): Promise<Post> {
    this.posts.set(post.id, post);
    return post;
  }

  async update(id: string, updates: Partial<Post>): Promise<Post> {
    const existing = this.posts.get(id);
    if (!existing) throw new Error(\`Post \${id} not found\`);
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.posts.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.posts.delete(id);
  }

  async incrementViews(id: string): Promise<void> {
    const post = this.posts.get(id);
    if (post) {
      post.engagement.views++;
    }
  }
}
`,

        'src/repositories/index.ts': `
export * from './user-repository.js';
export * from './post-repository.js';
`,

        // Service layer
        'src/services/user-service.ts': `
/**
 * User service with business logic orchestration.
 */
import type { User, UserRole, UserStatus } from '../domain/user.js';
import type { UserRepository, UserQueryOptions } from '../repositories/user-repository.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { sendEmail } from '../utils/email.js';
import { generateId } from '../utils/id.js';

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
}

export interface UpdateUserInput {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async createUser(input: CreateUserInput): Promise<User> {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new Error('Email already in use');
    }

    const passwordHash = await hashPassword(input.password);
    const user: User = {
      id: generateId(),
      email: input.email,
      passwordHash,
      profile: {
        displayName: input.displayName,
        avatarUrl: null,
        bio: '',
        location: null,
        website: null,
        socialLinks: {},
      },
      preferences: {
        theme: 'system',
        emailNotifications: true,
        pushNotifications: true,
        digestFrequency: 'weekly',
      },
      roles: ['user'],
      status: 'pending_verification',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      emailVerifiedAt: null,
    };

    await this.userRepo.save(user);
    await sendEmail({
      to: user.email,
      subject: 'Verify your email',
      body: \`Please verify your email by clicking: /verify/\${user.id}\`,
    });

    return user;
  }

  async login(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new Error(\`Account is \${user.status}\`);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    return user;
  }

  async updateProfile(userId: string, updates: UpdateUserInput): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return this.userRepo.update(userId, {
      profile: {
        ...user.profile,
        ...(updates.displayName && { displayName: updates.displayName }),
        ...(updates.bio !== undefined && { bio: updates.bio }),
        ...(updates.avatarUrl !== undefined && { avatarUrl: updates.avatarUrl }),
      },
    });
  }

  async changeRole(userId: string, role: UserRole, add: boolean): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const roles = add
      ? [...new Set([...user.roles, role])]
      : user.roles.filter(r => r !== role);

    return this.userRepo.update(userId, { roles });
  }

  async suspendUser(userId: string): Promise<void> {
    await this.userRepo.update(userId, { status: 'suspended' });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.userRepo.softDelete(userId);
  }
}
`,

        'src/services/index.ts': `
export * from './user-service.js';
`,

        // Utils layer
        'src/utils/crypto.ts': `
/**
 * Cryptographic utilities for password hashing and verification.
 */

export async function hashPassword(password: string): Promise<string> {
  // In production, use bcrypt or argon2
  return \`hashed_\${password}\`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return hash === \`hashed_\${password}\`;
}

export function generateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
`,

        'src/utils/email.ts': `
/**
 * Email utilities for sending notifications.
 */

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  console.log(\`[Email] Sending to \${options.to}: \${options.subject}\`);
  // In production, use SendGrid, SES, etc.
}

export async function sendBulkEmail(recipients: string[], subject: string, body: string): Promise<void> {
  for (const to of recipients) {
    await sendEmail({ to, subject, body });
  }
}
`,

        'src/utils/id.ts': `
/**
 * ID generation utilities.
 */

let counter = 0;

export function generateId(): string {
  counter++;
  return \`id_\${Date.now()}_\${counter}\`;
}

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
`,

        'src/utils/index.ts': `
export * from './crypto.js';
export * from './email.js';
export * from './id.js';
`,

        'src/index.ts': `
export * from './domain/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
export * from './utils/index.js';
`,
      };

      await createTestRepo(ctx, repoId, files);

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Test exploring the full src directory (complex input)
      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Log what happened
      const health = checkParseHealth(result.parseStats);
      console.log(formatParseHealth('Complex codebase exploration', health));

      if (result.removedPaths && result.removedPaths.length > 0) {
        console.log(`\nPaths removed: ${result.removedPaths.join(', ')}`);
      }

      logTestResult('Complex codebase parsing', {
        passed: health.healthy && (result.removedPaths?.length ?? 0) === 0,
        score: health.healthy ? 10 : Math.max(0, 10 - health.fallbacksUsed.length * 2),
        reasoning: health.message,
        improvements: health.fallbacksUsed.length > 0
          ? [`Fallbacks used: ${health.fallbacksUsed.join(', ')}`]
          : [],
      });

      // HARD ASSERTIONS - These SHOULD fail if LLM returns garbled output
      assertNoFallbacks(result.parseStats);
      assert.strictEqual(result.removedPaths?.length ?? 0, 0,
        `Paths were silently removed: ${result.removedPaths?.join(', ')}`);
    });

    it('handles nested directory exploration (like src/services)', async () => {
      // Reuse the complex repo from above - but explore a subdirectory
      const repoId = 'complex-nested-test';

      // Similar complex structure as above but focused on triggering issues
      const files: Record<string, string> = {
        'README.md': '# Services Module',
        'src/services/auth/login-service.ts': `
/**
 * Authentication service handling login flows.
 */
import type { User } from '../../domain/user.js';
import type { UserRepository } from '../../repositories/user-repository.js';
import { verifyPassword } from '../../utils/crypto.js';
import { generateToken } from '../../utils/crypto.js';

export interface LoginResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface LoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export class LoginService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new AuthenticationError(\`Account is \${user.status}\`);
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AuthenticationError('Invalid credentials');
    }

    const accessToken = await this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(user);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (input.rememberMe ? 720 : 24));

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    return { user, accessToken, refreshToken, expiresAt };
  }

  async logout(userId: string, token: string): Promise<void> {
    await this.tokenService.revokeToken(token);
  }

  async refreshTokens(refreshToken: string): Promise<LoginResult> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);
    const user = await this.userRepo.findById(payload.userId);
    if (!user || user.status !== 'active') {
      throw new AuthenticationError('Invalid refresh token');
    }

    const accessToken = await this.tokenService.generateAccessToken(user);
    const newRefreshToken = await this.tokenService.generateRefreshToken(user);

    return {
      user,
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

interface TokenService {
  generateAccessToken(user: User): Promise<string>;
  generateRefreshToken(user: User): Promise<string>;
  verifyRefreshToken(token: string): Promise<{ userId: string }>;
  revokeToken(token: string): Promise<void>;
}
`,

        'src/services/auth/registration-service.ts': `
/**
 * User registration service.
 */
import type { User } from '../../domain/user.js';
import type { UserRepository } from '../../repositories/user-repository.js';
import { hashPassword } from '../../utils/crypto.js';
import { generateId } from '../../utils/id.js';
import { sendEmail } from '../../utils/email.js';

export interface RegistrationInput {
  email: string;
  password: string;
  displayName: string;
  acceptedTerms: boolean;
}

export interface RegistrationResult {
  user: User;
  verificationToken: string;
}

export class RegistrationService {
  constructor(private readonly userRepo: UserRepository) {}

  async register(input: RegistrationInput): Promise<RegistrationResult> {
    if (!input.acceptedTerms) {
      throw new RegistrationError('Must accept terms of service');
    }

    if (!this.isValidEmail(input.email)) {
      throw new RegistrationError('Invalid email address');
    }

    if (!this.isStrongPassword(input.password)) {
      throw new RegistrationError('Password must be at least 8 characters with numbers and symbols');
    }

    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new RegistrationError('Email already registered');
    }

    const passwordHash = await hashPassword(input.password);
    const verificationToken = generateId();

    const user: User = {
      id: generateId(),
      email: input.email,
      passwordHash,
      profile: {
        displayName: input.displayName,
        avatarUrl: null,
        bio: '',
        location: null,
        website: null,
        socialLinks: {},
      },
      preferences: {
        theme: 'system',
        emailNotifications: true,
        pushNotifications: true,
        digestFrequency: 'weekly',
      },
      roles: ['user'],
      status: 'pending_verification',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      emailVerifiedAt: null,
    };

    await this.userRepo.save(user);

    await sendEmail({
      to: user.email,
      subject: 'Verify your email address',
      body: \`Welcome! Please verify your email by clicking: /verify/\${verificationToken}\`,
    });

    return { user, verificationToken };
  }

  async verifyEmail(token: string): Promise<User> {
    // In production, look up token in database
    throw new Error('Not implemented');
  }

  private isValidEmail(email: string): boolean {
    return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
  }

  private isStrongPassword(password: string): boolean {
    return password.length >= 8 &&
           /\\d/.test(password) &&
           /[!@#$%^&*]/.test(password);
  }
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}
`,

        'src/services/auth/index.ts': `
export * from './login-service.js';
export * from './registration-service.js';
`,

        'src/services/content/post-service.ts': `
/**
 * Post management service.
 */
import type { Post, PostStatus } from '../../domain/post.js';
import type { PostRepository, PostQueryOptions } from '../../repositories/post-repository.js';
import { generateId, generateSlug } from '../../utils/id.js';

export interface CreatePostInput {
  authorId: string;
  title: string;
  content: string;
  tags?: string[];
  category?: string;
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
  tags?: string[];
  category?: string;
}

export class PostService {
  constructor(private readonly postRepo: PostRepository) {}

  async createPost(input: CreatePostInput): Promise<Post> {
    const post: Post = {
      id: generateId(),
      authorId: input.authorId,
      title: input.title,
      slug: generateSlug(input.title),
      content: input.content,
      excerpt: this.generateExcerpt(input.content),
      coverImage: null,
      metadata: {
        readTime: this.calculateReadTime(input.content),
        wordCount: this.countWords(input.content),
        language: 'en',
        tags: input.tags ?? [],
        category: input.category ?? 'general',
      },
      engagement: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        bookmarks: 0,
      },
      status: 'draft',
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.postRepo.save(post);
  }

  async publishPost(postId: string): Promise<Post> {
    return this.postRepo.update(postId, {
      status: 'published',
      publishedAt: new Date(),
    });
  }

  async unpublishPost(postId: string): Promise<Post> {
    return this.postRepo.update(postId, {
      status: 'draft',
      publishedAt: null,
    });
  }

  async archivePost(postId: string): Promise<Post> {
    return this.postRepo.update(postId, { status: 'archived' });
  }

  private generateExcerpt(content: string): string {
    return content.substring(0, 200).trim() + '...';
  }

  private calculateReadTime(content: string): number {
    const wordsPerMinute = 200;
    return Math.ceil(this.countWords(content) / wordsPerMinute);
  }

  private countWords(content: string): number {
    return content.split(/\\s+/).filter(Boolean).length;
  }
}
`,

        'src/services/content/index.ts': `
export * from './post-service.js';
`,

        'src/services/index.ts': `
export * from './auth/index.js';
export * from './content/index.js';
`,

        // Add domain and utils stubs so imports work conceptually
        'src/domain/user.ts': `
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  profile: { displayName: string; avatarUrl: string | null; bio: string; location: string | null; website: string | null; socialLinks: object };
  preferences: { theme: string; emailNotifications: boolean; pushNotifications: boolean; digestFrequency: string };
  roles: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
}
`,
        'src/domain/post.ts': `
export interface Post {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverImage: string | null;
  metadata: { readTime: number; wordCount: number; language: string; tags: string[]; category: string };
  engagement: { views: number; likes: number; comments: number; shares: number; bookmarks: number };
  status: PostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type PostStatus = 'draft' | 'published' | 'archived' | 'deleted';
`,
        'src/repositories/user-repository.ts': `export interface UserRepository { findByEmail(email: string): Promise<any>; findById(id: string): Promise<any>; save(user: any): Promise<any>; update(id: string, updates: any): Promise<any>; }`,
        'src/repositories/post-repository.ts': `export interface PostRepository { findById(id: string): Promise<any>; save(post: any): Promise<any>; update(id: string, updates: any): Promise<any>; }`,
        'src/utils/crypto.ts': `export async function hashPassword(p: string) { return 'hash_' + p; } export async function verifyPassword(p: string, h: string) { return h === 'hash_' + p; } export function generateToken() { return 'token'; }`,
        'src/utils/email.ts': `export async function sendEmail(opts: any) { console.log('email:', opts.to); }`,
        'src/utils/id.ts': `let c = 0; export function generateId() { return 'id_' + (++c); } export function generateSlug(t: string) { return t.toLowerCase().replace(/\\s+/g, '-'); }`,
      };

      await createTestRepo(ctx, repoId, files);

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Explore the services directory specifically
      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        agentCtx
      );

      const health = checkParseHealth(result.parseStats);
      console.log(formatParseHealth('Nested services exploration', health));

      if (result.removedPaths && result.removedPaths.length > 0) {
        console.log(`\nPaths removed: ${result.removedPaths.join(', ')}`);
      }

      logTestResult('Nested directory parsing', {
        passed: health.healthy && (result.removedPaths?.length ?? 0) === 0,
        score: health.healthy ? 10 : 5,
        reasoning: health.message,
        improvements: [],
      });

      // HARD ASSERTIONS
      assertNoFallbacks(result.parseStats);
      assert.strictEqual(result.removedPaths?.length ?? 0, 0,
        `Paths were silently removed: ${result.removedPaths?.join(', ')}`);
    });

    it('handles large directory (30+ files) triggering tool-based approach', async () => {
      const repoId = 'large-directory-test';

      // Create 35+ files to exceed MAX_FILES_TO_PREFETCH * 2 (30) threshold
      // This forces the agent to use tool-based approach instead of pre-fetch
      const files: Record<string, string> = {
        'README.md': '# Large Directory Test\n\nThis repo has 35+ files to trigger tool-based exploration.',
        'package.json': JSON.stringify({ name: 'large-test', version: '1.0.0' }, null, 2),
      };

      // Generate 35 handler files - this exceeds the 30 file threshold
      for (let i = 1; i <= 35; i++) {
        files[`src/handlers/handler-${i.toString().padStart(2, '0')}.ts`] = `
/**
 * Handler ${i} - Processes type ${i} requests.
 * Part of the request handling pipeline.
 */
import type { Request, Response } from '../types.js';
import { validateInput } from '../utils/validation.js';
import { logRequest } from '../utils/logging.js';

export interface Handler${i}Input {
  id: string;
  type: 'handler${i}';
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface Handler${i}Output {
  success: boolean;
  handlerId: ${i};
  processedAt: Date;
  result: unknown;
}

export class Handler${i} {
  private readonly handlerId = ${i};

  async handle(req: Request<Handler${i}Input>): Promise<Response<Handler${i}Output>> {
    logRequest(req, 'Handler${i}');

    const validation = validateInput(req.body);
    if (!validation.valid) {
      return {
        status: 400,
        body: {
          success: false,
          handlerId: this.handlerId,
          processedAt: new Date(),
          result: { error: validation.error },
        },
      };
    }

    // Process the request
    const result = await this.process(req.body);

    return {
      status: 200,
      body: {
        success: true,
        handlerId: this.handlerId,
        processedAt: new Date(),
        result,
      },
    };
  }

  private async process(input: Handler${i}Input): Promise<unknown> {
    // Simulate processing
    return { processed: true, inputId: input.id };
  }
}

export function createHandler${i}(): Handler${i} {
  return new Handler${i}();
}
`;
      }

      // Add supporting files
      files['src/types.ts'] = `
export interface Request<T> {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: T;
}

export interface Response<T> {
  status: number;
  headers?: Record<string, string>;
  body: T;
}
`;

      files['src/utils/validation.ts'] = `
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateInput(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Invalid input' };
  }
  return { valid: true };
}
`;

      files['src/utils/logging.ts'] = `
export function logRequest(req: unknown, handler: string): void {
  console.log(\`[\${handler}] Processing request\`);
}
`;

      files['src/utils/index.ts'] = `
export * from './validation.js';
export * from './logging.js';
`;

      files['src/handlers/index.ts'] = `
${Array.from({ length: 35 }, (_, i) =>
  `export { Handler${i + 1}, createHandler${i + 1} } from './handler-${(i + 1).toString().padStart(2, '0')}.js';`
).join('\n')}
`;

      files['src/index.ts'] = `
export * from './types.js';
export * from './utils/index.js';
export * from './handlers/index.js';
`;

      await createTestRepo(ctx, repoId, files);

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      console.log(`\n📁 Created repo with ${Object.keys(files).length} files`);
      console.log('   This should trigger tool-based approach (threshold: 30 files)');

      // Explore the src directory - should trigger tool-based approach
      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      const health = checkParseHealth(result.parseStats);
      console.log(formatParseHealth('Large directory (tool-based)', health));

      // Log detailed metrics
      console.log(`\nTool metrics:`);
      console.log(`  Tool calls: ${result.toolMetrics?.toolCallCount ?? 0}`);
      console.log(`  Files read: ${result.toolMetrics?.filesRead?.length ?? 0}`);

      if (result.parseStats?.fallbacksUsed && result.parseStats.fallbacksUsed.length > 0) {
        console.log(`\n⚠️  Fallbacks triggered:`);
        result.parseStats.fallbacksUsed.forEach(f => console.log(`    - ${f}`));
      }

      if (result.removedPaths && result.removedPaths.length > 0) {
        console.log(`\n⚠️  Paths removed: ${result.removedPaths.length}`);
        console.log(`    ${result.removedPaths.slice(0, 10).join(', ')}${result.removedPaths.length > 10 ? '...' : ''}`);
      }

      logTestResult('Large directory parsing (tool-based)', {
        passed: health.healthy && (result.removedPaths?.length ?? 0) === 0,
        score: health.healthy ? 10 : Math.max(0, 10 - health.fallbacksUsed.length * 2),
        reasoning: `Tool calls: ${result.toolMetrics?.toolCallCount ?? 0}, Fallbacks: ${health.fallbacksUsed.length}, Removed: ${result.removedPaths?.length ?? 0}`,
        improvements: [
          ...health.fallbacksUsed.map(f => `Fallback: ${f}`),
          ...(result.removedPaths?.length ? [`${result.removedPaths.length} paths removed`] : []),
        ],
      });

      // HARD ASSERTIONS - These SHOULD fail with tool-based approach
      assertNoFallbacks(result.parseStats);
      assert.strictEqual(result.removedPaths?.length ?? 0, 0,
        `Paths were silently removed: ${result.removedPaths?.join(', ')}`);
    });
  });
});
