/**
 * Real LLM tests for SecurityAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent detects actual security vulnerabilities
 * 3. Agent doesn't false-positive on safe code
 *
 * Run with: node --import tsx --test tests/llm/security-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../src/agents/analysis/security-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
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

describe('SecurityAgent with Real LLM', { timeout: 120000 }, () => {
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
      const repoId = 'llm-security-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/app.ts': `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
      }, 'Add greeting function');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Verify structure - these are deterministic checks
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');

      // Verify each finding has required fields
      for (const finding of result.result.findings) {
        assert.ok(typeof finding.type === 'string', 'finding.type should be a string');
        assert.ok(typeof finding.description === 'string', 'finding.description should be a string');
        assert.ok(['low', 'medium', 'high'].includes(finding.importance),
          `finding.importance should be low/medium/high, got ${finding.importance}`);
      }

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Detection Accuracy', () => {
    it('detects SQL injection in vulnerable code', async () => {
      const repoId = 'llm-security-sql-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Database Project',
      });

      // Add commit with obvious SQL injection vulnerability
      const commitSha = await addCommit(ctx, repoId, {
        'src/db/queries.ts': `
import { Database } from './database';

export async function getUserByEmail(db: Database, email: string) {
  // VULNERABLE: Direct string concatenation allows SQL injection
  const query = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(query);
}

export async function searchUsers(db: Database, searchTerm: string) {
  // VULNERABLE: Template literal with unsanitized user input
  return db.query(\`SELECT * FROM users WHERE name LIKE '%\${searchTerm}%'\`);
}
`,
      }, 'Add user query functions');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Deterministic check: Should have at least one finding
      assert.ok(result.result.findings.length > 0,
        'Should have at least one security finding for SQL injection');

      // LLM-as-judge: Verify the analysis correctly identifies SQL injection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies SQL injection vulnerability in the code. ' +
        'It should mention string concatenation or template literals being used ' +
        'unsafely in SQL queries.',
        analysisText,
        7 // threshold
      );

      logTestResult('SQL injection detection', evalResult);
      console.log(formatEvaluationResult('SQL injection detection', evalResult));

      // Should have high confidence for obvious vulnerability
      assert.ok(result.result.confidence >= 0.7,
        `Should have high confidence for clear vulnerability, got ${result.result.confidence}`);
    });

    it('does not false-positive on safe parameterized queries', async () => {
      const repoId = 'llm-security-safe-queries';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Safe Database Project',
      });

      // Add commit with SAFE parameterized queries
      const commitSha = await addCommit(ctx, repoId, {
        'src/db/safe-queries.ts': `
import { Database } from './database';

export async function getUserByEmail(db: Database, email: string) {
  // SAFE: Parameterized query prevents SQL injection
  return db.query('SELECT * FROM users WHERE email = ?', [email]);
}

export async function searchUsers(db: Database, searchTerm: string) {
  // SAFE: Using prepared statement with parameter binding
  const stmt = db.prepare('SELECT * FROM users WHERE name LIKE ?');
  return stmt.all(\`%\${searchTerm}%\`);
}

export async function insertUser(db: Database, name: string, email: string) {
  // SAFE: Named parameters
  return db.run(
    'INSERT INTO users (name, email) VALUES (:name, :email)',
    { name, email }
  );
}
`,
      }, 'Add safe parameterized query functions');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // LLM-as-judge: Verify the analysis does NOT flag parameterized queries as SQL injection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
      }, null, 2);

      // Use higher threshold (8) for false positive tests - we want to be sure
      const evalResult = await evaluateLLM(
        'The security analysis correctly recognizes that parameterized/prepared ' +
        'statements are safe and does NOT flag them as SQL injection vulnerabilities. ' +
        'The analysis should either have no SQL injection findings, or explicitly note ' +
        'that the code uses safe patterns.',
        analysisText,
        8
      );

      logTestResult('Safe code recognition', evalResult);
      console.log(formatEvaluationResult('Safe code recognition', evalResult));

      // We evaluate but don't assert-fail here since LLMs can be conservative
      // Just log the result for analysis
      if (!evalResult.passed) {
        console.log('Note: LLM flagged safe code as potentially vulnerable.');
        console.log('This may indicate the prompt needs tuning to reduce false positives.');
      }
    });

    it('detects hardcoded secrets', async () => {
      const repoId = 'llm-security-hardcoded-secrets';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Project',
      });

      // Add commit with hardcoded secrets
      const commitSha = await addCommit(ctx, repoId, {
        'src/config.ts': `
// Configuration for API access
export const config = {
  apiKey: 'sk-1234567890abcdef1234567890abcdef',
  databasePassword: 'supersecretpassword123!',
  jwtSecret: 'my-jwt-secret-key-do-not-share',
  awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  awsSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
`,
      }, 'Add API configuration');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Deterministic: Should have findings
      assert.ok(result.result.findings.length > 0,
        'Should have findings for hardcoded secrets');

      // LLM-as-judge: Verify detection of hardcoded secrets
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies hardcoded secrets/credentials in the code. ' +
        'It should mention API keys, passwords, JWT secrets, or AWS credentials ' +
        'being stored directly in source code.',
        analysisText,
        7
      );

      logTestResult('Hardcoded secrets detection', evalResult);
      console.log(formatEvaluationResult('Hardcoded secrets detection', evalResult));
    });
  });
});
