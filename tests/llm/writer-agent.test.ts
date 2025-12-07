/**
 * Real LLM tests for WriterAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent transforms commit-style content into encyclopedia articles
 * 3. Agent preserves factual information while improving style
 *
 * Run with: node --import tsx --test tests/llm/writer-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { WriterAgent } from '../../src/agents/synthesis/writer-agent.js';
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
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('WriterAgent with Real LLM', { timeout: 120000 }, () => {
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
   * Helper to create a wiki page directly in the repository.
   */
  async function createWikiPage(
    wikiId: string,
    path: string,
    title: string,
    content: string,
    confidence: number = 0.5
  ): Promise<WikiPage> {
    const page: WikiPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      wikiId,
      path,
      title,
      content,
      confidence,
      sourceCommits: ['abc123'],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await ctx.repos.wikiPages.save(page);
    return page;
  }

  describe('Format Compliance', () => {
    it('returns parseable response structure', async () => {
      const repoId = 'llm-writer-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/auth.ts': 'export function login() {}',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create a page that needs rewriting (commit-style language)
      await createWikiPage(
        agentCtx.wikiId,
        'features/authentication',
        'Authentication Feature',
        `# Authentication Feature

This commit adds basic authentication to the application.

This change introduces login and logout functionality.
`,
        0.4
      );

      const agent = new WriterAgent();
      const result = await agent.runOnWiki(agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(Array.isArray(result.updates), 'updates should be an array');

      // Should have produced an update
      if (result.updates.length > 0) {
        const update = result.updates[0]!;
        assert.ok(typeof update.path === 'string', 'update.path should be a string');
        assert.ok(typeof update.content === 'string', 'update.content should be a string');
      }

      console.log(`Format compliance test passed. Updates: ${result.updates.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Content Transformation', () => {
    it('transforms commit-style content into encyclopedia article', async () => {
      const repoId = 'llm-writer-transform';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Authentication System',
        'src/auth/login.ts': `
export interface LoginCredentials {
  email: string;
  password: string;
}

export async function login(credentials: LoginCredentials): Promise<{ token: string }> {
  // Validate credentials
  if (!credentials.email || !credentials.password) {
    throw new Error('Email and password are required');
  }
  // Return session token
  return { token: 'jwt-token-here' };
}
`,
        'src/auth/logout.ts': `
export async function logout(token: string): Promise<void> {
  // Invalidate session
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create a page with clear commit-style content that needs rewriting
      await createWikiPage(
        agentCtx.wikiId,
        'features/authentication',
        'Authentication Implementation',
        `# Authentication Implementation

This commit introduces the authentication system for the application.

This change adds:
- Login functionality with email/password
- Logout to invalidate sessions
- JWT tokens for session management

The implementation uses bcrypt for password hashing.
`,
        0.4
      );

      const agent = new WriterAgent();
      const result = await agent.runOnWiki(agentCtx);

      // Should have produced an update
      assert.ok(result.updates.length > 0, 'Should produce wiki updates');

      const update = result.updates[0]!;
      assert.ok(update.content.length > 100, 'Rewritten content should be substantial');

      // LLM-as-judge: Verify the transformation removes commit-style language
      const evalResult = await assertLLM(
        'The rewritten article uses encyclopedia-style language (third-person, present tense). ' +
        'It should NOT contain phrases like "this commit", "this change", "this adds", ' +
        'or other commit-focused language. It should read like a reference article ' +
        'explaining what the authentication system IS, not what was changed.',
        update.content,
        7
      );

      logTestResult('Commit-style to encyclopedia transformation', evalResult);
      console.log(formatEvaluationResult('Commit-style to encyclopedia transformation', evalResult));
    });

    it('preserves factual information during rewrite', async () => {
      const repoId = 'llm-writer-preserve-facts';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Project',
        'src/api/users.ts': `
export const userEndpoints = {
  list: 'GET /api/users',
  get: 'GET /api/users/:id',
  create: 'POST /api/users',
  update: 'PUT /api/users/:id',
  delete: 'DELETE /api/users/:id',
};
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create a page with specific facts that should be preserved
      await createWikiPage(
        agentCtx.wikiId,
        'api/user-endpoints',
        'User API Endpoints',
        `# User API Endpoints

This commit adds the user management API endpoints.

This change introduces five REST endpoints:
- GET /api/users - Lists all users
- GET /api/users/:id - Gets a single user
- POST /api/users - Creates a new user
- PUT /api/users/:id - Updates a user
- DELETE /api/users/:id - Deletes a user

All endpoints require authentication via JWT tokens.
`,
        0.4
      );

      const agent = new WriterAgent();
      const result = await agent.runOnWiki(agentCtx);

      assert.ok(result.updates.length > 0, 'Should produce wiki updates');

      const update = result.updates[0]!;

      // LLM-as-judge: Verify facts are preserved
      const evalResult = await assertLLM(
        'The rewritten article preserves the key factual information from the original. ' +
        'It should still mention the five REST endpoints (GET list, GET single, POST create, ' +
        'PUT update, DELETE) with their paths (/api/users), and note that JWT authentication is required.',
        update.content,
        7
      );

      logTestResult('Fact preservation during rewrite', evalResult);
      console.log(formatEvaluationResult('Fact preservation during rewrite', evalResult));
    });
  });
});
