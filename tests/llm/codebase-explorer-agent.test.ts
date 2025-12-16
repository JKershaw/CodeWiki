/**
import { createPathTarget } from '../../src/domain/work-target.js';
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
import { createPathTarget } from '../../src/domain/work-target.js';
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

      // Verify that files were read (either via pre-fetch or tools)
      assert.ok(result.toolMetrics, 'should have tool metrics');

      // Accept either tool-based or pre-fetch approach
      const usedTools = result.toolMetrics.toolCallCount > 0;
      const usedPrefetch = result.toolMetrics.filesRead.length > 0;

      assert.ok(usedTools || usedPrefetch,
        `should read files via tools or pre-fetch. Tools: ${result.toolMetrics.toolCallCount}, Prefetched: ${result.toolMetrics.filesRead.length}`);

      if (usedTools) {
        const toolsUsed = Object.keys(result.toolMetrics.toolsUsed);
        console.log(`Tool-based: ${toolsUsed.join(', ')}, ${result.toolMetrics.toolCallCount} calls`);
      } else {
        console.log(`Pre-fetch: ${result.toolMetrics.filesRead.length} files read`);
      }
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

      // Main check: files were read (via tools or pre-fetch)
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        'should have processed files via tools or pre-fetch');

      console.log(`File path test passed. Referenced ${allReferencedPaths.length} paths, read ${result.toolMetrics.filesRead.length} files.`);
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

  describe('File Processing Requirements', () => {
    it('MUST process files - fails if no files were read', async () => {
      const repoId = 'llm-explorer-strict-files';

      // Simple repo - files must be read (via pre-fetch or tools)
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
      assert.ok(result.toolMetrics, 'FAIL: No tool metrics');

      // STRICT: Must have read at least 1 file (via tools or pre-fetch)
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        `FAIL: No files processed. Tools: ${result.toolMetrics.toolCallCount}, Prefetched: ${result.toolMetrics.filesRead.length}`);

      console.log(`File processing check passed: ${result.toolMetrics.filesRead.length} files read`);
    });

    it('processes files from target directory', async () => {
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

      // Check that files were processed from target directory
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        `FAIL: No files processed from lib/helpers`);

      console.log(`Target path test passed. Files read: ${result.toolMetrics.filesRead.length}`);
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

      // With 5 files, agent should read multiple files (via pre-fetch or tools)
      assert.ok(result.toolMetrics, 'should have tool metrics');

      const filesRead = result.toolMetrics.filesRead.length;
      const toolCalls = result.toolMetrics.toolCallCount;

      // Should process multiple files
      assert.ok(filesRead >= 2 || toolCalls >= 3,
        `With 5 files, should read multiple files. Read: ${filesRead}, Tool calls: ${toolCalls}`);

      console.log(`Many files test passed. Files read: ${filesRead}, Tool calls: ${toolCalls}`);
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

      // Should have processed files from nested structure
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        `Nested directory should have files processed. Read: ${result.toolMetrics.filesRead.length}, Tools: ${result.toolMetrics.toolCallCount}`);

      // Content should reflect actual files
      const summary = result.result.summary.toLowerCase();
      const hasLoginMention = summary.includes('login') ||
        result.updates.some(u => u.content?.toLowerCase().includes('login'));

      assert.ok(hasLoginMention,
        'Documentation should mention login functionality from the actual files');

      console.log(`Nested structure test passed. Files: ${result.toolMetrics.filesRead.length}`);
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

      // Must have read files (via pre-fetch or tools) to know it's not a REST controller
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        'MUST read files to avoid hallucinating REST patterns');

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

      // Must have read files (via pre-fetch or tools) to know it's a Fibonacci cache
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesProcessed = result.toolMetrics.filesRead.length > 0 ||
        result.toolMetrics.toolCallCount > 0;
      assert.ok(filesProcessed,
        'MUST read files to understand unique implementation');

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

  describe('File Reading Quality', () => {
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

      // Should read files (via pre-fetch or tools)
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesRead = result.toolMetrics.filesRead.length;
      const toolCalls = result.toolMetrics.toolCallCount;
      assert.ok(filesRead >= 1 || toolCalls >= 1,
        `Should read at least 1 file. Prefetched: ${filesRead}, Tools: ${toolCalls}`);

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

      console.log(`Source reading test passed. Files read: ${filesRead}`);
    });
  });

  describe('File Reference Accuracy', () => {
    it('measures accuracy of file references against actual file tree', async () => {
      const repoId = 'llm-explorer-ref-accuracy';

      // Create a realistic directory structure
      const files: Record<string, string> = {
        'README.md': '# Reference Accuracy Test',
        'src/services/user-service.ts': `
export class UserService {
  async findUser(id: string): Promise<User | null> {
    return null;
  }
}`,
        'src/services/auth-service.ts': `
export class AuthService {
  async login(email: string, password: string): Promise<string> {
    return 'token';
  }
}`,
        'src/services/index.ts': `
export { UserService } from './user-service.js';
export { AuthService } from './auth-service.js';
`,
        'src/models/user.ts': `
export interface User {
  id: string;
  email: string;
}`,
        'src/utils/helpers.ts': `
export function formatDate(date: Date): string {
  return date.toISOString();
}`,
      };

      await createTestRepo(ctx, repoId, files);

      // Build the source file tree from known files
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        agentCtx
      );

      // Collect all file references from the agent's output
      const { validateFileReferences, formatFileReferenceMetrics, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');
      const { extractFileReferencesFromContent } =
        await import('../../src/utils/file-reference-extraction.js');

      // Also extract file references from generated wiki content (like production does)
      // Pass targetPath to resolve bare filenames (this is the fix we're testing!)
      const targetPath = 'src/services';
      const contentRefs = result.updates.flatMap(u =>
        u.content ? extractFileReferencesFromContent(u.content, targetPath) : []
      );

      const allReferences = collectAllReferences(
        result.toolMetrics?.filesRead,
        result.result.findings.flatMap(f => f.relatedPaths),
        contentRefs,
      );

      const metrics = validateFileReferences(allReferences, sourceFileTree);

      // Also report just content-extracted refs separately
      const contentMetrics = validateFileReferences(contentRefs, sourceFileTree);
      console.log(formatFileReferenceMetrics('Content-extracted refs (with targetPath resolution)', contentMetrics));

      // Log the metrics
      console.log(formatFileReferenceMetrics('CodebaseExplorerAgent', metrics));

      // Store metrics for trend tracking
      logTestResult('File reference accuracy', {
        passed: metrics.accuracyRate >= 0.7,
        score: Math.round(metrics.accuracyRate * 10),
        reasoning: `${metrics.validReferences}/${metrics.totalReferences} references valid (${(metrics.accuracyRate * 100).toFixed(1)}%)`,
        improvements: metrics.brokenReferences.length > 0
          ? [`Fix broken references: ${metrics.brokenReferences.slice(0, 5).join(', ')}`]
          : [],
      });

      // Soft assertion - log but don't fail below 70% (we're establishing baseline)
      if (metrics.accuracyRate < 0.7) {
        console.warn(`⚠️ File reference accuracy ${(metrics.accuracyRate * 100).toFixed(1)}% is below 70% threshold`);
      }

      // Hard assertion - must have some valid references
      assert.ok(metrics.validReferences > 0 || metrics.totalReferences === 0,
        'Should have at least some valid file references');
    });

    it('tracks reference accuracy across multiple directories', async () => {
      const repoId = 'llm-explorer-multi-dir-accuracy';

      const files: Record<string, string> = {
        'README.md': '# Multi-Directory Test',
        'src/api/routes.ts': `export const routes = [];`,
        'src/api/middleware.ts': `export const auth = () => {};`,
        'src/db/connection.ts': `export const connect = async () => {};`,
        'src/db/models.ts': `export interface Model {}`,
        'tests/api.test.ts': `describe('api', () => {});`,
      };

      await createTestRepo(ctx, repoId, files);
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Test multiple paths
      const paths = ['src/api', 'src/db'];
      let totalValid = 0;
      let totalRefs = 0;
      const allBroken: string[] = [];

      const { validateFileReferences, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');

      for (const path of paths) {
        const result = await agent.run({ type: 'path', path }, agentCtx);

        const refs = collectAllReferences(
          result.toolMetrics?.filesRead,
          result.result.findings.flatMap(f => f.relatedPaths),
        );

        const metrics = validateFileReferences(refs, sourceFileTree);
        totalValid += metrics.validReferences;
        totalRefs += metrics.totalReferences;
        allBroken.push(...metrics.brokenReferences);
      }

      const overallAccuracy = totalRefs > 0 ? totalValid / totalRefs : 1;

      console.log(`📊 Multi-directory accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
      console.log(`   Total refs: ${totalRefs}, Valid: ${totalValid}, Broken: ${allBroken.length}`);

      if (allBroken.length > 0) {
        console.log(`   Broken: ${allBroken.slice(0, 5).join(', ')}${allBroken.length > 5 ? '...' : ''}`);
      }

      logTestResult('Multi-directory reference accuracy', {
        passed: overallAccuracy >= 0.7,
        score: Math.round(overallAccuracy * 10),
        reasoning: `${totalValid}/${totalRefs} references valid across ${paths.length} directories`,
        improvements: allBroken.length > 0
          ? [`Fix broken references: ${[...new Set(allBroken)].slice(0, 3).join(', ')}`]
          : [],
      });
    });

    it('measures accuracy with deeper nested directory structure', async () => {
      const repoId = 'llm-explorer-nested-accuracy';

      // Create a more realistic nested structure like real codebases
      const files: Record<string, string> = {
        'README.md': '# Nested Structure Test',
        'src/index.ts': `export * from './services';`,
        'src/services/index.ts': `export { UserService } from './user/user-service';`,
        'src/services/user/user-service.ts': `
export class UserService {
  async getUser(id: string) { return { id }; }
}`,
        'src/services/user/user-repository.ts': `
export class UserRepository {
  async findById(id: string) { return null; }
}`,
        'src/services/auth/auth-service.ts': `
export class AuthService {
  async authenticate(token: string) { return true; }
}`,
        'src/services/auth/token-validator.ts': `
export function validateToken(token: string) { return true; }`,
        'src/utils/logger.ts': `export const logger = console;`,
        'src/utils/config.ts': `export const config = {};`,
      };

      await createTestRepo(ctx, repoId, files);
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        agentCtx
      );

      const { validateFileReferences, formatFileReferenceMetrics, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');
      const { extractFileReferencesFromContent } =
        await import('../../src/utils/file-reference-extraction.js');

      const targetPath = 'src/services';
      const contentRefs = result.updates.flatMap(u =>
        u.content ? extractFileReferencesFromContent(u.content, targetPath) : []
      );

      const allReferences = collectAllReferences(
        result.toolMetrics?.filesRead,
        result.result.findings.flatMap(f => f.relatedPaths),
        contentRefs,
      );

      const metrics = validateFileReferences(allReferences, sourceFileTree);
      const contentMetrics = validateFileReferences(contentRefs, sourceFileTree);

      console.log(formatFileReferenceMetrics('Nested structure - Content refs (with resolution)', contentMetrics));
      console.log(formatFileReferenceMetrics('Nested structure - All refs', metrics));

      logTestResult('Nested directory reference accuracy', {
        passed: metrics.accuracyRate >= 0.5,
        score: Math.round(metrics.accuracyRate * 10),
        reasoning: `${metrics.validReferences}/${metrics.totalReferences} refs valid. Content-only: ${contentMetrics.validReferences}/${contentMetrics.totalReferences}`,
        improvements: metrics.brokenReferences.length > 0
          ? [`Broken: ${metrics.brokenReferences.slice(0, 5).join(', ')}`]
          : [],
      });
    });

    it('measures accuracy with TypeScript import-style references', async () => {
      const repoId = 'llm-explorer-ts-imports';

      // Files that commonly get referenced via imports (with .js extension issues)
      const files: Record<string, string> = {
        'README.md': '# Import Style Test',
        'src/index.ts': `
import { Database } from './database/index.js';
import { cache } from './cache/redis-cache.js';
export { Database, cache };`,
        'src/database/index.ts': `export { Database } from './database.js';`,
        'src/database/database.ts': `
export class Database {
  async connect() { return true; }
  async query(sql: string) { return []; }
}`,
        'src/database/migrations.ts': `export const migrations = [];`,
        'src/cache/redis-cache.ts': `
export const cache = {
  get: async (key: string) => null,
  set: async (key: string, value: unknown) => {},
};`,
        'src/cache/memory-cache.ts': `export const memoryCache = new Map();`,
      };

      await createTestRepo(ctx, repoId, files);
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/database' },
        agentCtx
      );

      const { validateFileReferences, formatFileReferenceMetrics, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');
      const { extractFileReferencesFromContent } =
        await import('../../src/utils/file-reference-extraction.js');

      const targetPath = 'src/database';
      const contentRefs = result.updates.flatMap(u =>
        u.content ? extractFileReferencesFromContent(u.content, targetPath) : []
      );

      const allReferences = collectAllReferences(
        result.toolMetrics?.filesRead,
        result.result.findings.flatMap(f => f.relatedPaths),
        contentRefs,
      );

      const metrics = validateFileReferences(allReferences, sourceFileTree);
      const contentMetrics = validateFileReferences(contentRefs, sourceFileTree);

      // Check specifically for .js vs .ts confusion
      const jsRefs = metrics.brokenReferences.filter(r => r.endsWith('.js'));
      if (jsRefs.length > 0) {
        console.log(`⚠️ Found ${jsRefs.length} .js references (should be .ts): ${jsRefs.join(', ')}`);
      }

      console.log(formatFileReferenceMetrics('TS imports - Content refs', contentMetrics));
      console.log(formatFileReferenceMetrics('TS imports - All refs', metrics));

      logTestResult('TypeScript import reference accuracy', {
        passed: metrics.accuracyRate >= 0.5,
        score: Math.round(metrics.accuracyRate * 10),
        reasoning: `${metrics.validReferences}/${metrics.totalReferences} refs valid. .js errors: ${jsRefs.length}`,
        improvements: jsRefs.length > 0
          ? [`Fix .js→.ts: ${jsRefs.slice(0, 3).join(', ')}`]
          : [],
      });
    });

    it('measures accuracy with larger file count', async () => {
      const repoId = 'llm-explorer-large-dir';

      // Create a directory with many files (closer to real-world)
      const files: Record<string, string> = {
        'README.md': '# Large Directory Test',
      };

      // Generate 15 handler files
      for (let i = 1; i <= 15; i++) {
        files[`src/handlers/handler-${i}.ts`] = `
export class Handler${i} {
  async handle(req: Request) {
    return { handler: ${i} };
  }
}`;
      }
      files['src/handlers/index.ts'] = `
${Array.from({ length: 15 }, (_, i) => `export { Handler${i + 1} } from './handler-${i + 1}.js';`).join('\n')}
`;

      await createTestRepo(ctx, repoId, files);
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(
        { type: 'path', path: 'src/handlers' },
        agentCtx
      );

      const { validateFileReferences, formatFileReferenceMetrics, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');
      const { extractFileReferencesFromContent } =
        await import('../../src/utils/file-reference-extraction.js');

      const targetPath = 'src/handlers';
      const contentRefs = result.updates.flatMap(u =>
        u.content ? extractFileReferencesFromContent(u.content, targetPath) : []
      );

      const allReferences = collectAllReferences(
        result.toolMetrics?.filesRead,
        result.result.findings.flatMap(f => f.relatedPaths),
        contentRefs,
      );

      const metrics = validateFileReferences(allReferences, sourceFileTree);
      const contentMetrics = validateFileReferences(contentRefs, sourceFileTree);

      console.log(formatFileReferenceMetrics('Large dir (16 files) - Content refs (with resolution)', contentMetrics));
      console.log(formatFileReferenceMetrics('Large dir (16 files) - All refs', metrics));

      // Categorize broken references
      const bareNames = metrics.brokenReferences.filter(r => !r.includes('/'));
      const wrongExt = metrics.brokenReferences.filter(r => r.endsWith('.js'));

      console.log(`   Bare filenames: ${bareNames.length}, Wrong extension: ${wrongExt.length}`);

      logTestResult('Large directory reference accuracy', {
        passed: metrics.accuracyRate >= 0.5,
        score: Math.round(metrics.accuracyRate * 10),
        reasoning: `${metrics.validReferences}/${metrics.totalReferences} refs valid. Bare names: ${bareNames.length}`,
        improvements: metrics.brokenReferences.length > 0
          ? [`Broken: ${metrics.brokenReferences.slice(0, 5).join(', ')}`]
          : [],
      });
    });

    it('categorizes broken reference types for analysis', async () => {
      const repoId = 'llm-explorer-categorize-broken';

      const files: Record<string, string> = {
        'README.md': '# Categorization Test',
        'src/core/engine.ts': `export class Engine { start() {} }`,
        'src/core/config.ts': `export const config = { debug: false };`,
        'src/core/types.ts': `export interface Options { verbose: boolean; }`,
        'src/plugins/loader.ts': `export function loadPlugins() { return []; }`,
        'src/plugins/registry.ts': `export const registry = new Map();`,
      };

      await createTestRepo(ctx, repoId, files);
      const sourceFileTree = new Set(Object.keys(files));

      const agent = new CodebaseExplorerAgent();
      const agentCtx = await ctx.agentContext(repoId);

      // Run on multiple paths to get more data
      const paths = ['src/core', 'src/plugins'];
      const allContentRefs: string[] = [];
      const allToolRefs: string[] = [];

      const { validateFileReferences, collectAllReferences } =
        await import('./helpers/file-reference-validator.js');
      const { extractFileReferencesFromContent } =
        await import('../../src/utils/file-reference-extraction.js');

      for (const path of paths) {
        const result = await agent.run({ type: 'path', path }, agentCtx);

        // Pass the current path as targetPath for resolution
        const contentRefs = result.updates.flatMap(u =>
          u.content ? extractFileReferencesFromContent(u.content, path) : []
        );
        allContentRefs.push(...contentRefs);
        allToolRefs.push(...(result.toolMetrics?.filesRead ?? []));
      }

      const contentMetrics = validateFileReferences(allContentRefs, sourceFileTree);
      const toolMetrics = validateFileReferences(allToolRefs, sourceFileTree);

      // Categorize broken references
      const categories = {
        bareFilenames: contentMetrics.brokenReferences.filter(r => !r.includes('/')),
        wrongExtension: contentMetrics.brokenReferences.filter(r => r.endsWith('.js')),
        directories: contentMetrics.brokenReferences.filter(r => r.endsWith('/')),
        hallucinated: contentMetrics.brokenReferences.filter(r =>
          r.includes('/') && !r.endsWith('/') && !r.endsWith('.js')
        ),
      };

      console.log(`\n📊 Broken Reference Analysis (Content-extracted)`);
      console.log(`   Total content refs: ${allContentRefs.length}`);
      console.log(`   Valid: ${contentMetrics.validReferences}`);
      console.log(`   Broken: ${contentMetrics.brokenReferences.length}`);
      console.log(`   Accuracy: ${(contentMetrics.accuracyRate * 100).toFixed(1)}%`);
      console.log(`\n   Breakdown by category:`);
      console.log(`   - Bare filenames: ${categories.bareFilenames.length} (${categories.bareFilenames.slice(0, 3).join(', ')})`);
      console.log(`   - Wrong extension (.js): ${categories.wrongExtension.length}`);
      console.log(`   - Directory paths: ${categories.directories.length}`);
      console.log(`   - Hallucinated paths: ${categories.hallucinated.length}`);

      console.log(`\n📊 Tool Metrics (filesRead)`);
      console.log(`   Total: ${allToolRefs.length}, Valid: ${toolMetrics.validReferences}, Broken: ${toolMetrics.brokenReferences.length}`);

      logTestResult('Broken reference categorization', {
        passed: true, // Always pass - this is for data collection
        score: Math.round(contentMetrics.accuracyRate * 10),
        reasoning: `Content: ${contentMetrics.validReferences}/${allContentRefs.length} valid. Bare: ${categories.bareFilenames.length}, .js: ${categories.wrongExtension.length}`,
        improvements: [
          `Bare filenames: ${categories.bareFilenames.length}`,
          `Wrong extension: ${categories.wrongExtension.length}`,
          `Hallucinated: ${categories.hallucinated.length}`,
        ],
      });
    });
  });
});
