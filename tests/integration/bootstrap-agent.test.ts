/**
 * Integration tests for BootstrapAgent.
 * Tests the agent that creates foundation pages for empty wikis.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { BootstrapAgent } from '../../src/agents/synthesis/bootstrap-agent.js';

describe('BootstrapAgent', () => {
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

  describe('runOnWiki', () => {
    it('creates foundation pages on empty wiki', async () => {
      const repoId = 'bootstrap-empty-wiki';

      // Create a repo with typical project files
      await createTestRepo(ctx, repoId, {
        'README.md': '# My Awesome Project\n\nA tool for doing awesome things.\n\n## Installation\n\nnpm install',
        'package.json': JSON.stringify({
          name: 'my-awesome-project',
          version: '1.0.0',
          scripts: {
            build: 'tsc',
            test: 'node --test',
            start: 'node dist/index.js',
          },
        }, null, 2),
        'src/index.ts': 'export function main() { console.log("Hello"); }',
      });

      // Mock LLM response - agent outputs markdown directly
      ctx.llm.setDefaultResponse(`# My Awesome Project - Overview

A tool for doing awesome things.

## Purpose

This project provides utilities for doing awesome things. It is built with TypeScript and uses Node.js.

## Project Structure

- \`src/index.ts\` - Main entry point
- \`package.json\` - Project configuration

## Getting Started

1. Install dependencies: \`npm install\`
2. Build the project: \`npm run build\`
3. Run the project: \`npm start\`

## Key Commands

- \`npm run build\` - Compile TypeScript
- \`npm test\` - Run tests
- \`npm start\` - Start the application`);

      const agent = new BootstrapAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Should create foundation pages
      assert.ok(result.updates.length > 0, 'Should create at least one foundation page');

      // Should create an overview page
      const overviewUpdate = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewUpdate, 'Should create overview page');
      assert.strictEqual(overviewUpdate.type, 'create');
      assert.ok(overviewUpdate.content.includes('My Awesome Project'), 'Overview should include project name');

      // Should have moderate confidence (bootstrap is initial, not authoritative)
      assert.ok(result.result.confidence >= 0.5 && result.result.confidence <= 0.7,
        `Confidence should be moderate (0.5-0.7), got ${result.result.confidence}`);

      // Should have findings
      assert.ok(result.result.findings.length > 0, 'Should have findings about what was bootstrapped');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('skips when wiki already has pages', async () => {
      const repoId = 'bootstrap-existing-wiki';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      // Pre-populate wiki with an existing page
      await ctx.repos.wikiPages.save({
        id: 'existing-page-1',
        repoId,
        path: 'overview',
        title: 'Existing Overview',
        content: '# Existing Overview\n\nThis wiki already has content.',
        confidence: 0.7,
        sourceCommits: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const agent = new BootstrapAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Should skip - no updates, no LLM cost
      assert.strictEqual(result.updates.length, 0, 'Should not create any pages');
      assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost');
      assert.ok(result.result.summary.includes('already'), 'Summary should indicate wiki already has content');
    });

    it('handles repos with no README gracefully', async () => {
      const repoId = 'bootstrap-no-readme';

      // Create a repo with only source code, no README
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export function main() { return 42; }',
        'src/utils.ts': 'export function helper() { return "help"; }',
        'package.json': JSON.stringify({ name: 'mystery-project', version: '0.1.0' }),
      });

      // Mock LLM response for repo without README
      ctx.llm.setDefaultResponse(`# mystery-project - Overview

## Purpose

This project appears to be a Node.js application. No README was found, so this overview is based on the project structure.

## Project Structure

- \`src/index.ts\` - Main entry point
- \`src/utils.ts\` - Utility functions

## Getting Started

This project uses npm. Check package.json for available scripts.`);

      const agent = new BootstrapAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Should still create pages, even without README
      assert.ok(result.updates.length > 0, 'Should create pages even without README');

      // Confidence should be lower without README
      assert.ok(result.result.confidence <= 0.6,
        `Confidence should be lower without README, got ${result.result.confidence}`);
    });

    it('handles repos with PLAN.md instead of README', async () => {
      const repoId = 'bootstrap-plan-md';

      await createTestRepo(ctx, repoId, {
        'PLAN.md': '# Project Plan\n\n## Goals\n\n1. Build a wiki system\n2. Use AI agents\n\n## Architecture\n\nMulti-agent system with orchestrator.',
        'src/index.ts': 'export function main() {}',
      });

      ctx.llm.setDefaultResponse(`# Project Plan - Overview

## Goals

1. Build a wiki system
2. Use AI agents

## Architecture

Multi-agent system with orchestrator.

## Project Structure

- \`src/index.ts\` - Main entry point
- \`PLAN.md\` - Project planning document`);

      const agent = new BootstrapAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // Should create pages from PLAN.md
      assert.ok(result.updates.length > 0, 'Should create pages from PLAN.md');

      const overviewUpdate = result.updates.find(u => u.path === 'overview');
      assert.ok(overviewUpdate, 'Should create overview page');
      assert.ok(
        overviewUpdate.content.includes('Goals') || overviewUpdate.content.includes('Architecture'),
        'Overview should include content from PLAN.md'
      );
    });

    it('creates pages with appropriate confidence delta', async () => {
      const repoId = 'bootstrap-confidence';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test\n\nA test project.',
      });

      ctx.llm.setDefaultResponse(`# Test - Overview\n\nA test project overview.`);

      const agent = new BootstrapAgent();
      const result = await agent.runOnWiki(ctx.agentContext(repoId));

      // All bootstrap pages should have moderate confidence delta
      for (const update of result.updates) {
        assert.ok(
          update.confidenceDelta >= 0.4 && update.confidenceDelta <= 0.6,
          `Confidence delta should be moderate (0.4-0.6), got ${update.confidenceDelta} for ${update.path}`
        );
      }
    });
  });

  describe('runOnCommit', () => {
    it('throws error when called (bootstrap does not process commits)', async () => {
      const agent = new BootstrapAgent();

      await assert.rejects(
        async () => agent.runOnCommit('any-commit-id', ctx.agentContext('any-repo')),
        /does not run on commits/,
        'Should throw error explaining bootstrap does not run on commits'
      );
    });
  });
});
