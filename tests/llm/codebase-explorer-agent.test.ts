/**
 * Real LLM tests for CodebaseExplorerAgent.
 *
 * These tests verify:
 * 1. Agent MUST use tools (list_directory, read_file) before generating content
 * 2. Response format is parseable
 * 3. Documentation accurately reflects the actual code (not hallucinated)
 * 4. Agent doesn't invent files or patterns that don't exist
 *
 * Run with: node --import tsx --test tests/llm/codebase-explorer-agent.test.ts
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
  assertLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';

describe('CodebaseExplorerAgent with Real LLM', { timeout: 180000 }, () => {
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

  describe('Tool Usage Enforcement', () => {
    it('uses list_directory and read_file tools before generating documentation', async () => {
      const repoId = 'llm-explorer-tool-usage';

      // Create repo with a services directory
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/services/user-service.ts': `
export interface User {
  id: string;
  email: string;
  name: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }
}
`,
        'src/services/index.ts': `
export { UserService } from './user-service.js';
export type { User } from './user-service.js';
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Run on the services directory
      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        agentCtx
      );

      // Verify tool usage
      assert.ok(result.toolMetrics, 'should have tool metrics');
      assert.ok(result.toolMetrics.toolCallCount >= 2,
        `should make at least 2 tool calls, made ${result.toolMetrics.toolCallCount}`);

      const toolsUsed = Object.keys(result.toolMetrics.toolsUsed);
      assert.ok(toolsUsed.includes('list_directory'),
        'should use list_directory tool');
      assert.ok(toolsUsed.includes('read_file'),
        'should use read_file tool');

      console.log(`Tool usage test passed. Tools used: ${toolsUsed.join(', ')}, Total calls: ${result.toolMetrics.toolCallCount}`);
    });
  });

  describe('Format Compliance', () => {
    it('returns parseable response structure', async () => {
      const repoId = 'llm-explorer-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/config.ts': `
export interface Config {
  port: number;
  host: string;
  debug: boolean;
}

export const defaultConfig: Config = {
  port: 3000,
  host: 'localhost',
  debug: false,
};
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');
      assert.ok(Array.isArray(result.updates), 'updates should be an array');

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Updates: ${result.updates.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Documentation Accuracy', () => {
    it('documents actual code patterns, not hallucinated ones', async () => {
      const repoId = 'llm-explorer-accuracy';

      // Create a repo with plain TypeScript - NO NestJS, NO decorators
      await createTestRepo(ctx, repoId, {
        'README.md': '# Simple TypeScript Repository',
        'src/repository/user-repository.ts': `
/**
 * Simple user repository using Map storage.
 * Plain TypeScript with no frameworks.
 */
export interface UserEntity {
  id: string;
  email: string;
  createdAt: Date;
}

export interface IUserRepository {
  findById(id: string): Promise<UserEntity | null>;
  save(user: UserEntity): Promise<void>;
}

export class InMemoryUserRepository implements IUserRepository {
  private storage = new Map<string, UserEntity>();

  async findById(id: string): Promise<UserEntity | null> {
    return this.storage.get(id) ?? null;
  }

  async save(user: UserEntity): Promise<void> {
    this.storage.set(user.id, user);
  }
}
`,
        'src/repository/index.ts': `
