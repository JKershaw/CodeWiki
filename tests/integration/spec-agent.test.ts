/**
 * Integration tests for SpecAgent.
 * Tests spec generation with real repositories.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { SpecAgent } from '../../src/agents/spec/spec-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';

describe('SpecAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    ctx.llm.reset();
  });

  it('finds wiki content when pages exist for the wiki', async () => {
    const repoId = 'spec-test-repo';
    await createTestRepo(ctx, repoId);

    // Get the wiki for this repo
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create wiki pages directly with the correct wikiId
    await ctx.repos.wikiPages.save({
      id: 'spec-page-1',
      wikiId: wiki.id,
      path: 'architecture/api-patterns',
      title: 'API Design Patterns',
      content: `# API Design Patterns

This codebase uses REST API patterns with Express.js.

## Endpoints
- GET /api/resources - List resources
- POST /api/resources - Create resource

## Authentication
JWT tokens are used for authentication.`,
      confidence: 0.8,
      sourceCommits: ['abc1234'],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.repos.wikiPages.save({
      id: 'spec-page-2',
      wikiId: wiki.id,
      path: 'guides/testing',
      title: 'Testing Guide',
      content: `# Testing Guide

Tests are written using Node test runner.

## Unit Tests
Located in tests/unit/

## Integration Tests
Located in tests/integration/`,
      confidence: 0.7,
      sourceCommits: ['def5678'],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Configure mock LLM response
    ctx.llm.setDefaultResponse(`INTERPRETATION: Add a new API endpoint for user management.

CONTEXT: The codebase uses Express.js with REST patterns. Authentication uses JWT.

KEY_FILES:
- src/api/routes.ts
- src/controllers/user.ts

PATTERNS: Follow REST conventions with standard HTTP methods.

CONVENTIONS: Use camelCase for function names.

DEPENDENCIES: Express router, JWT middleware.

TESTING: Add tests in tests/unit/ and tests/integration/.

PITFALLS: Ensure JWT validation on protected routes.

CONFIDENCE: 0.8`);

    // Create spec agent and generate spec
    const specAgent = new SpecAgent(ctx.repos, ctx.llm);
    const result = await specAgent.generateSpec(wiki.id, 'Add a new API endpoint');

    // The critical assertion: spec should find wiki content
    assert.notStrictEqual(result.interpretation, 'Unable to interpret task - no wiki content available.');
    assert.ok(result.searchedPages > 0, 'Should have searched some pages');
    assert.ok(result.sources.length > 0, 'Should have sources from wiki');
    assert.ok(result.confidence > 0, 'Should have non-zero confidence');
  });

  it('returns no-content message when wiki has no pages', async () => {
    const repoId = 'spec-empty-repo';
    await createTestRepo(ctx, repoId);

    // Get wiki but don't add any pages
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    // Create spec agent and generate spec
    const specAgent = new SpecAgent(ctx.repos, ctx.llm);
    const result = await specAgent.generateSpec(wiki.id, 'Add a new feature');

    // Should return the no-content message
    assert.strictEqual(result.interpretation, 'Unable to interpret task - no wiki content available.');
    assert.strictEqual(result.searchedPages, 0);
    assert.strictEqual(result.sources.length, 0);
    assert.strictEqual(result.confidence, 0);
  });

  it('fails to find wiki content when given repoId instead of wikiId (bug case)', async () => {
    const repoId = 'spec-bugtest-repo';
    await createTestRepo(ctx, repoId);

    // Get the wiki and add pages
    const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

    await ctx.repos.wikiPages.save({
      id: 'bugtest-page',
      wikiId: wiki.id,
      path: 'test/page',
      title: 'Test Page',
      content: '# Test Page\n\nThis has content.',
      confidence: 0.8,
      sourceCommits: ['xyz789'],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    ctx.llm.setDefaultResponse('INTERPRETATION: Test\nCONTEXT: Test\nKEY_FILES:\nPATTERNS: Test\nCONVENTIONS: Test\nDEPENDENCIES: Test\nTESTING: Test\nPITFALLS: Test\nCONFIDENCE: 0.8');

    const specAgent = new SpecAgent(ctx.repos, ctx.llm);

    // If we pass wiki.id (correct), we should find content
    const correctResult = await specAgent.generateSpec(wiki.id, 'Test task');
    assert.ok(correctResult.searchedPages > 0, 'Correct wikiId should find pages');

    // If we pass repoId (incorrect/bug), we should NOT find content
    // because repoId is not a valid wikiId
    const buggyResult = await specAgent.generateSpec(repoId, 'Test task');
    assert.strictEqual(buggyResult.searchedPages, 0, 'RepoId should not find pages (demonstrates the bug)');
  });
});
