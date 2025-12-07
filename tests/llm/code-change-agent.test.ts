/**
 * Real LLM tests for CodeChangeAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent accurately describes code changes
 * 3. Agent generates relevant wiki updates
 *
 * Run with: node --import tsx --test tests/llm/code-change-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { CodeChangeAgent } from '../../src/agents/analysis/code-change-agent.js';
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

describe('CodeChangeAgent with Real LLM', { timeout: 120000 }, () => {
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
      const repoId = 'llm-code-change-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/utils.ts': `
export function add(a: number, b: number): number {
  return a + b;
}
`,
      }, 'Add utility function');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

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
    it('accurately describes new feature addition', async () => {
      const repoId = 'llm-code-change-feature';

      await createTestRepo(ctx, repoId, {
        'README.md': '# User Management System',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/user/user-service.ts': `
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
}

export class UserService {
  private users: Map<string, User> = new Map();

  async createUser(email: string, name: string, role: User['role'] = 'user'): Promise<User> {
    const id = crypto.randomUUID();
    const user: User = { id, email, name, role };
    this.users.set(id, user);
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return updated;
  }
}
`,
      }, 'Add user management service');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // LLM-as-judge: Verify the analysis describes the feature
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        wikiContent: result.updates.map(u => u.content).join('\n'),
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis describes adding code related to users or user management. ' +
        'It should mention any of: UserService, user operations, User interface, ' +
        'or adding a new service/file.',
        analysisText,
        6
      );

      logTestResult('Feature addition description', evalResult);
      console.log(formatEvaluationResult('Feature addition description', evalResult));
    });

    it('accurately describes bug fix', async () => {
      const repoId = 'llm-code-change-bugfix';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Calculator App',
        'src/calculator.ts': `
export function divide(a: number, b: number): number {
  return a / b;
}
`,
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/calculator.ts': `
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero is not allowed');
  }
  return a / b;
}
`,
      }, 'Fix division by zero bug');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // LLM-as-judge: Verify the analysis describes the bug fix
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis describes fixing a division by zero bug. ' +
        'It should mention adding validation/check for zero divisor ' +
        'and throwing an error or handling the edge case.',
        analysisText,
        6
      );

      logTestResult('Bug fix description', evalResult);
      console.log(formatEvaluationResult('Bug fix description', evalResult));
    });
  });
});
