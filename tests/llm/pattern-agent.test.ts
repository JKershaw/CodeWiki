/**
 * Real LLM tests for PatternAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent detects design patterns (Repository, Factory, etc.)
 * 3. Agent identifies coding conventions
 *
 * Run with: node --import tsx --test tests/llm/pattern-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { PatternAgent } from '../../src/agents/analysis/pattern-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  assertLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';

describe('PatternAgent with Real LLM', { timeout: 120000 }, () => {
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

  describe('Format Compliance', () => {
    it('returns parseable response structure', async () => {
      const repoId = 'llm-pattern-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/utils.ts': `
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
      }, 'Add utility function');

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Detection Accuracy', () => {
    it('detects Repository pattern', async () => {
      const repoId = 'llm-pattern-repository';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Data Access Layer Project',
      });

      // Add commit with clear Repository pattern
      const commitSha = await addCommit(ctx, repoId, {
        'src/repositories/user-repository.ts': `
import { Database } from '../database';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
}

export class PostgresUserRepository implements UserRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<User | null> {
    const result = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  async findAll(): Promise<User[]> {
    const result = await this.db.query('SELECT * FROM users');
    return result.rows;
  }

  async save(user: User): Promise<User> {
    const result = await this.db.query(
      'INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET email = $2, name = $3 RETURNING *',
      [user.id, user.email, user.name, user.createdAt]
    );
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = $1', [id]);
  }
}
`,
      }, 'Add UserRepository with CRUD operations');

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify Repository pattern detection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
      }, null, 2);

      const evalResult = await assertLLM(
        'The pattern analysis identifies a Repository pattern in the code. ' +
        'It should recognize the interface defining data access methods (findById, save, delete) ' +
        'and the concrete implementation that encapsulates database operations.',
        analysisText,
        7
      );

      logTestResult('Repository pattern detection', evalResult);
      console.log(formatEvaluationResult('Repository pattern detection', evalResult));
    });

    it('detects Factory pattern', async () => {
      const repoId = 'llm-pattern-factory';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Notification System',
      });

      // Add commit with Factory pattern
      const commitSha = await addCommit(ctx, repoId, {
        'src/notifications/notification-factory.ts': `
export interface Notification {
  send(to: string, message: string): Promise<void>;
}

export class EmailNotification implements Notification {
  async send(to: string, message: string): Promise<void> {
    console.log(\`Sending email to \${to}: \${message}\`);
  }
}

export class SMSNotification implements Notification {
  async send(to: string, message: string): Promise<void> {
    console.log(\`Sending SMS to \${to}: \${message}\`);
  }
}

export class PushNotification implements Notification {
  async send(to: string, message: string): Promise<void> {
    console.log(\`Sending push notification to \${to}: \${message}\`);
  }
}

export type NotificationType = 'email' | 'sms' | 'push';

export class NotificationFactory {
  static create(type: NotificationType): Notification {
    switch (type) {
      case 'email':
        return new EmailNotification();
      case 'sms':
        return new SMSNotification();
      case 'push':
        return new PushNotification();
      default:
        throw new Error(\`Unknown notification type: \${type}\`);
    }
  }
}
`,
      }, 'Add NotificationFactory for creating notification instances');

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify Factory pattern detection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The pattern analysis identifies a Factory pattern in the code. ' +
        'It should recognize the factory method that creates different notification types ' +
        'based on input, returning objects that implement a common interface.',
        analysisText,
        7
      );

      logTestResult('Factory pattern detection', evalResult);
      console.log(formatEvaluationResult('Factory pattern detection', evalResult));
    });
  });
});
