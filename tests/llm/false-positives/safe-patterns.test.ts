/**
 * False Positive Prevention Tests for SecurityAgent.
 *
 * These tests verify that safe code patterns are NOT incorrectly flagged
 * as security vulnerabilities. False positives erode trust in the tool.
 *
 * Run with: node --import tsx --test tests/llm/false-positives/safe-patterns.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
import { createCommitTarget } from '../../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from '../helpers/test-context.js';
import {
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from '../helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from '../helpers/result-logger.js';

describe('SecurityAgent False Positive Prevention', { timeout: 180000 }, () => {
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

  describe('Safe SQL Patterns', () => {
    it('does NOT flag ORM query builders as SQL injection', async () => {
      const repoId = 'llm-fp-orm-queries';

      await createTestRepo(ctx, repoId, {
        'README.md': '# ORM Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/db/user-repository.ts': `
import { Repository } from 'typeorm';
import { User } from '../entities/user';

export class UserRepository {
  constructor(private repo: Repository<User>) {}

  async findByEmail(email: string): Promise<User | null> {
    // SAFE: TypeORM query builder with parameterized input
    return this.repo
      .createQueryBuilder('user')
      .where('user.email = :email', { email })
      .getOne();
  }

  async searchByName(name: string): Promise<User[]> {
    // SAFE: Using LIKE with ORM parameterization
    return this.repo
      .createQueryBuilder('user')
      .where('user.name LIKE :name', { name: \`%\${name}%\` })
      .getMany();
  }

  async findActive(): Promise<User[]> {
    // SAFE: Static query, no user input
    return this.repo.find({ where: { status: 'active' } });
  }
}
`,
      }, 'Add TypeORM repository with safe queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that ORM query builders with parameter ' +
        'binding (like TypeORM createQueryBuilder with :parameter syntax) are SAFE ' +
        'and should NOT be flagged as SQL injection. The analysis should have no ' +
        'SQL injection findings or explicitly acknowledge the code is safe.',
        analysisText,
        8
      );

      logTestResult('ORM query builder safety', evalResult);
      console.log(formatEvaluationResult('ORM query builder safety', evalResult));

      // Track false positive rate
      const sqlInjectionFindings = result.result.findings.filter(
        f => f.type.toLowerCase().includes('sql') ||
             f.description.toLowerCase().includes('sql injection')
      );
      if (sqlInjectionFindings.length > 0) {
        console.log('FALSE POSITIVE: Safe ORM code flagged as SQL injection');
        console.log('Findings:', JSON.stringify(sqlInjectionFindings, null, 2));
      }
    });

    it('does NOT flag Prisma queries as SQL injection', async () => {
      const repoId = 'llm-fp-prisma-queries';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Prisma Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/services/user-service.ts': `
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getUserByEmail(email: string) {
  // SAFE: Prisma automatically parameterizes all inputs
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function searchUsers(query: string) {
  // SAFE: Prisma's contains uses parameterized queries internally
  return prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { email: { contains: query } },
      ],
    },
  });
}

export async function createUser(name: string, email: string) {
  // SAFE: All data passed to Prisma is automatically sanitized
  return prisma.user.create({
    data: { name, email },
  });
}
`,
      }, 'Add Prisma service with safe queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that Prisma ORM queries are inherently ' +
        'safe from SQL injection because Prisma always uses parameterized queries. ' +
        'There should be no SQL injection findings for this code.',
        analysisText,
        8
      );

      logTestResult('Prisma query safety', evalResult);
      console.log(formatEvaluationResult('Prisma query safety', evalResult));
    });
  });

  describe('Safe Secret Handling', () => {
    it('does NOT flag environment variables as hardcoded secrets', async () => {
      const repoId = 'llm-fp-env-secrets';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Config Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/config.ts': `
// SAFE: All secrets come from environment variables
export const config = {
  apiKey: process.env.API_KEY || '',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET!,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
};

// SAFE: Environment variable check
if (!config.jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}

// SAFE: Placeholder for development documentation
const EXAMPLE_KEY = 'YOUR_API_KEY_HERE';  // This is a placeholder, not a real key
`,
      }, 'Add environment-based configuration');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that this code retrieves secrets from ' +
        'environment variables (process.env), which is the recommended secure pattern. ' +
        'It should NOT flag process.env references as hardcoded secrets. ' +
        'Placeholder strings like "YOUR_API_KEY_HERE" are also not real secrets.',
        analysisText,
        8
      );

      logTestResult('Environment variable safety', evalResult);
      console.log(formatEvaluationResult('Environment variable safety', evalResult));
    });

    it('does NOT flag encrypted/hashed values as secrets', async () => {
      const repoId = 'llm-fp-hashed-values';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Auth Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/auth/password.ts': `
import bcrypt from 'bcrypt';

// SAFE: These are hashed passwords used for testing, not actual secrets
const TEST_USERS = {
  alice: {
    email: 'alice@example.com',
    // This is a bcrypt hash, not a plaintext password
    passwordHash: '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  },
  bob: {
    email: 'bob@example.com',
    // Another bcrypt hash for testing
    passwordHash: '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm',
  },
};

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// SAFE: Using crypto for generating secure random values
import crypto from 'crypto';
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
`,
      }, 'Add password hashing utilities');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that bcrypt hashes (starting with $2b$) ' +
        'are NOT secrets - they are the output of secure password hashing. ' +
        'It should NOT flag password hashes as hardcoded secrets or credentials.',
        analysisText,
        8
      );

      logTestResult('Password hash recognition', evalResult);
      console.log(formatEvaluationResult('Password hash recognition', evalResult));
    });
  });

  describe('Safe HTML/XSS Patterns', () => {
    it('does NOT flag properly escaped HTML output', async () => {
      const repoId = 'llm-fp-escaped-html';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Web App',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/views/user-profile.tsx': `
import { escapeHtml } from '../utils/escape';
import DOMPurify from 'dompurify';

interface UserProfileProps {
  user: { name: string; bio: string };
}

export function UserProfile({ user }: UserProfileProps) {
  // SAFE: React automatically escapes content in JSX expressions
  return (
    <div className="profile">
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
    </div>
  );
}

export function RichBioDisplay({ bio }: { bio: string }) {
  // SAFE: Using DOMPurify to sanitize user HTML before rendering
  const sanitizedHtml = DOMPurify.sanitize(bio, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
    ALLOWED_ATTR: ['href'],
  });

  return <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}

export function ServerSideTemplate(name: string): string {
  // SAFE: Explicitly escaping user input before embedding in HTML
  const safeName = escapeHtml(name);
  return \`<h1>Welcome, \${safeName}!</h1>\`;
}
`,
        'src/utils/escape.ts': `
// Standard HTML escape function
export function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  };
  return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}
`,
      }, 'Add user profile components with safe HTML handling');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies safe XSS prevention patterns: ' +
        '1) React JSX automatically escapes content, ' +
        '2) DOMPurify sanitizes HTML before dangerouslySetInnerHTML, ' +
        '3) Manual HTML escaping function is used. ' +
        'These should NOT be flagged as XSS vulnerabilities.',
        analysisText,
        8
      );

      logTestResult('Safe HTML handling recognition', evalResult);
      console.log(formatEvaluationResult('Safe HTML handling recognition', evalResult));
    });
  });

  describe('Safe Path Handling', () => {
    it('does NOT flag validated path operations as path traversal', async () => {
      const repoId = 'llm-fp-safe-paths';

      await createTestRepo(ctx, repoId, {
        'README.md': '# File Service',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/files/file-service.ts': `
import path from 'path';
import { promises as fs } from 'fs';

const UPLOADS_DIR = '/var/app/uploads';

export async function getFile(filename: string): Promise<Buffer> {
  // SAFE: Validate filename has no path components
  if (filename.includes('/') || filename.includes('\\\\')) {
    throw new Error('Invalid filename: path separators not allowed');
  }

  // SAFE: Validate against path traversal
  const filePath = path.join(UPLOADS_DIR, filename);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(UPLOADS_DIR)) {
    throw new Error('Invalid path: attempted directory traversal');
  }

  return fs.readFile(resolvedPath);
}

export async function listFiles(subdir: string): Promise<string[]> {
  // SAFE: Normalize and validate the path
  const normalized = path.normalize(subdir).replace(/^\\.\\.\\//, '');
  const fullPath = path.resolve(UPLOADS_DIR, normalized);

  // SAFE: Ensure we stay within allowed directory
  if (!fullPath.startsWith(path.resolve(UPLOADS_DIR))) {
    throw new Error('Access denied: path outside uploads directory');
  }

  const entries = await fs.readdir(fullPath);
  return entries;
}
`,
      }, 'Add file service with path validation');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that this code has proper path traversal ' +
        'protection: it validates filenames, uses path.resolve() to get absolute paths, ' +
        'and checks that the resolved path starts with the allowed directory. ' +
        'This should NOT be flagged as a path traversal vulnerability.',
        analysisText,
        8
      );

      logTestResult('Path validation recognition', evalResult);
      console.log(formatEvaluationResult('Path validation recognition', evalResult));
    });
  });

  describe('Development/Test Code Recognition', () => {
    it('does NOT flag test fixtures as real vulnerabilities', async () => {
      const repoId = 'llm-fp-test-fixtures';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with Tests',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'tests/fixtures/vulnerable-code.ts': `
/**
 * INTENTIONALLY VULNERABLE CODE FOR TESTING SECURITY SCANNERS
 * DO NOT USE IN PRODUCTION
 */

