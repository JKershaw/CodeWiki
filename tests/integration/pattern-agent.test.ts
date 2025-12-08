/**
 * Integration tests for PatternAgent.
 * Tests the agent that identifies design patterns and anti-patterns in commits.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { PatternAgent } from '../../src/agents/analysis/pattern-agent.js';
import { patternAgentResponses } from '../fixtures/agent-responses.js';
import { createCommitTarget } from '../../src/domain/work-target.js';

describe('PatternAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    ctx.llm.reset();
  });

  describe('run', () => {
    it('detects Repository pattern implementation', async () => {
      const repoId = 'pattern-repository';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Repository Pattern Project',
      });

      // Add a commit implementing the Repository pattern
      const commitSha = await addCommit(ctx, repoId, {
        'src/repositories/base-repository.ts': `
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
  findAll(): Promise<T[]>;
}

export abstract class BaseRepository<T> implements Repository<T> {
  abstract findById(id: string): Promise<T | null>;
  abstract save(entity: T): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract findAll(): Promise<T[]>;
}
`,
        'src/repositories/user-repository.ts': `
import { BaseRepository } from './base-repository';
import { User } from '../domain/user';

export class UserRepository extends BaseRepository<User> {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }
}
`,
        'src/domain/user.ts': `
export interface User {
  id: string;
  name: string;
  email: string;
}
`,
      }, 'Implement Repository pattern for data access');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Implement Repository pattern for data access',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 3,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 40,
          linesDeleted: 0,
          affectedFiles: [
            'src/repositories/base-repository.ts',
            'src/repositories/user-repository.ts',
            'src/domain/user.ts',
          ],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(patternAgentResponses.repositoryPatternDetected(commitSha));

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify the Repository pattern
      const patternFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('pattern') ||
        f.description.toLowerCase().includes('repository')
      );
      assert.ok(patternFinding, 'Should identify Repository pattern');

      // Should create wiki page for the pattern
      assert.ok(result.updates.length > 0, 'Should create wiki updates for patterns');

      // Pattern page should be in patterns/ category
      const patternPage = result.updates.find(u => u.path.includes('patterns/'));
      assert.ok(patternPage, 'Should create page in patterns/ category');

      // Should have good confidence for clear pattern
      assert.ok(result.result.confidence >= 0.7, 'Should have good confidence for clear pattern');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('detects Factory pattern implementation', async () => {
      const repoId = 'pattern-factory';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Factory Pattern Project',
      });

      // Add a commit implementing the Factory pattern
      const commitSha = await addCommit(ctx, repoId, {
        'src/factories/service-factory.ts': `
import { MemoryService } from '../services/memory-service';
import { DatabaseService } from '../services/database-service';

export type ServiceType = 'memory' | 'database';

export interface Service {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function createService(type: ServiceType): Service {
  switch (type) {
    case 'memory':
      return new MemoryService();
    case 'database':
      return new DatabaseService();
    default:
      throw new Error(\`Unknown service type: \${type}\`);
  }
}
`,
        'src/services/memory-service.ts': `
export class MemoryService {
  private store = new Map<string, string>();

  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
}
`,
        'src/services/database-service.ts': `
export class DatabaseService {
  async get(key: string) { /* DB lookup */ return null; }
  async set(key: string, value: string) { /* DB write */ }
}
`,
      }, 'Add service factory for flexible service creation');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add service factory for flexible service creation',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 3,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 35,
          linesDeleted: 0,
          affectedFiles: [
            'src/factories/service-factory.ts',
            'src/services/memory-service.ts',
            'src/services/database-service.ts',
          ],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(patternAgentResponses.factoryPatternDetected(commitSha));

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify Factory pattern
      const factoryFinding = result.result.findings.find(f =>
        f.description.toLowerCase().includes('factory')
      );
      assert.ok(factoryFinding, 'Should identify Factory pattern');

      // Should create wiki documentation
      assert.ok(result.updates.length > 0, 'Should create wiki pages for Factory pattern');
    });

    it('detects anti-patterns like God class', async () => {
      const repoId = 'pattern-antipattern';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Anti-pattern Detection',
      });

      // Add a commit with a God class anti-pattern
      const commitSha = await addCommit(ctx, repoId, {
        'src/app-manager.ts': `
// This class does too many things!
export class AppManager {
  private db: any;
  private cache: any;
  private auth: any;
  private users: Map<string, any> = new Map();
  private orders: Map<string, any> = new Map();
  private sessions: Map<string, any> = new Map();

  // Database operations
  connectToDatabase() { /* ... */ }
  queryDatabase(sql: string) { /* ... */ }
  migrateDatabase() { /* ... */ }

  // Cache operations
  initCache() { /* ... */ }
  getFromCache(key: string) { /* ... */ }
  setInCache(key: string, value: any) { /* ... */ }

  // Authentication
  login(username: string, password: string) { /* ... */ }
  logout(sessionId: string) { /* ... */ }
  validateToken(token: string) { /* ... */ }

  // User management
  createUser(data: any) { /* ... */ }
  updateUser(id: string, data: any) { /* ... */ }
  deleteUser(id: string) { /* ... */ }

  // Order management
  createOrder(data: any) { /* ... */ }
  processOrder(id: string) { /* ... */ }
  cancelOrder(id: string) { /* ... */ }

  // Email operations
  sendEmail(to: string, subject: string, body: string) { /* ... */ }
  sendBulkEmail(recipients: string[], template: string) { /* ... */ }
}
`,
      }, 'Add application manager');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add application manager',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 45,
          linesDeleted: 0,
          affectedFiles: ['src/app-manager.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(patternAgentResponses.antiPatternDetected(commitSha));

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify anti-pattern with high importance
      const antiPatternFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('anti-pattern') ||
        f.description.toLowerCase().includes('god')
      );
      assert.ok(antiPatternFinding, 'Should identify God class anti-pattern');
      assert.strictEqual(antiPatternFinding!.importance, 'high', 'Anti-pattern should be high importance');

      // Should document the anti-pattern
      const antiPatternPage = result.updates.find(u =>
        u.path.includes('anti-pattern') || u.content.toLowerCase().includes('anti-pattern')
      );
      assert.ok(antiPatternPage, 'Should create documentation for anti-pattern');
    });

    it('handles commits with no notable patterns', async () => {
      const repoId = 'pattern-none';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Simple Project',
      });

      // Add a commit with simple utility code
      const commitSha = await addCommit(ctx, repoId, {
        'src/utils/format.ts': `
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2);
}
`,
      }, 'Add formatting utilities');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add formatting utilities',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 0,
          affectedFiles: ['src/utils/format.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(patternAgentResponses.noPatternsFound());

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should have minimal or no findings
      assert.ok(result.result.findings.length <= 1, 'Should have minimal findings for simple code');

      // Should not create pattern pages
      const patternPages = result.updates.filter(u => u.path.startsWith('patterns/'));
      assert.strictEqual(patternPages.length, 0, 'Should not create pattern pages for simple utilities');
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'pattern-nonexistent';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await assert.rejects(
        async () => agent.run(createCommitTarget('nonexistent-commit-id'), agentCtx),
        /not found/i,
        'Should throw error for non-existent commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new PatternAgent();
      assert.strictEqual(agent.type, 'pattern', 'Agent type should be pattern');
    });

    it('can handle commit targets', () => {
      const agent = new PatternAgent();
      assert.ok(agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should handle commit targets');
    });

    it('cannot handle wiki targets', () => {
      const agent = new PatternAgent();
      assert.ok(!agent.canHandle({ type: 'wiki' }), 'Should not handle wiki targets');
    });
  });
});
