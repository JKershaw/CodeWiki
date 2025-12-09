/**
 * Integration tests for commit processing workflow.
 * Uses real file-based repos, real git, fake LLM only.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { CodeChangeAgent } from '../../src/agents/analysis/code-change-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';

describe('Commit Processing', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('CodeChangeAgent with real repo', () => {
    it('analyzes a commit and produces wiki updates', async () => {
      // Create a test repository
      const repoId = 'test-repo-1';
      await createTestRepo(ctx, repoId, {
        'src/auth.ts': 'export function login() { return true; }',
      });

      // Add a commit to analyze
      const commitSha = await addCommit(ctx, repoId, {
        'src/auth.ts': `export function login(user: string, pass: string) {
  return validateCredentials(user, pass);
}

export function validateCredentials(user: string, pass: string) {
  // TODO: implement real validation
  return user === 'admin' && pass === 'secret';
}`,
      }, 'Add user authentication');

      // Store commit in repository
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add user authentication',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 1,
          affectedFiles: ['src/auth.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Configure mock LLM response
      ctx.llm.setDefaultResponse(`PAGE_TITLE: User Authentication System

SUMMARY:
The authentication system provides secure user login functionality.
It validates user credentials against stored values and returns
authentication status.

FINDINGS:
- type: Security | importance: high | description: Basic credential validation implemented | paths: src/auth.ts
- type: Code Pattern | importance: medium | description: Simple validation pattern used | paths: src/auth.ts

WIKI_UPDATES:
=== path: commits/${commitSha.slice(0, 8)} | action: create ===
Authentication implementation
=== END ===

CONFIDENCE: 0.8`);

      // Run the agent
      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Verify results
      assert.ok(result.updates.length > 0, 'Should produce wiki updates');
      assert.ok(result.result.summary.length > 0, 'Should have a summary');
      assert.ok(result.result.findings.length > 0, 'Should have findings');
      assert.strictEqual(result.result.confidence, 0.8);

      // Verify commit page was created
      const commitUpdate = result.updates.find(u => u.path.startsWith('commits/'));
      assert.ok(commitUpdate, 'Should create a commit page');
      assert.strictEqual(commitUpdate.type, 'create');
      assert.ok(commitUpdate.content.includes('Authentication'), 'Page should mention authentication');
    });

    it('handles commits with multiple files', async () => {
      const repoId = 'test-repo-2';
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export * from "./auth";',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/auth.ts': 'export function auth() {}',
        'src/middleware.ts': 'export function authMiddleware() {}',
        'src/types.ts': 'export interface User { id: string; }',
      }, 'Add auth module with middleware');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add auth module with middleware',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 3,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 15,
          linesDeleted: 0,
          affectedFiles: ['src/auth.ts', 'src/middleware.ts', 'src/types.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(`PAGE_TITLE: Authentication Module

SUMMARY:
A complete authentication module with middleware support.

FINDINGS:
- type: Architecture | importance: medium | description: Modular auth design | paths: src/auth.ts, src/middleware.ts

WIKI_UPDATES:
=== path: commits/${commitSha.slice(0, 8)} | action: create ===
Auth module implementation
=== END ===

CONFIDENCE: 0.75`);

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      assert.ok(result.updates.length > 0);
      assert.strictEqual(result.result.confidence, 0.75);
    });
  });
});
