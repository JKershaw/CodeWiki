/**
 * Integration tests for SecurityAgent.
 * Tests the agent that audits commits for security-relevant changes.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { SecurityAgent } from '../../src/agents/analysis/security-agent.js';
import { securityAgentResponses } from '../fixtures/agent-responses.js';

describe('SecurityAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    ctx.llm.reset();
  });

  describe('runOnCommit', () => {
    it('detects security-relevant authentication changes', async () => {
      const repoId = 'security-auth-changes';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Security Test Project',
      });

      // Add a commit with authentication code
      const commitSha = await addCommit(ctx, repoId, {
        'src/auth/password.ts': `
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
`,
        'src/auth/session.ts': `
import crypto from 'crypto';

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function validateToken(token: string): boolean {
  return token.length === 64 && /^[a-f0-9]+$/.test(token);
}
`,
      }, 'Add authentication with bcrypt password hashing');

      // Store commit in repository
      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add authentication with bcrypt password hashing',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 2,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 25,
          linesDeleted: 0,
          affectedFiles: ['src/auth/password.ts', 'src/auth/session.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Set mock LLM response
      ctx.llm.setDefaultResponse(securityAgentResponses.authChangesDetected(commitSha));

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should have findings about auth changes
      assert.ok(result.result.findings.length > 0, 'Should have security findings');

      // Should identify authentication-related findings
      const authFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('auth') ||
        f.description.toLowerCase().includes('auth') ||
        f.description.toLowerCase().includes('password')
      );
      assert.ok(authFinding, 'Should identify authentication-related finding');

      // Should create wiki pages for high-relevance security changes
      assert.ok(result.updates.length > 0, 'Should create wiki updates for security-relevant changes');

      // Should have security audit page
      const auditPage = result.updates.find(u => u.path.includes('security/audit'));
      assert.ok(auditPage, 'Should create security audit page');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('detects SQL injection vulnerabilities', async () => {
      const repoId = 'security-sql-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Database Project',
      });

      // Add a commit with vulnerable SQL code
      const commitSha = await addCommit(ctx, repoId, {
        'src/db/queries.ts': `
export async function getUserByEmail(db: any, email: string) {
  // VULNERABLE: Direct string concatenation
  const query = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(query);
}

export async function searchUsers(db: any, searchTerm: string) {
  // VULNERABLE: Template literal with user input
  return db.query(\`SELECT * FROM users WHERE name LIKE '%\${searchTerm}%'\`);
}
`,
      }, 'Add user query functions');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add user query functions',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 12,
          linesDeleted: 0,
          affectedFiles: ['src/db/queries.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(securityAgentResponses.sqlInjectionDetected(commitSha));

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should identify critical security issue
      const criticalFinding = result.result.findings.find(f =>
        f.importance === 'high' ||
        f.description.toLowerCase().includes('sql') ||
        f.description.toLowerCase().includes('injection')
      );
      assert.ok(criticalFinding, 'Should identify SQL injection as critical issue');

      // Should have high confidence for clear vulnerability
      assert.ok(result.result.confidence >= 0.8, 'Should have high confidence for clear vulnerability');

      // Should create security audit page
      assert.ok(result.updates.length > 0, 'Should create wiki pages for critical findings');
    });

    it('detects XSS vulnerabilities', async () => {
      const repoId = 'security-xss';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Frontend Project',
      });

      // Add a commit with XSS-vulnerable code
      const commitSha = await addCommit(ctx, repoId, {
        'src/components/UserContent.tsx': `
import React from 'react';

interface Props {
  content: string;
}

export function UserContent({ content }: Props) {
  // VULNERABLE: Using dangerouslySetInnerHTML with user content
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}

export function CommentDisplay({ comment }: { comment: string }) {
  const el = document.getElementById('comment');
  if (el) {
    // VULNERABLE: Direct innerHTML assignment
    el.innerHTML = comment;
  }
  return <div id="comment" />;
}
`,
      }, 'Add user content components');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add user content components',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 20,
          linesDeleted: 0,
          affectedFiles: ['src/components/UserContent.tsx'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(securityAgentResponses.xssVulnerabilityDetected(commitSha));

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should identify XSS vulnerability
      const xssFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('xss') ||
        f.description.toLowerCase().includes('xss') ||
        f.description.toLowerCase().includes('cross-site')
      );
      assert.ok(xssFinding, 'Should identify XSS vulnerability');

      // Should create security documentation
      assert.ok(result.updates.length > 0, 'Should create wiki pages for XSS findings');
    });

    it('returns no updates for non-security commits', async () => {
      const repoId = 'security-no-relevance';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Documentation Project',
      });

      // Add a commit with just documentation
      const commitSha = await addCommit(ctx, repoId, {
        'docs/api.md': `
# API Documentation

## Endpoints

- GET /api/users - List all users
- GET /api/users/:id - Get user by ID
`,
      }, 'Add API documentation');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add API documentation',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 8,
          linesDeleted: 0,
          affectedFiles: ['docs/api.md'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(securityAgentResponses.noSecurityRelevance());

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should have minimal findings for non-security commit
      assert.strictEqual(result.updates.length, 0, 'Should not create wiki pages for non-security commits');

      // Cost should be minimal (still makes LLM call to analyze)
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'security-nonexistent';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await assert.rejects(
        async () => agent.runOnCommit('nonexistent-commit-id', agentCtx),
        /not found/i,
        'Should throw error for non-existent commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new SecurityAgent();
      assert.strictEqual(agent.type, 'security', 'Agent type should be security');
    });

    it('can handle commit targets', () => {
      const agent = new SecurityAgent();
      assert.ok(agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should handle commit targets');
    });

    it('cannot handle wiki targets', () => {
      const agent = new SecurityAgent();
      assert.ok(!agent.canHandle({ type: 'wiki' }), 'Should not handle wiki targets');
    });
  });
});
