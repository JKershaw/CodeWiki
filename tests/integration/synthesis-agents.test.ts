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
import { createWikiTarget, createCommitTarget } from '../../src/domain/work-target.js';

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
    describe('run (wiki target)', () => {
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

        const result = await agent.run(createWikiTarget(), agentCtx);

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

      it('generates links without .md extension', async () => {
        const repoId = 'overview-no-md-ext';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test Project',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with 3+ pages
        await createWikiPages(wiki.id, [
          { path: 'agents/code-change', title: 'Code Change Agent', content: '# Code Change\n\nAnalyzes code changes.' },
          { path: 'agents/link', title: 'Link Agent', content: '# Link Agent\n\nCreates links.' },
          { path: 'agents/quality', title: 'Quality Agent', content: '# Quality Agent\n\nChecks quality.' },
        ]);

        // Mock LLM response
        ctx.llm.setDefaultResponse(`TITLE:
Agents Overview

INTRODUCTION:
Overview of the agent system.

KEY_CONCEPTS:
- Agents: Automated processors

PAGES:
- agents/code-change: Analyzes code
- agents/link: Creates links
- agents/quality: Checks quality

READING_ORDER:
1. Code Change Agent
2. Link Agent

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        assert.strictEqual(result.updates.length, 1, 'Should create one overview page');

        const update = result.updates[0]!;

        // Critical assertion: Links should NOT have .md extension
        assert.ok(!update.content.includes('.md)'), 'Links should not have .md extension');
        assert.ok(!update.content.includes('.md]'), 'Links should not have .md in link text');

        // Links should be in correct format: [Title](path) without .md
        assert.ok(
          update.content.includes('](agents/code-change)') ||
          update.content.includes('](agents/link)') ||
          update.content.includes('](agents/quality)'),
          'Links should use path without .md extension'
        );
      });

      it('populates links array in WikiPageUpdate for graph tracking', async () => {
        const repoId = 'overview-links-array';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test Project',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with 3+ pages
        await createWikiPages(wiki.id, [
          { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nHow to set up.' },
          { path: 'guides/deploy', title: 'Deploy Guide', content: '# Deploy\n\nHow to deploy.' },
          { path: 'guides/testing', title: 'Testing Guide', content: '# Testing\n\nHow to test.' },
        ]);

        // Mock LLM response
        ctx.llm.setDefaultResponse(`TITLE:
Guides Overview

INTRODUCTION:
Practical guides for the project.

KEY_CONCEPTS:
- Setup: Configuration

PAGES:
- guides/setup: Initial setup
- guides/deploy: Deployment process
- guides/testing: Testing strategies

READING_ORDER:
Start with setup.

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        assert.strictEqual(result.updates.length, 1, 'Should create one overview page');

        const update = result.updates[0]!;

        // Critical: links array should be populated for graph tracking
        assert.ok(update.links, 'Update should have links array');
        assert.ok(Array.isArray(update.links), 'links should be an array');
        assert.ok(update.links.length >= 3, 'Should have at least 3 links (one per page)');

        // Links should include the category pages
        assert.ok(update.links.includes('guides/setup'), 'Should link to guides/setup');
        assert.ok(update.links.includes('guides/deploy'), 'Should link to guides/deploy');
        assert.ok(update.links.includes('guides/testing'), 'Should link to guides/testing');
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

        const result = await agent.run(createWikiTarget(), agentCtx);

        // Should not create any pages
        assert.strictEqual(result.updates.length, 0, 'Should not create overview for small category');

        // Should not incur LLM cost
        assert.strictEqual(result.costUsd, 0, 'Should not make LLM call');
      });

      it('skips categories that already have complete overview', async () => {
        const repoId = 'overview-exists';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with overview that already lists ALL pages
        await createWikiPages(wiki.id, [
          {
            path: 'guides/overview',
            title: 'Guides Overview',
            content: `# Guides Overview

Existing overview content.

## Pages in this Category

- [Setup](guides/setup)
- [Deploy](guides/deploy)
- [Testing](guides/testing)
`,
          },
          { path: 'guides/setup', title: 'Setup', content: '# Setup' },
          { path: 'guides/deploy', title: 'Deploy', content: '# Deploy' },
          { path: 'guides/testing', title: 'Testing', content: '# Testing' },
        ]);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        // Should indicate all categories have overviews (or are too small)
        assert.ok(
          result.result.summary.toLowerCase().includes('all') ||
          result.result.summary.toLowerCase().includes('have overview'),
          'Should indicate category already has overview'
        );

        // Should not create pages - overview is complete
        assert.strictEqual(result.updates.length, 0, 'Should not update complete overview');

        // Should not incur LLM cost
        assert.strictEqual(result.costUsd, 0, 'Should not make LLM call');
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

        const result = await agent.run(createWikiTarget(), agentCtx);

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
          async () => agent.run(createCommitTarget('any-commit'), agentCtx),
          /cannot handle target type/i,
          'Should throw error for commit target'
        );
      });

      it('updates existing overview when new pages are added to category', async () => {
        const repoId = 'overview-update-new-pages';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test Project',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create category with existing overview that only lists 2 pages
        await createWikiPages(wiki.id, [
          {
            path: 'guides/overview',
            title: 'Guides Overview',
            content: `# Guides Overview

This section contains guides.

## Pages in this Category

- [Setup Guide](guides/setup)
- [Deploy Guide](guides/deploy)
`,
          },
          { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nHow to set up.' },
          { path: 'guides/deploy', title: 'Deploy Guide', content: '# Deploy\n\nHow to deploy.' },
          // NEW pages added after overview was created
          { path: 'guides/testing', title: 'Testing Guide', content: '# Testing\n\nHow to test.' },
          { path: 'guides/monitoring', title: 'Monitoring Guide', content: '# Monitoring\n\nHow to monitor.' },
        ]);

        // Mock LLM response for updated overview
        ctx.llm.setDefaultResponse(`TITLE:
Guides Overview

INTRODUCTION:
This section contains practical guides covering setup, deployment, testing, and monitoring.

KEY_CONCEPTS:
- Setup: Initial configuration
- Testing: Quality assurance
- Deployment: Production release
- Monitoring: System health

PAGES:
- guides/setup: Initial project setup
- guides/deploy: Deployment process
- guides/testing: Testing strategies
- guides/monitoring: Monitoring setup

READING_ORDER:
1. Setup Guide
2. Testing Guide
3. Deploy Guide
4. Monitoring Guide

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        // Should create an update for the existing overview
        assert.strictEqual(result.updates.length, 1, 'Should create one update');

        const update = result.updates[0]!;
        assert.strictEqual(update.type, 'update', 'Should be an update, not create');
        assert.strictEqual(update.path, 'guides/overview', 'Should update the existing overview');

        // Updated content should include the new pages
        assert.ok(update.content.includes('testing') || update.content.includes('Testing'), 'Updated overview should mention testing');
        assert.ok(update.content.includes('monitoring') || update.content.includes('Monitoring'), 'Updated overview should mention monitoring');

        // Should incur LLM cost
        assert.ok(result.costUsd > 0, 'Should incur LLM cost');
      });

      it('detects stale overview based on unlisted pages', async () => {
        const repoId = 'overview-stale-detection';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create overview that lists only 2 pages but category has 4
        await createWikiPages(wiki.id, [
          {
            path: 'api/overview',
            title: 'API Overview',
            content: `# API Overview

## Pages in this Category

- [Users API](api/users)
- [Posts API](api/posts)
`,
          },
          { path: 'api/users', title: 'Users API', content: '# Users' },
          { path: 'api/posts', title: 'Posts API', content: '# Posts' },
          { path: 'api/auth', title: 'Auth API', content: '# Auth' },  // Not listed
          { path: 'api/config', title: 'Config API', content: '# Config' },  // Not listed
        ]);

        ctx.llm.setDefaultResponse(`TITLE:
API Overview

INTRODUCTION:
Complete API documentation.

KEY_CONCEPTS:
- REST: RESTful endpoints

PAGES:
- api/users: User management
- api/posts: Content management
- api/auth: Authentication
- api/config: Configuration

READING_ORDER:
Start with auth.

CONFIDENCE: 0.85`);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        // Should detect that overview is stale and update it
        assert.strictEqual(result.updates.length, 1, 'Should generate update for stale overview');
        assert.strictEqual(result.updates[0]!.type, 'update', 'Should be update type');
      });

      it('does not update overview when all pages are already listed', async () => {
        const repoId = 'overview-already-complete';

        await createTestRepo(ctx, repoId, {
          'README.md': '# Test',
        });

        const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

        // Create overview that already lists all pages
        await createWikiPages(wiki.id, [
          {
            path: 'docs/overview',
            title: 'Docs Overview',
            content: `# Docs Overview

## Pages in this Category

- [Setup](docs/setup)
- [Usage](docs/usage)
- [FAQ](docs/faq)
`,
          },
          { path: 'docs/setup', title: 'Setup', content: '# Setup' },
          { path: 'docs/usage', title: 'Usage', content: '# Usage' },
          { path: 'docs/faq', title: 'FAQ', content: '# FAQ' },
        ]);

        const agent = new OverviewAgent();
        const agentCtx = await ctx.agentContext(repoId);

        const result = await agent.run(createWikiTarget(), agentCtx);

        // Should not update - all pages already listed
        assert.strictEqual(result.updates.length, 0, 'Should not update complete overview');
        assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost');
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
    describe('run (wiki target)', () => {
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

        const result = await agent.run(createWikiTarget(), agentCtx);

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

        const result = await agent.run(createWikiTarget(), agentCtx);

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

        const result = await agent.run(createWikiTarget(), agentCtx);

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
          async () => agent.run(createCommitTarget('any-commit'), agentCtx),
          /cannot handle target type/i,
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