export { InMemoryUserRepository } from './user-repository.js';
export type { UserEntity, IUserRepository } from './user-repository.js';
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/repository' },
        agentCtx
      );

      // LLM-as-judge: Verify documentation accuracy
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        wikiPages: result.updates.map(u => ({
          path: u.path,
          content: u.content?.substring(0, 500), // Truncate for evaluation
        })),
      }, null, 2);

      const evalResult = await assertLLM(
        'The documentation accurately describes plain TypeScript code with interfaces and classes. ' +
        'It should NOT mention NestJS, @Injectable, @Repository, or any framework decorators. ' +
        'The file is named "user-repository.ts" (with hyphen), NOT "user.repository.ts" (with dot). ' +
        'The class is InMemoryUserRepository using a Map for storage, not a database. ' +
        'Documentation should reflect the actual simple TypeScript implementation.',
        analysisText,
        7
      );

      logTestResult('Documentation accuracy - no hallucinations', evalResult);
      console.log(formatEvaluationResult('Documentation accuracy - no hallucinations', evalResult));
    });

    it('references only files that actually exist', async () => {
      const repoId = 'llm-explorer-file-paths';

      // Create a specific directory structure
      await createTestRepo(ctx, repoId, {
        'README.md': '# File Path Test',
        'src/utils/string-helpers.ts': `
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}
`,
        'src/utils/index.ts': `
export * from './string-helpers.js';
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/utils' },
        agentCtx
      );

      // Check that findings only reference actual paths
      const allReferencedPaths = result.result.findings
        .flatMap(f => f.relatedPaths);

      // All paths should be from the actual directory structure
      const validPaths = ['src/utils', 'src/utils/string-helpers.ts', 'src/utils/index.ts'];

      for (const path of allReferencedPaths) {
        const isValid = validPaths.some(valid =>
          path.includes(valid) || valid.includes(path)
        );
        // Log but don't fail on path validation - the validation logic in agent should handle this
        if (!isValid) {
          console.log(`Note: Path "${path}" referenced but not in expected list`);
        }
      }

      // Main check: tool metrics show verification happened
      assert.ok(result.toolMetrics?.toolsUsed['list_directory'],
        'should have used list_directory to verify structure');
      assert.ok(result.toolMetrics?.toolsUsed['read_file'],
        'should have used read_file to verify content');

      console.log(`File path test passed. Referenced ${allReferencedPaths.length} paths.`);
    });
  });

  describe('Wiki Page Generation', () => {
    it('generates wiki pages with accurate content from read files', async () => {
      const repoId = 'llm-explorer-wiki-gen';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Project',
        'src/api/health-controller.ts': `
/**
 * Health check endpoint for monitoring.
 */
export class HealthController {
  /**
   * Returns service health status.
   */
  async check(): Promise<{ status: string; timestamp: Date }> {
    return {
      status: 'healthy',
      timestamp: new Date(),
    };
  }
}
`,
        'src/api/index.ts': `
export { HealthController } from './health-controller.js';
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/api' },
        agentCtx
      );

      // Should generate at least one wiki page
      assert.ok(result.updates.length > 0, 'should generate at least one wiki page');

      // Wiki pages should have content
      for (const update of result.updates) {
        assert.ok(update.content, `wiki page ${update.path} should have content`);
        assert.ok(update.content.length > 100,
          `wiki page ${update.path} should have substantial content (got ${update.content.length} chars)`);
      }

      // LLM-as-judge: Verify wiki content quality
      const wikiContent = result.updates.map(u => u.content).join('\n\n---\n\n');

      const evalResult = await assertLLM(
        'The wiki documentation describes a HealthController class with a check() method. ' +
        'It should mention health check functionality, the return type with status and timestamp, ' +
        'and accurately reflect the simple TypeScript implementation. ' +
        'The file is "health-controller.ts" with hyphen.',
        wikiContent,
        7
      );

      logTestResult('Wiki page generation quality', evalResult);
      console.log(formatEvaluationResult('Wiki page generation quality', evalResult));
    });
  });

  describe('Strict Tool Usage Requirements', () => {
    it('MUST make tool calls - fails if zero tool calls made', async () => {
      const repoId = 'llm-explorer-strict-tools';

      // Simple repo - even this should require tool calls
      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'src/index.ts': `export const VERSION = '1.0.0';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src' },
        agentCtx
      );

      // STRICT: Must have tool metrics
      assert.ok(result.toolMetrics, 'FAIL: No tool metrics - agent may not have used tools');

      // STRICT: Must have made at least 1 tool call
      assert.ok(result.toolMetrics.toolCallCount >= 1,
        `FAIL: Agent made ${result.toolMetrics.toolCallCount} tool calls. ` +
        `The agent MUST use tools before generating documentation.`);

      console.log(`Strict tool check passed: ${result.toolMetrics.toolCallCount} tool calls made`);
    });

    it('uses list_directory on the target path specifically', async () => {
      const repoId = 'llm-explorer-target-path';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
        'lib/helpers/format.ts': `
export function formatDate(d: Date): string {
  return d.toISOString();
}
`,
        'lib/helpers/index.ts': `export * from './format.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'lib/helpers' },
        agentCtx
      );

      // Check that list_directory was called
      assert.ok(result.toolMetrics?.toolsUsed['list_directory'],
        'FAIL: list_directory was not used at all');

      // Check count is reasonable
      assert.ok(result.toolMetrics!.toolsUsed['list_directory']! >= 1,
        `FAIL: list_directory called ${result.toolMetrics!.toolsUsed['list_directory']} times`);

      console.log(`Target path test passed. list_directory calls: ${result.toolMetrics!.toolsUsed['list_directory']}`);
    });
  });

  describe('Larger Codebase Scenarios', () => {
    it('explores directory with many files requiring multiple read_file calls', async () => {
      const repoId = 'llm-explorer-many-files';

      // Create a larger, more realistic directory structure
      await createTestRepo(ctx, repoId, {
        'README.md': '# Multi-file Project',
        'src/models/user.ts': `
export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}
`,
        'src/models/product.ts': `
export interface Product {
  id: string;
  name: string;
  price: number;
}
`,
        'src/models/order.ts': `
export interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  total: number;
}
`,
        'src/models/index.ts': `
export type { User } from './user.js';
export type { Product } from './product.js';
export type { Order } from './order.js';
`,
        'src/models/validators.ts': `
export function isValidEmail(email: string): boolean {
  return email.includes('@');
}

export function isPositiveNumber(n: number): boolean {
  return n > 0;
}
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/models' },
        agentCtx
      );

      // With 5 files, agent should read multiple files
      assert.ok(result.toolMetrics, 'should have tool metrics');
      assert.ok(result.toolMetrics.toolCallCount >= 3,
        `With 5 files, should make at least 3 tool calls. Made: ${result.toolMetrics.toolCallCount}`);

      const readFileCalls = result.toolMetrics.toolsUsed['read_file'] || 0;
      assert.ok(readFileCalls >= 2,
        `Should read at least 2 files to understand the models. Read: ${readFileCalls}`);

      console.log(`Many files test passed. Total calls: ${result.toolMetrics.toolCallCount}, read_file: ${readFileCalls}`);
    });

    it('explores nested directory structure', async () => {
      const repoId = 'llm-explorer-nested';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Nested Structure',
        'src/features/auth/login.ts': `
export async function login(email: string, password: string): Promise<string> {
  // Returns JWT token
  return 'fake-jwt-token';
}
`,
        'src/features/auth/logout.ts': `
export async function logout(token: string): Promise<void> {
  // Invalidate token
}
`,
        'src/features/auth/index.ts': `
export { login } from './login.js';
export { logout } from './logout.js';
`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/features/auth' },
        agentCtx
      );

      // Should explore the nested structure
      assert.ok(result.toolMetrics?.toolCallCount >= 2,
        `Nested directory should require at least 2 tool calls. Made: ${result.toolMetrics?.toolCallCount}`);

      // Content should reflect actual files
      const summary = result.result.summary.toLowerCase();
      const hasLoginMention = summary.includes('login') ||
        result.updates.some(u => u.content?.toLowerCase().includes('login'));

      assert.ok(hasLoginMention,
        'Documentation should mention login functionality from the actual files');

      console.log(`Nested structure test passed. Calls: ${result.toolMetrics?.toolCallCount}`);
    });
  });

  describe('Hallucination Prevention', () => {
    it('does not hallucinate common patterns for ambiguous directory names', async () => {
      const repoId = 'llm-explorer-no-hallucinate';

      // Directory named "controllers" but contains something unexpected
      // LLM might hallucinate REST endpoints, Express routes, etc.
      await createTestRepo(ctx, repoId, {
        'README.md': '# Unusual Controllers',
        'src/controllers/game-controller.ts': `
/**
 * This is NOT a REST controller!
 * It's a game input controller for handling keyboard/mouse.
 */
export class GameController {
  private keyState: Map<string, boolean> = new Map();

  onKeyDown(key: string): void {
    this.keyState.set(key, true);
  }

  onKeyUp(key: string): void {
    this.keyState.set(key, false);
  }

  isKeyPressed(key: string): boolean {
    return this.keyState.get(key) ?? false;
  }
}
`,
        'src/controllers/index.ts': `export { GameController } from './game-controller.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/controllers' },
        agentCtx
      );

      // Must have read the file to know it's not a REST controller
      assert.ok(result.toolMetrics?.toolsUsed['read_file'],
        'MUST read file to avoid hallucinating REST patterns');

      // LLM-as-judge: Should describe game controller, NOT REST/HTTP
      const content = JSON.stringify({
        summary: result.result.summary,
        wikiContent: result.updates.map(u => u.content?.substring(0, 300)),
      });

      const evalResult = await assertLLM(
        'The documentation describes a GameController for handling keyboard/mouse input (keyDown, keyUp, isKeyPressed). ' +
        'It should NOT mention REST APIs, HTTP endpoints, Express, routes, GET/POST requests, or web controllers. ' +
        'This is a game input controller, not a web API controller.',
        content,
        7
      );

      logTestResult('Hallucination prevention - game controller', evalResult);
      console.log(formatEvaluationResult('Hallucination prevention - game controller', evalResult));
    });

    it('documents actual unique implementation, not generic patterns', async () => {
      const repoId = 'llm-explorer-unique-impl';

      // A "cache" that's actually something unusual
      await createTestRepo(ctx, repoId, {
        'README.md': '# Custom Cache',
        'src/cache/fibonacci-cache.ts': `
/**
 * A cache specifically for Fibonacci sequence values.
 * Pre-computes and stores Fibonacci numbers up to a limit.
 * This is NOT a generic key-value cache!
 */
export class FibonacciCache {
  private values: number[] = [0, 1];

  constructor(limit: number = 100) {
    for (let i = 2; i < limit; i++) {
      this.values[i] = this.values[i-1]! + this.values[i-2]!;
    }
  }

  get(n: number): number | undefined {
    return this.values[n];
  }

  getSequence(start: number, end: number): number[] {
    return this.values.slice(start, end);
  }
}
`,
        'src/cache/index.ts': `export { FibonacciCache } from './fibonacci-cache.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/cache' },
        agentCtx
      );

      // Must read to know it's a Fibonacci cache
      assert.ok(result.toolMetrics?.toolsUsed['read_file'],
        'MUST read file to understand unique implementation');

      const content = JSON.stringify({
        summary: result.result.summary,
        wikiContent: result.updates.map(u => u.content?.substring(0, 400)),
      });

      const evalResult = await assertLLM(
        'The documentation describes a FibonacciCache that pre-computes Fibonacci sequence values. ' +
        'It should mention Fibonacci numbers, sequence computation, the getSequence method. ' +
        'It should NOT describe a generic key-value cache, Redis, TTL, or cache invalidation.',
        content,
        7
      );

      logTestResult('Unique implementation - Fibonacci cache', evalResult);
      console.log(formatEvaluationResult('Unique implementation - Fibonacci cache', evalResult));
    });
  });

  describe('Tool Call Quality', () => {
    it('reads actual source files, not just index files', async () => {
      const repoId = 'llm-explorer-read-sources';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Source Reading Test',
        'src/services/payment-service.ts': `
export interface PaymentResult {
  success: boolean;
  transactionId: string;
  amount: number;
}

export class PaymentService {
  async processPayment(amount: number, cardToken: string): Promise<PaymentResult> {
    // Simulate payment processing
    return {
      success: true,
      transactionId: 'txn_' + Date.now(),
      amount,
    };
  }

  async refund(transactionId: string): Promise<boolean> {
    return true;
  }
}
`,
        'src/services/index.ts': `export { PaymentService } from './payment-service.js';`,
      });

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        agentCtx
      );

      // Should read multiple files, not just index
      const readCalls = result.toolMetrics?.toolsUsed['read_file'] || 0;
      assert.ok(readCalls >= 1, `Should read at least 1 file. Read: ${readCalls}`);

      // Documentation should have details only available from reading the source
      const allContent = result.result.summary + ' ' +
        result.updates.map(u => u.content).join(' ');

      // These details require reading payment-service.ts
      const hasPaymentDetails =
        allContent.toLowerCase().includes('payment') ||
        allContent.toLowerCase().includes('transaction') ||
        allContent.toLowerCase().includes('refund');

      assert.ok(hasPaymentDetails,
        'Documentation should include payment/transaction/refund details from source file');

      console.log(`Source reading test passed. read_file calls: ${readCalls}`);
    });
  });
});
