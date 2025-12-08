/**
 * Real LLM tests for DependencyAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent detects new dependencies
 * 3. Agent identifies version updates
 *
 * Run with: node --import tsx --test tests/llm/dependency-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { DependencyAgent } from '../../src/agents/analysis/dependency-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';
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

describe('DependencyAgent with Real LLM', { timeout: 120000 }, () => {
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
      const repoId = 'llm-dependency-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          dependencies: {},
        }, null, 2),
      });

      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            'lodash': '^4.17.21',
          },
        }, null, 2),
      }, 'Add lodash dependency');

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Detection Accuracy', () => {
    it('detects new dependency addition', async () => {
      const repoId = 'llm-dependency-new';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Express App',
        'package.json': JSON.stringify({
          name: 'express-app',
          version: '1.0.0',
          dependencies: {
            'express': '^4.18.0',
          },
        }, null, 2),
      });

      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'express-app',
          version: '1.0.0',
          dependencies: {
            'express': '^4.18.0',
            'helmet': '^7.0.0',
            'cors': '^2.8.5',
          },
        }, null, 2),
      }, 'Add security middleware');

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify detection of new dependencies
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis identifies new dependencies being added. ' +
        'It should mention helmet and/or cors as new packages, ' +
        'possibly noting they are security or middleware related.',
        analysisText,
        7
      );

      logTestResult('New dependency detection', evalResult);
      console.log(formatEvaluationResult('New dependency detection', evalResult));
    });

    it('detects version update', async () => {
      const repoId = 'llm-dependency-update';

      await createTestRepo(ctx, repoId, {
        'README.md': '# React App',
        'package.json': JSON.stringify({
          name: 'react-app',
          version: '1.0.0',
          dependencies: {
            'react': '^17.0.2',
            'react-dom': '^17.0.2',
          },
        }, null, 2),
      });

      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'react-app',
          version: '1.0.0',
          dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0',
          },
        }, null, 2),
      }, 'Upgrade React to v18');

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify detection of version updates
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis identifies React version upgrade. ' +
        'It should mention updating from React 17 to React 18, ' +
        'or note a major version upgrade for React.',
        analysisText,
        7
      );

      logTestResult('Version update detection', evalResult);
      console.log(formatEvaluationResult('Version update detection', evalResult));
    });
  });
});