// Used to test SQL injection detection
export function testSqlInjection(input: string) {
  return \`SELECT * FROM users WHERE name = '\${input}'\`;
}

// Used to test XSS detection
export function testXss(input: string) {
  return \`<div>\${input}</div>\`;
}

// Test credentials (not real)
export const TEST_API_KEY = 'test-key-12345-not-real';
export const TEST_PASSWORD = 'password123';
`,
        'tests/security-scanner.test.ts': `
import { testSqlInjection, testXss, TEST_API_KEY } from './fixtures/vulnerable-code';
import { SecurityScanner } from '../src/scanner';

describe('SecurityScanner', () => {
  it('detects SQL injection in test fixtures', () => {
    const code = testSqlInjection("'; DROP TABLE users; --");
    const findings = SecurityScanner.analyze(code);
    expect(findings).toContainEqual(expect.objectContaining({
      type: 'sql-injection',
    }));
  });
});
`,
      }, 'Add security scanner tests with intentional vulnerable fixtures');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        filesPaths: ['tests/fixtures/vulnerable-code.ts', 'tests/security-scanner.test.ts'],
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should recognize that code in test fixtures (tests/fixtures/) ' +
        'with clear comments like "INTENTIONALLY VULNERABLE" and "DO NOT USE IN PRODUCTION" ' +
        'is for testing purposes only. While it may note the patterns exist, it should ' +
        'acknowledge the testing context and not report them as production vulnerabilities.',
        analysisText,
        7
      );

      logTestResult('Test fixture recognition', evalResult);
      console.log(formatEvaluationResult('Test fixture recognition', evalResult));
    });
  });
});
