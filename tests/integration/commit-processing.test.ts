/**
 * Integration tests for commit processing workflow.
 * Uses real file-based repos, real git, fake LLM only.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { CodeChangeAgent } from '../../src/agents/analysis/code-change-agent.js';

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

      // Configure mock LLM response - new concept-focused format
      ctx.llm.setDefaultResponse(`CONCEPT:
This change affects the user authentication system, adding login and credential validation functions.

FINDINGS:
- [SECURITY] [IMPORTANCE:high] Basic credential validation implemented [src/auth.ts]
- [CODE_PATTERN] [IMPORTANCE:medium] Simple validation pattern used [src/auth.ts]

WIKI_PAGES:
=== [components/auth] [create] ===
# User Authentication System

The authentication system provides secure user login functionality.
It validates user credentials against stored values and returns
authentication status.

## Overview

This component handles user authentication for the application.

## How It Works

The system provides two main functions:
- \`login()\` - Entry point for authentication
- \`validateCredentials()\` - Performs actual credential checking
=== END ===

CONFIDENCE: 0.8`);

      // Run the agent
      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Verify results
      assert.ok(result.updates.length > 0, 'Should produce wiki updates');
      assert.ok(result.result.summary.length > 0, 'Should have a summary');
      assert.ok(result.result.findings.length > 0, 'Should have findings');
      assert.strictEqual(result.result.confidence, 0.8);

      // Verify concept page was created (not commit page)
      const conceptUpdate = result.updates.find(u => u.path === 'components/auth');
      assert.ok(conceptUpdate, 'Should create a concept page');
      assert.strictEqual(conceptUpdate.type, 'create');
      assert.ok(conceptUpdate.content.includes('Authentication'), 'Page should mention authentication');

      // Verify NO commit page was created
      const commitUpdate = result.updates.find(u => u.path.startsWith('commits/'));
      assert.ok(!commitUpdate, 'Should NOT create a commit page (concept-focused design)');
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

      // Configure mock LLM response - new concept-focused format
      ctx.llm.setDefaultResponse(`CONCEPT:
This change introduces a complete authentication module with middleware support.

FINDINGS:
- [ARCHITECTURE] [IMPORTANCE:medium] Modular auth design [src/auth.ts, src/middleware.ts]

WIKI_PAGES:
=== [components/auth-module] [create] ===
# Authentication Module

A complete authentication module with middleware support.

## Overview

This module provides authentication functionality for the application,
including middleware for protecting routes.

## Key Components

- \`auth.ts\` - Core authentication functions
- \`middleware.ts\` - Express/route middleware
- \`types.ts\` - TypeScript type definitions
=== END ===

CONFIDENCE: 0.75`);

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.updates.length > 0, 'Should produce concept page updates');
      assert.strictEqual(result.result.confidence, 0.75);

      // Verify concept page was created (not commit page)
      const conceptUpdate = result.updates.find(u => !u.path.startsWith('commits/'));
      assert.ok(conceptUpdate, 'Should create a concept page, not a commit page');
    });
  });
});
