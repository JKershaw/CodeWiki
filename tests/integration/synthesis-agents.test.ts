/**
 * Integration tests for synthesis agents (OverviewAgent, GettingStartedAgent).
 * Tests agents that generate wiki pages from aggregated information.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { OverviewAgent } from '../../src/agents/synthesis/overview-agent.js';
import { GettingStartedAgent } from '../../src/agents/synthesis/getting-started-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';

describe('Synthesis Agents', () => {
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

  /**
   * Helper to create wiki pages for testing.
   */
  async function createWikiPages(
    wikiId: string,
    pages: Array<{ path: string; title: string; content: string; links?: string[] }>
  ): Promise<void> {
    for (const page of pages) {
      await ctx.repos.wikiPages.save({
        id: `page-${page.path.replace(/\//g, '-')}`,
        wikiId,
        path: page.path,
        title: page.title,
        content: page.content,
        confidence: 0.8,
        sourceCommits: [],
        links: page.links ?? [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  describe('OverviewAgent', () => {
    describe('runOnWiki', () => {
      it('creates overview for category with enough pages', async () => {
        const repoId = 'overview-create';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test Project',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with 3+ pages but no overview
        await createWikiPages(wiki.id, [
          { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nHow to set up the project.' },
          { path: 'guides/deployment', title: 'Deployment Guide', content: '# Deployment\n\nHow to deploy.' },
          { path: 'guides/testing', title: 'Testing Guide', content: '# Testing\n\nHow to run tests.' },
          { path: 'api/reference', title: 'API Reference', content: '# API\n\nAPI docs.' },
        ]);

        // Mock LLM response for overview generation
        ctx.llm.setDefaultResponse(`TITLE:
Guides Overview

INTRODUCTION:
This section contains practical guides for working with the project. From initial setup through deployment, these guides will help you understand how to use and maintain the system.

The guides are designed to be read in order for new developers, but can also be used as standalone references for specific tasks.

KEY_CONCEPTS:
- Setup: Initial configuration and environment preparation
- Testing: How to run and write tests
- Deployment: Production deployment process

PAGES:
- guides/setup: Initial project setup and configuration
- guides/deployment: How to deploy to production
- guides/testing: Running and writing tests

READING_ORDER:
1. Start with Setup Guide for initial configuration
2. Then Testing Guide to verify your setup
3. Finally Deployment Guide when ready for production

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should create an overview page
        assert.strictEqual(result.updates.length, 1, 'Should create one overview page');

        const update = result.updates[0]!;
        assert.ok(update.path.includes('overview'), 'Should create overview page');
        assert.ok(update.content.includes('Guides'), 'Content should include category name');

        // Should have synthesis finding
        const synthesisFinding = result.result.findings.find(f =>
          f.type.toLowerCase().includes('synthesis')
        );
        assert.ok(synthesisFinding, 'Should have synthesis finding');

        // Should track cost
        assert.ok(result.costUsd > 0, 'Should incur LLM cost');
      });

      it('skips categories with too few pages', async () => {
        const repoId = 'overview-few-pages';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with only 2 pages (below threshold)
        await createWikiPages(wiki.id, [
          { path: 'guides/setup', title: 'Setup', content: '# Setup' },
          { path: 'guides/deploy', title: 'Deploy', content: '# Deploy' },
        ]);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should not create any pages
        assert.strictEqual(result.updates.length, 0, 'Should not create overview for small category');

        // Should not incur LLM cost
        assert.strictEqual(result.costUsd, 0, 'Should not make LLM call');
      });

      it('skips categories that already have overview', async () => {
        const repoId = 'overview-exists';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with overview already present
        await createWikiPages(wiki.id, [
          { path: 'guides/overview', title: 'Guides Overview', content: '# Guides Overview\n\nExisting overview.' },
          { path: 'guides/setup', title: 'Setup', content: '# Setup' },
          { path: 'guides/deploy', title: 'Deploy', content: '# Deploy' },
          { path: 'guides/testing', title: 'Testing', content: '# Testing' },
        ]);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should indicate all categories have overviews
        assert.ok(
          result.result.summary.toLowerCase().includes('all') ||
          result.result.summary.toLowerCase().includes('have overview'),
          'Should indicate category already has overview'
        );

        // Should not create pages
        assert.strictEqual(result.updates.length, 0, 'Should not create duplicate overview');
      });

      it('prioritizes larger categories', async () => {
        const repoId = 'overview-prioritize';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create two categories without overviews - one larger
        await createWikiPages(wiki.id, [
          // Small category (3 pages)
          { path: 'guides/setup', title: 'Setup', content: '# Setup' },
          { path: 'guides/deploy', title: 'Deploy', content: '# Deploy' },
          { path: 'guides/testing', title: 'Testing', content: '# Testing' },
          // Large category (5 pages)
          { path: 'api/users', title: 'Users API', content: '# Users' },
          { path: 'api/posts', title: 'Posts API', content: '# Posts' },
          { path: 'api/auth', title: 'Auth API', content: '# Auth' },
          { path: 'api/config', title: 'Config API', content: '# Config' },
          { path: 'api/webhooks', title: 'Webhooks API', content: '# Webhooks' },
        ]);

        ctx.llm.setDefaultResponse(`TITLE:
API Overview

INTRODUCTION:
The API documentation covers all endpoints available in the system.

KEY_CONCEPTS:
- REST: All APIs follow REST conventions

PAGES:
- api/users: User management endpoints
- api/posts: Content endpoints
- api/auth: Authentication endpoints

READING_ORDER:
Start with auth, then users, then posts.

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should create overview for the larger category first (api)
        assert.strictEqual(result.updates.length, 1, 'Should create one overview');
        assert.ok(
          result.updates[0]!.path.includes('api/overview'),
          'Should create overview for larger category (api)'
        );
      });

      it('throws error when called on commits', async () => {
        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext('any-repo');

        await assert.rejects(
          async () => agent.runOnCommit('any-commit', agentCtx),
          /does not run on commits/i,
          'Should throw error for commit target'
        );
      });
    });

    describe('agent type', () => {
      it('has correct agent type', () => {
        const agent = new OverviewAgent();
        assert.strictEqual(agent.type, 'overview', 'Agent type should be overview');
      });

      it('can handle wiki targets', () => {
        const agent = new OverviewAgent();
        assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
      });

      it('cannot handle commit targets', () => {
        const agent = new OverviewAgent();
        assert.ok(!agent.canHandle({ type: 'commit', commitId: 'abc' }), 'Should not handle commits');
      });
    });
  });

  describe('GettingStartedAgent', () => {
    describe('runOnWiki', () => {
      it('creates getting started guide when wiki is mature', async () => {
        const repoId = 'getting-started-create';

        // Create repo with package.json for the agent to read
        await createTestRepo(ctx, repoId, {
          'package.json': JSON.stringify({
            name: 'test-project',
            version: '1.0.0',
            scripts: {
              build: 'tsc',
              test: 'node --test',
              start: 'node dist/index.js',
            },
            engines: { node: '>=18.0.0' },
          }, null, 2),
          'README.md': '# Test Project\n\nA test project.',
          'src/index.ts': 'export function main() {}',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create 10+ wiki pages (threshold for guide)
        const pages = [];
        for (let i = 0; i < 12; i++) {
          pages.push({
            path: `docs/page-${i}`,
            title: `Documentation Page ${i}`,
            content: `# Page ${i}\n\nContent for page ${i}.`,
          });
        }
        await createWikiPages(wiki.id, pages);

        // Mock LLM response - the agent outputs markdown directly
        ctx.llm.setDefaultResponse(`# Getting Started

Welcome to the test-project!

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

\`\`\`bash
git clone <repo-url>
cd test-project
npm install
\`\`\`

## Running the Project

\`\`\`bash
npm run build   # Compile TypeScript
npm run test    # Run tests
npm start       # Start the application
\`\`\`

## Project Structure

\`\`\`
src/
  index.ts    # Main entry point
\`\`\`

## Next Steps

Check out the documentation pages for more details.`);

        const agent = new GettingStartedAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should create getting started guide
        assert.strictEqual(result.updates.length, 1, 'Should create one guide page');
        assert.ok(
          result.updates[0]!.path.includes('getting-started'),
          'Should create getting-started page'
        );

        // Should have synthesis finding
        const synthesisFinding = result.result.findings.find(f =>
          f.type.toLowerCase().includes('synthesis')
        );
        assert.ok(synthesisFinding, 'Should have synthesis finding');

        // Content should include actual commands from package.json
        const content = result.updates[0]!.content;
        assert.ok(content.includes('npm'), 'Content should include npm commands');

        // Should track cost
        assert.ok(result.costUsd > 0, 'Should incur LLM cost');
      });

      it('skips when wiki has too few pages', async () => {
        const repoId = 'getting-started-few';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create only 5 pages (below threshold of 10)
        await createWikiPages(wiki.id, [
          { path: 'overview', title: 'Overview', content: '# Overview' },
          { path: 'guides/setup', title: 'Setup', content: '# Setup' },
          { path: 'api/reference', title: 'API', content: '# API' },
          { path: 'architecture/main', title: 'Architecture', content: '# Arch' },
          { path: 'patterns/factory', title: 'Factory', content: '# Factory' },
        ]);

        const agent = new GettingStartedAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should indicate not enough pages
        assert.ok(
          result.result.summary.toLowerCase().includes('need') ||
          result.result.summary.includes('10'),
          'Should indicate wiki needs more pages'
        );

        // Should not create guide
        assert.strictEqual(result.updates.length, 0, 'Should not create guide');

        // Should not incur LLM cost
        assert.strictEqual(result.costUsd, 0, 'Should not make LLM call');
      });

      it('skips when getting started guide already exists', async () => {
        const repoId = 'getting-started-exists';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create 10+ pages including existing getting-started
        const pages = [
          { path: 'guides/getting-started', title: 'Getting Started', content: '# Getting Started\n\nExisting guide.' },
        ];
        for (let i = 0; i < 10; i++) {
          pages.push({
            path: `docs/page-${i}`,
            title: `Page ${i}`,
            content: `# Page ${i}`,
          });
        }
        await createWikiPages(wiki.id, pages);

        const agent = new GettingStartedAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.runOnWiki(agentCtx);

        // Should indicate guide exists
        assert.ok(
          result.result.summary.toLowerCase().includes('already exists'),
          'Should indicate guide already exists'
        );

        // Should not create duplicate
        assert.strictEqual(result.updates.length, 0, 'Should not create duplicate guide');
      });

      it('throws error when called on commits', async () => {
        const agent = new GettingStartedAgent();
        const agentCtx = await ctx.agentContext('any-repo');

        await assert.rejects(
          async () => agent.runOnCommit('any-commit', agentCtx),
          /does not run on commits/i,
          'Should throw error for commit target'
        );
      });
    });

    describe('agent type', () => {
      it('has correct agent type', () => {
        const agent = new GettingStartedAgent();
        assert.strictEqual(agent.type, 'getting-started', 'Agent type should be getting-started');
      });

      it('can handle wiki targets', () => {
        const agent = new GettingStartedAgent();
        assert.ok(agent.canHandle({ type: 'wiki' }), 'Should handle wiki targets');
      });

      it('cannot handle commit targets', () => {
        const agent = new GettingStartedAgent();
        assert.ok(!agent.canHandle({ type: 'commit', commitId: 'abc' }), 'Should not handle commits');
      });
    });
  });
});
