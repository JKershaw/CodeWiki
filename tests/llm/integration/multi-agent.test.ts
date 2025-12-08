/**
 * Integration LLM tests for Multi-Agent Flows.
 *
 * These tests verify that multiple agents working on the same
 * commit produce consistent, non-contradictory results.
 *
 * Run with: node --import tsx --test tests/llm/integration/multi-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
import { PatternAgent } from '../../../src/agents/analysis/pattern-agent.js';
import { CodeChangeAgent } from '../../../src/agents/analysis/code-change-agent.js';
import { createCommitTarget } from '../../../src/domain/work-target.js';
import { NarrativeAgent } from '../../../src/agents/analysis/narrative-agent.js';
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

describe('Multi-Agent Integration with Real LLM', { timeout: 300000 }, () => {
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

  describe('Analysis Consistency', () => {
    it('multiple agents produce consistent analysis on same commit', async () => {
      const repoId = 'llm-multi-agent-consistency';

      // Create repo with code that multiple agents can analyze
      await createTestRepo(ctx, repoId, {
        'README.md': '# User Authentication Service',
        'package.json': JSON.stringify({
          name: 'auth-service',
          dependencies: { 'express': '^4.18.0', 'bcrypt': '^5.0.0' },
        }, null, 2),
      });

      // Add a commit with code that triggers multiple agents:
      // - Security: password handling
      // - Pattern: repository pattern
      // - CodeChange: new service
      const commitSha = await addCommit(ctx, repoId, {
        'src/auth/user-repository.ts': `
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<User>;
}

export class PostgresUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    // Safe parameterized query
    const result = await this.db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  }

  async save(user: User): Promise<User> {
    const result = await this.db.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, user.email, user.passwordHash, user.role]
    );
    return result.rows[0];
  }
}
`,
        'src/auth/auth-service.ts': `
import { UserRepository } from './user-repository.js';
import bcrypt from 'bcrypt';

export class AuthService {
  constructor(private userRepo: UserRepository) {}

  async authenticate(email: string, password: string): Promise<boolean> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async register(email: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save({
      id: crypto.randomUUID(),
      email,
      passwordHash,
      role: 'user',
    });
  }
}
`,
      }, 'Add authentication service with repository pattern');

      const agentCtx = await ctx.agentContext(repoId);

      // Run multiple agents on the same commit
      console.log('Running SecurityAgent...');
      const securityAgent = new SecurityAgent();
      const securityResult = await securityAgent.run(createCommitTarget(commitSha), agentCtx);

      console.log('Running PatternAgent...');
      const patternAgent = new PatternAgent();
      const patternResult = await patternAgent.run(createCommitTarget(commitSha), agentCtx);

      console.log('Running CodeChangeAgent...');
      const codeChangeAgent = new CodeChangeAgent();
      const codeChangeResult = await codeChangeAgent.run(createCommitTarget(commitSha), agentCtx);

      // Combine all results for consistency check
      const combinedAnalysis = JSON.stringify({
        security: {
          summary: securityResult.result.summary,
          findings: securityResult.result.findings,
          wikiContent: securityResult.updates.map(u => u.content).join('\n'),
        },
        pattern: {
          summary: patternResult.result.summary,
          findings: patternResult.result.findings,
          wikiContent: patternResult.updates.map(u => u.content).join('\n'),
        },
        codeChange: {
          summary: codeChangeResult.result.summary,
          findings: codeChangeResult.result.findings,
          wikiContent: codeChangeResult.updates.map(u => u.content).join('\n'),
        },
      }, null, 2);

      // LLM-as-judge: Verify consistency across agents
      const evalResult = await evaluateLLM(
        'The analyses from different agents are consistent and complementary. ' +
        'Security analysis should note safe password handling (bcrypt). ' +
        'Pattern analysis should identify repository pattern. ' +
        'Code change analysis should describe adding authentication service. ' +
        'None of the analyses should contradict each other.',
        combinedAnalysis,
        6
      );

      logTestResult('Multi-agent consistency', evalResult);
      console.log(formatEvaluationResult('Multi-agent consistency', evalResult));

      // Also verify each agent produced output
      assert.ok(securityResult.result.summary, 'Security agent should produce summary');
      assert.ok(patternResult.result.summary, 'Pattern agent should produce summary');
      assert.ok(codeChangeResult.result.summary, 'CodeChange agent should produce summary');
    });

    it('analysis agents handle documentation commit appropriately', async () => {
      const repoId = 'llm-multi-agent-docs';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project Docs',
      });

      // Add a commit with only documentation (ADR)
      const commitSha = await addCommit(ctx, repoId, {
        'docs/adr/001-use-typescript.md': `
# ADR 001: Use TypeScript

## Status
Accepted

## Context
We need to choose a language for the backend service.

## Decision
We will use TypeScript for type safety and better developer experience.

## Consequences
- Better tooling and IDE support
- Learning curve for team members unfamiliar with TypeScript
- Need to configure build pipeline
`,
      }, 'Add ADR for TypeScript decision');

      const agentCtx = await ctx.agentContext(repoId);

      // Run narrative agent (should detect ADR)
      console.log('Running NarrativeAgent...');
      const narrativeAgent = new NarrativeAgent();
      const narrativeResult = await narrativeAgent.run(createCommitTarget(commitSha), agentCtx);

      // Run code change agent (should handle docs gracefully)
      console.log('Running CodeChangeAgent...');
      const codeChangeAgent = new CodeChangeAgent();
      const codeChangeResult = await codeChangeAgent.run(createCommitTarget(commitSha), agentCtx);

      const combinedAnalysis = JSON.stringify({
        narrative: {
          summary: narrativeResult.result.summary,
          findings: narrativeResult.result.findings,
          wikiContent: narrativeResult.updates.map(u => u.content).join('\n'),
        },
        codeChange: {
          summary: codeChangeResult.result.summary,
          findings: codeChangeResult.result.findings,
          wikiContent: codeChangeResult.updates.map(u => u.content).join('\n'),
        },
      }, null, 2);

      // LLM-as-judge: Verify both agents handle docs appropriately
      const evalResult = await evaluateLLM(
        'The agents appropriately handle a documentation-only commit. ' +
        'Narrative agent should identify the ADR about TypeScript. ' +
        'Code change agent should recognize this as documentation, not code changes. ' +
        'The analyses should be complementary, not contradictory.',
        combinedAnalysis,
        6
      );

      logTestResult('Documentation commit handling', evalResult);
      console.log(formatEvaluationResult('Documentation commit handling', evalResult));
    });
  });
});
