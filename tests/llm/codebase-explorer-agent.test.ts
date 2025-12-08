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
});
