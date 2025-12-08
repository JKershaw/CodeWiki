/**
 * Real LLM tests for GraderAgent.
 *
 * These tests establish baselines for grading quality before optimization.
 * The GraderAgent evaluates wiki answers against actual code by using
 * tool calls to read files and verify claims.
 *
 * Run with: node --import tsx --test tests/llm/grader-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { createGraderAgent, type GradeContext } from '../../src/benchmark/grader-agent.js';
import type { BenchmarkQuestion } from '../../src/domain/benchmark.js';
import { createUnifiedRepoAccessFactory } from '../../src/services/repository/unified-repo-access.js';
import { createRepositoryServiceFactory } from '../../src/services/repository/repository-service.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  assertLLM,
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';

describe('GraderAgent with Real LLM', { timeout: 180000 }, () => {
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

  /**
   * Helper to create grade context for a repo.
   */
  async function createGradeContext(repoId: string): Promise<GradeContext> {
    const repoServiceFactory = createRepositoryServiceFactory({ gitService: ctx.git });
    const repoAccessFactory = createUnifiedRepoAccessFactory({
      repos: ctx.repos,
      repoServiceFactory,
      gitService: ctx.git,
    });
    const repoAccess = await repoAccessFactory.create(repoId);
    return { repoAccess };
  }

  describe('Grading Accuracy', () => {
    it('grades correct answer as accurate', async () => {
      const repoId = 'llm-grader-correct';

      // Create repo with auth code that has specific token expiration
      await createTestRepo(ctx, repoId, {
        'README.md': '# Auth Service',
        'src/auth/config.ts': `
export const AUTH_CONFIG = {
  accessTokenExpiresIn: '15 minutes',
  refreshTokenExpiresIn: '7 days',
  algorithm: 'RS256',
  issuer: 'my-app',
};
`,
        'src/auth/jwt.ts': `
import { AUTH_CONFIG } from './config.js';
import jwt from 'jsonwebtoken';

export function createAccessToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: AUTH_CONFIG.accessTokenExpiresIn,
    algorithm: AUTH_CONFIG.algorithm,
  });
}

export function createRefreshToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: AUTH_CONFIG.refreshTokenExpiresIn,
  });
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'auth-token-expiry',
        question: 'How long do access tokens last before expiring?',
        category: 'architecture',
        difficulty: 'easy',
        verificationHints: ['src/auth/config.ts', 'src/auth/jwt.ts'],
      };

      // Correct answer that matches the code
      const wikiAnswer = 'Access tokens expire after 15 minutes. This is configured in the AUTH_CONFIG in src/auth/config.ts.';

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade result: ${result.grade}, confidence: ${result.confidence}`);
      console.log(`Reasoning: ${result.reasoning.substring(0, 200)}...`);
      console.log(`Files checked: ${result.filesChecked.join(', ')}`);

      // Deterministic check: Should be accurate or partial (not inaccurate)
      assert.ok(
        result.grade === 'accurate' || result.grade === 'partial',
        `Expected accurate or partial grade for correct answer, got: ${result.grade}`
      );

      // LLM-as-judge: Verify grading quality
      const evalResult = await evaluateLLM(
        'The grader correctly identifies this as an accurate answer since the wiki ' +
        'states "Access tokens expire after 15 minutes" which matches AUTH_CONFIG.accessTokenExpiresIn.',
        JSON.stringify({ grade: result.grade, reasoning: result.reasoning, filesChecked: result.filesChecked }, null, 2),
        7
      );

      logTestResult('Correct answer grading', evalResult);
      console.log(formatEvaluationResult('Correct answer grading', evalResult));

      // Should have checked the verification hint files
      assert.ok(result.filesChecked.length > 0, 'Grader should have checked files');
    });

    it('grades partial answer appropriately', async () => {
      const repoId = 'llm-grader-partial';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Database Service',
        'src/db/config.ts': `
export const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  poolSize: 10,
  connectionTimeout: 30000,
  idleTimeout: 10000,
};
`,
        'src/db/connection.ts': `
import { Pool } from 'pg';
import { DB_CONFIG } from './config.js';

const pool = new Pool({
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  database: DB_CONFIG.database,
  max: DB_CONFIG.poolSize,
  connectionTimeoutMillis: DB_CONFIG.connectionTimeout,
  idleTimeoutMillis: DB_CONFIG.idleTimeout,
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'db-config',
        question: 'What database configuration options are used?',
        category: 'architecture',
        difficulty: 'medium',
        verificationHints: ['src/db/config.ts'],
      };

      // Partial answer - mentions some but not all config options
      const wikiAnswer = 'The database uses PostgreSQL running on localhost port 5432 with a pool size of 10 connections.';

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade result: ${result.grade}, confidence: ${result.confidence}`);
      console.log(`Reasoning: ${result.reasoning.substring(0, 200)}...`);

      // LLM-as-judge: Verify the grader recognizes this as partial
      const evalResult = await evaluateLLM(
        'The grader recognizes that the answer is partially correct: it correctly mentions ' +
        'localhost, port 5432, and pool size of 10, but misses details like connection timeout ' +
        'and idle timeout. The grade should be "partial" rather than "accurate" or "inaccurate".',
        JSON.stringify({ grade: result.grade, reasoning: result.reasoning }, null, 2),
        6
      );

      logTestResult('Partial answer grading', evalResult);
      console.log(formatEvaluationResult('Partial answer grading', evalResult));
    });

    it('grades incorrect answer as inaccurate', async () => {
      const repoId = 'llm-grader-incorrect';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Cache Service',
        'src/cache/config.ts': `
export const CACHE_CONFIG = {
  provider: 'redis',
  host: 'localhost',
  port: 6379,
  ttlSeconds: 3600,  // 1 hour default
  maxSize: 1000,
};
`,
        'src/cache/redis.ts': `
import Redis from 'ioredis';
import { CACHE_CONFIG } from './config.js';

const client = new Redis({
  host: CACHE_CONFIG.host,
  port: CACHE_CONFIG.port,
});

export async function set(key: string, value: string, ttl?: number): Promise<void> {
  const expiry = ttl ?? CACHE_CONFIG.ttlSeconds;
  await client.setex(key, expiry, value);
}

export async function get(key: string): Promise<string | null> {
  return client.get(key);
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'cache-ttl',
        question: 'What is the default cache TTL?',
        category: 'architecture',
        difficulty: 'easy',
        verificationHints: ['src/cache/config.ts'],
      };

      // Incorrect answer - wrong TTL value
      const wikiAnswer = 'The default cache TTL is 24 hours (86400 seconds). This provides long-term caching for frequently accessed data.';

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade result: ${result.grade}, confidence: ${result.confidence}`);
      console.log(`Reasoning: ${result.reasoning.substring(0, 200)}...`);

      // Deterministic check: Should not be accurate
      assert.ok(
        result.grade === 'inaccurate' || result.grade === 'partial',
        `Expected inaccurate or partial for wrong answer, got: ${result.grade}`
      );

      // LLM-as-judge: Verify the grader catches the incorrect value
      const evalResult = await evaluateLLM(
        'The grader correctly identifies the answer as inaccurate because the wiki claims ' +
        'the TTL is 24 hours (86400 seconds) but the code shows ttlSeconds: 3600 (1 hour).',
        JSON.stringify({ grade: result.grade, reasoning: result.reasoning, filesChecked: result.filesChecked }, null, 2),
        7
      );

      logTestResult('Incorrect answer grading', evalResult);
      console.log(formatEvaluationResult('Incorrect answer grading', evalResult));
    });

    it('grades no_answer when wiki admits lack of information', async () => {
      const repoId = 'llm-grader-no-answer';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Service',
        'src/api/rate-limit.ts': `
export const RATE_LIMIT_CONFIG = {
  windowMs: 60000,  // 1 minute
  maxRequests: 100,
  message: 'Too many requests',
};

export function rateLimiter(req: any, res: any, next: any) {
  // Rate limiting implementation
  next();
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'rate-limit',
        question: 'What is the API rate limit?',
        category: 'architecture',
        difficulty: 'easy',
        verificationHints: ['src/api/rate-limit.ts'],
      };

      // Wiki admits it doesn't have this information
      const wikiAnswer = "I don't have documentation about the API rate limits. This information is not available in the current wiki.";

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade result: ${result.grade}, confidence: ${result.confidence}`);
      console.log(`Reasoning: ${result.reasoning.substring(0, 200)}...`);

      // LLM-as-judge: Verify the grader marks this as no_answer
      const evalResult = await evaluateLLM(
        'The grader correctly identifies this as "no_answer" because the wiki explicitly ' +
        'states it does not have the information. The code clearly shows rate limit is ' +
        '100 requests per minute, so the wiki has a knowledge gap.',
        JSON.stringify({ grade: result.grade, reasoning: result.reasoning }, null, 2),
        6
      );

      logTestResult('No answer grading', evalResult);
      console.log(formatEvaluationResult('No answer grading', evalResult));
    });
  });

  describe('Verification File Usage', () => {
    it('uses verification hints to check claims', async () => {
      const repoId = 'llm-grader-hints';

      await createTestRepo(ctx, repoId, {
        'README.md': '# User Service',
        'src/users/validation.ts': `
export const VALIDATION_RULES = {
  username: {
    minLength: 3,
    maxLength: 20,
    pattern: /^[a-zA-Z0-9_]+$/,
  },
  email: {
    pattern: /^[^@]+@[^@]+\\.[^@]+$/,
  },
  password: {
    minLength: 8,
    requireUppercase: true,
    requireNumber: true,
    requireSpecial: true,
  },
};
`,
        'src/users/user-service.ts': `
import { VALIDATION_RULES } from './validation.js';

export function validateUsername(username: string): boolean {
  const rules = VALIDATION_RULES.username;
  if (username.length < rules.minLength) return false;
  if (username.length > rules.maxLength) return false;
  return rules.pattern.test(username);
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'username-validation',
        question: 'What are the username validation requirements?',
        category: 'conventions',
        difficulty: 'medium',
        verificationHints: ['src/users/validation.ts'],
      };

      // Accurate answer based on the code
      const wikiAnswer = 'Usernames must be between 3 and 20 characters and can only contain alphanumeric characters and underscores.';

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade result: ${result.grade}, confidence: ${result.confidence}`);
      console.log(`Files checked: ${result.filesChecked.join(', ')}`);

      // The grader should have used the verification hints
      const hintFileChecked = result.filesChecked.some(f =>
        f.includes('validation') || f.includes('src/users')
      );

      // LLM-as-judge: Verify the grader properly used verification files
      const evalResult = await evaluateLLM(
        'The grader checked the verification hint files (src/users/validation.ts) to verify ' +
        'the wiki answer. It should have read the VALIDATION_RULES to confirm username requirements.',
        JSON.stringify({
          filesChecked: result.filesChecked,
          grade: result.grade,
          reasoning: result.reasoning,
        }, null, 2),
        6
      );

      logTestResult('Verification hints usage', evalResult);
      console.log(formatEvaluationResult('Verification hints usage', evalResult));

      if (!hintFileChecked) {
        console.log('Warning: Grader may not have used verification hints');
      }
    });
  });

  describe('Reasoning Quality', () => {
    it('provides accurate reasoning that references code', async () => {
      const repoId = 'llm-grader-reasoning';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Logger Service',
        'src/logger/config.ts': `
export const LOGGER_CONFIG = {
  level: 'info',
  format: 'json',
  destination: 'stdout',
  includeTimestamp: true,
  includeRequestId: true,
};
`,
        'src/logger/logger.ts': `
import { LOGGER_CONFIG } from './config.js';

export function log(level: string, message: string, meta?: object): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: LOGGER_CONFIG.includeTimestamp ? new Date().toISOString() : undefined,
    level,
    message,
    ...meta,
  };

  if (LOGGER_CONFIG.format === 'json') {
    console.log(JSON.stringify(entry));
  } else {
    console.log(\`[\${level}] \${message}\`);
  }
}

function shouldLog(level: string): boolean {
  const levels = ['debug', 'info', 'warn', 'error'];
  return levels.indexOf(level) >= levels.indexOf(LOGGER_CONFIG.level);
}
`,
      });

      const question: BenchmarkQuestion = {
        id: 'log-format',
        question: 'What format does the logger use?',
        category: 'architecture',
        difficulty: 'easy',
        verificationHints: ['src/logger/config.ts'],
      };

      const wikiAnswer = 'The logger uses JSON format for log entries.';

      const gradeCtx = await createGradeContext(repoId);
      const grader = createGraderAgent(ctx.llm);
      const result = await grader.grade(question, wikiAnswer, gradeCtx);

      console.log(`Grade: ${result.grade}`);
      console.log(`Full reasoning: ${result.reasoning}`);

      // LLM-as-judge: Verify the reasoning quality
      const evalResult = await assertLLM(
        'The grading reasoning is clear, references the actual code (LOGGER_CONFIG.format or logger/config.ts), ' +
        'and explains WHY the grade was given. It should mention that format: "json" matches the wiki answer.',
        result.reasoning,
        7
      );

      logTestResult('Reasoning quality', evalResult);
      console.log(formatEvaluationResult('Reasoning quality', evalResult));
    });
  });
});
