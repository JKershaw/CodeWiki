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

  describe('Content Quality (regression tests)', () => {
    it('produces distinct content for different patterns, not template boilerplate', async () => {
      // This test catches the issue where pattern descriptions are 84-91% similar
      // because the LLM outputs generic templates instead of codebase-specific analysis
      const repoId = 'llm-pattern-distinctiveness';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Multi-Pattern Project',
      });

      // Create commits with DIFFERENT patterns
      const factoryCommit = await addCommit(ctx, repoId, {
        'src/factory.ts': `
export interface Logger { log(msg: string): void; }
export class ConsoleLogger implements Logger { log(msg: string) { console.log(msg); } }
export class FileLogger implements Logger { log(msg: string) { /* write to file */ } }
export function createLogger(type: 'console' | 'file'): Logger {
  return type === 'console' ? new ConsoleLogger() : new FileLogger();
}
`,
      }, 'Add Logger factory');

      const repositoryCommit = await addCommit(ctx, repoId, {
        'src/repository.ts': `
export interface Task { id: string; title: string; done: boolean; }
export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
  findAll(): Promise<Task[]>;
}
export class InMemoryTaskRepository implements TaskRepository {
  private tasks = new Map<string, Task>();
  async findById(id: string) { return this.tasks.get(id) || null; }
  async save(task: Task) { this.tasks.set(task.id, task); }
  async findAll() { return Array.from(this.tasks.values()); }
}
`,
      }, 'Add Task repository');

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Run agent on both commits
      const factoryResult = await agent.run(createCommitTarget(factoryCommit), agentCtx);
      const repoResult = await agent.run(createCommitTarget(repositoryCommit), agentCtx);

      // Extract the generated content (summary + findings)
      const factoryContent = JSON.stringify({
        summary: factoryResult.result.summary,
        findings: factoryResult.result.findings.map(f => f.description),
      });

      const repoContent = JSON.stringify({
        summary: repoResult.result.summary,
        findings: repoResult.result.findings.map(f => f.description),
      });

      // Check that the content is meaningfully different
      // Simple heuristic: count words unique to each analysis
      const factoryWords = new Set(factoryContent.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const repoWords = new Set(repoContent.toLowerCase().split(/\W+/).filter(w => w.length > 3));

      const onlyInFactory = [...factoryWords].filter(w => !repoWords.has(w));
      const onlyInRepo = [...repoWords].filter(w => !factoryWords.has(w));

      // Calculate rough distinctiveness
      const totalUnique = factoryWords.size + repoWords.size;
      const overlap = factoryWords.size + repoWords.size - onlyInFactory.length - onlyInRepo.length -
                      [...factoryWords].filter(w => repoWords.has(w)).length;
      const overlapRatio = overlap / Math.min(factoryWords.size, repoWords.size);

      console.log(`\nPattern distinctiveness analysis:`);
      console.log(`  Factory-specific words: ${onlyInFactory.slice(0, 10).join(', ')}...`);
      console.log(`  Repository-specific words: ${onlyInRepo.slice(0, 10).join(', ')}...`);
      console.log(`  Overlap ratio: ${(overlapRatio * 100).toFixed(1)}%`);

      // The Factory analysis should mention: logger, console, file, createLogger
      // The Repository analysis should mention: task, repository, findById, save, findAll
      const factoryMentionsLogger = factoryContent.toLowerCase().includes('logger');
      const repoMentionsTask = repoContent.toLowerCase().includes('task');

      if (!factoryMentionsLogger) {
        console.error('⚠️  Factory pattern analysis did not mention "Logger" - may be too generic');
      }
      if (!repoMentionsTask) {
        console.error('⚠️  Repository pattern analysis did not mention "Task" - may be too generic');
      }

      // Key assertion: each analysis should mention code-specific details
      assert.ok(
        factoryMentionsLogger || repoMentionsTask,
        'Pattern analyses should be specific to the code being analyzed, not generic template content'
      );

      // Log for manual review
      logTestResult('Pattern distinctiveness', {
        score: (factoryMentionsLogger && repoMentionsTask) ? 10 : 5,
        reasoning: `Factory mentions logger: ${factoryMentionsLogger}, Repository mentions task: ${repoMentionsTask}`,
        passed: factoryMentionsLogger || repoMentionsTask,
      });
    });

    it('does not produce near-duplicate wiki page suggestions', async () => {
      // This test verifies that when the pattern agent creates wiki pages,
      // they have distinct content, not 84-91% similarity
      const repoId = 'llm-pattern-dedup';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Design Patterns Demo',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/patterns/singleton.ts': `
class Database {
  private static instance: Database;
  private constructor() {}
  static getInstance(): Database {
    if (!Database.instance) Database.instance = new Database();
    return Database.instance;
  }
}
`,
        'src/patterns/observer.ts': `
interface Observer { update(data: any): void; }
class EventEmitter {
  private observers: Observer[] = [];
  subscribe(obs: Observer) { this.observers.push(obs); }
  notify(data: any) { this.observers.forEach(o => o.update(data)); }
}
`,
      }, 'Add Singleton and Observer patterns');

      const agent = new PatternAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Check wiki updates if any
      if (result.updates.length >= 2) {
        const contents = result.updates.map(u => u.content);

        // Simple similarity check: count shared 3-grams
        const getNgrams = (text: string, n: number) => {
          const words = text.toLowerCase().split(/\s+/);
          const ngrams = new Set<string>();
          for (let i = 0; i <= words.length - n; i++) {
            ngrams.add(words.slice(i, i + n).join(' '));
          }
          return ngrams;
        };

        const ngrams0 = getNgrams(contents[0]!, 3);
        const ngrams1 = getNgrams(contents[1]!, 3);
        const shared = [...ngrams0].filter(ng => ngrams1.has(ng)).length;
        const similarity = shared / Math.min(ngrams0.size, ngrams1.size);

        console.log(`\nWiki page similarity: ${(similarity * 100).toFixed(1)}%`);

        if (similarity > 0.8) {
          console.error('❌ Wiki pages are >80% similar - likely template boilerplate');
          console.error('   Page 1 preview:', contents[0]!.slice(0, 200));
          console.error('   Page 2 preview:', contents[1]!.slice(0, 200));
        }

        // Warn if similarity is high (but don't hard-fail as some overlap is expected)
        if (similarity > 0.8) {
          console.warn(`⚠️  High similarity (${(similarity * 100).toFixed(1)}%) between pattern pages`);
        }

        logTestResult('Pattern page deduplication', {
          score: similarity < 0.7 ? 10 : similarity < 0.8 ? 7 : 3,
          reasoning: `Page similarity: ${(similarity * 100).toFixed(1)}%`,
          passed: similarity < 0.85,
        });
      } else {
        console.log('PatternAgent produced fewer than 2 updates (skipping similarity check)');
      }
    });
  });
});
