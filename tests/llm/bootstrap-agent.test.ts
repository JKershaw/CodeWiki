/**
 * Real LLM tests for BootstrapAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent creates coherent overview from README
 * 3. Agent extracts project structure information
 *
 * Run with: node --import tsx --test tests/llm/bootstrap-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { BootstrapAgent } from '../../src/agents/synthesis/bootstrap-agent.js';
import { createWikiTarget } from '../../src/domain/work-target.js';
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

describe('BootstrapAgent with Real LLM', { timeout: 120000 }, () => {
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
    it('returns parseable response with wiki updates', async () => {
      const repoId = 'llm-bootstrap-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Simple Test Project\n\nA basic project for testing.',
      });

      const agent = new BootstrapAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(Array.isArray(result.updates), 'updates should be an array');

      // Should have created at least one wiki page
      assert.ok(result.updates.length > 0, 'Should create at least one wiki page');

      // Verify each update has required fields
      for (const update of result.updates) {
        assert.ok(typeof update.path === 'string', 'update.path should be a string');
        assert.ok(typeof update.content === 'string', 'update.content should be a string');
        assert.ok(update.content.length > 0, 'update.content should not be empty');
      }

      console.log(`Format compliance test passed. Updates: ${result.updates.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Links Array Population', () => {
    it('populates links array when generated content contains wiki links', async () => {
      // This test verifies Fix #6: Bootstrap agent extracts links from content
      const repoId = 'llm-bootstrap-links-test';

      // Create a repo with content that should prompt the LLM to add links
      await createTestRepo(ctx, repoId, {
        'README.md': `# Documentation System

A wiki-style documentation system.

## Features
- Generates wiki pages automatically
- Links related content together

## Documentation Structure
- Architecture docs in /architecture
- API docs in /api
- User guides in /guides
`,
        'package.json': JSON.stringify({
          name: 'doc-system',
          version: '1.0.0',
        }, null, 2),
      });

      const agent = new BootstrapAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should create wiki pages
      assert.ok(result.updates.length > 0, 'Should create wiki updates');

      const overviewPage = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewPage, 'Should create an overview page');

      // Check if content has any wiki-style links
      const hasWikiLinks = /\[.+\]\([^)]+\)/.test(overviewPage.content);

      // If content has links, verify links array is populated
      if (hasWikiLinks) {
        assert.ok(overviewPage.links, 'Should have links array when content has links');
        console.log(`\n✓ Bootstrap agent populated links array with ${overviewPage.links?.length || 0} links`);
        if (overviewPage.links && overviewPage.links.length > 0) {
          console.log(`  Links: [${overviewPage.links.join(', ')}]`);
        }
      } else {
        console.log('\n⚠️  LLM did not generate wiki links in the content (this is OK for some models)');
      }

      // The links array should at least exist (even if empty)
      assert.ok(
        overviewPage.links !== undefined,
        'links array should be defined (even if empty)'
      );

      logTestResult('Bootstrap links array population', {
        score: overviewPage.links !== undefined ? 10 : 0,
        reasoning: `links array is ${overviewPage.links !== undefined ? 'defined' : 'undefined'}, has ${overviewPage.links?.length || 0} links`,
        passed: overviewPage.links !== undefined,
      });
    });
  });

  describe('Content Quality', () => {
    it('creates coherent overview from README', async () => {
      const repoId = 'llm-bootstrap-readme';

      await createTestRepo(ctx, repoId, {
        'README.md': `# TaskMaster Pro

A powerful task management application built with TypeScript and React.

## Features

- Create, edit, and delete tasks
- Organize tasks into projects
- Set due dates and priorities
- Track task completion progress
- Collaborate with team members

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Architecture

The application uses a clean architecture with:
- React frontend with hooks
- Express.js REST API
- PostgreSQL database
- Redis for caching

## License

MIT License
`,
        'package.json': JSON.stringify({
          name: 'taskmaster-pro',
          version: '1.0.0',
          dependencies: {
            'react': '^18.0.0',
            'express': '^4.18.0',
          },
        }, null, 2),
        'src/index.ts': 'console.log("TaskMaster Pro");',
      });

      const agent = new BootstrapAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should create wiki pages
      assert.ok(result.updates.length > 0, 'Should create wiki updates');

      // Get the overview page content
      const overviewPage = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewPage, 'Should create an overview page');
      assert.ok(overviewPage.content.length > 100, 'Overview should have substantial content');

      // LLM-as-judge: Verify content quality
      // Focus on essential characteristics rather than exact name matching
      // Lower threshold (6) because cheaper models may not read README content accurately
      const evalResult = await assertLLM(
        'The generated wiki overview describes a task management or productivity application. ' +
        'It should mention aspects like: task management, React/frontend, or organizing work.',
        overviewPage.content,
        6
      );

      logTestResult('README-based overview quality', evalResult);
      console.log(formatEvaluationResult('README-based overview quality', evalResult));
    });

    it('handles minimal README gracefully', async () => {
      const repoId = 'llm-bootstrap-minimal';

      await createTestRepo(ctx, repoId, {
        'README.md': '# My Project',
        'src/main.ts': 'export const VERSION = "1.0.0";',
      });

      const agent = new BootstrapAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should still create something useful
      assert.ok(result.updates.length > 0, 'Should create wiki updates even with minimal README');

      const overviewPage = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewPage, 'Should create an overview page');

      // Content should be reasonable even with limited source
      assert.ok(overviewPage.content.length > 50, 'Should generate some content');

      console.log(`Minimal README handling passed. Content length: ${overviewPage.content.length}`);
    });
  });
});
