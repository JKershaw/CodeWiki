/**
 * Integration tests for the category system.
 * Tests the complete flow from CategoryAgent through to consolidation.
 *
 * Run with: node --import tsx --test tests/integration/category-system.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CategoryAgent } from '../../src/agents/meta/category-agent.js';
import { createWikiTarget } from '../../src/domain/work-target.js';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/test-context.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { FindingType } from '../../src/domain/finding.js';

describe('Category System Integration', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  describe('Bug #1: Finding type must be lowercase category_mismatch', () => {
    it('creates findings with correct lowercase type', async () => {
      const repoId = 'category-bug1-test';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create pages where one is miscategorized
      const pages: WikiPage[] = [
        {
          id: 'page-1',
          wikiId: agentCtx.wikiId,
          path: 'guides/sql-injection', // In guides but should be security
          title: 'SQL Injection Prevention',
          content: '# SQL Injection Prevention\n\nSQL injection is a critical security vulnerability...',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-2',
          wikiId: agentCtx.wikiId,
          path: 'security/overview',
          title: 'Security Overview',
          content: '# Security Overview\n\nProject security practices.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const page of pages) {
        await ctx.repos.wikiPages.save(page);
      }

      // Mock LLM to return a category mismatch
      ctx.llm.setDefaultResponse(`- path: guides/sql-injection | current: guides | suggested: security | reason: SQL injection is a security topic
- path: security/overview | current: security | suggested: security | reason: correct

CONFIDENCE: 0.85`);

      const agent = new CategoryAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should have findings
      assert.ok(result.result.findings.length > 0, 'Should have at least one finding');

      // The finding type should be lowercase 'category_mismatch', not uppercase
      const finding = result.result.findings[0]!;

      // This is what we're testing - the type should match FindingType
      const validFindingTypes: FindingType[] = [
        'duplicate_title', 'similar_content', 'broken_link', 'orphaned_page',
        'terminology', 'category_mismatch', 'contradiction', 'low_quality', 'inaccurate'
      ];

      assert.ok(
        validFindingTypes.includes(finding.type as FindingType),
        `Finding type "${finding.type}" should be a valid FindingType (lowercase). Got: ${finding.type}`
      );

      // More specifically, it should be 'category_mismatch'
      assert.strictEqual(
        finding.type,
        'category_mismatch',
        `Finding type should be 'category_mismatch' (lowercase), got '${finding.type}'`
      );
    });
  });

  describe('Bug #2: Findings must be saved to repository', () => {
    it('persists category mismatch findings to the findings repository', async () => {
      const repoId = 'category-bug2-test';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create pages where one is miscategorized
      const pages: WikiPage[] = [
        {
          id: 'page-b2-1',
          wikiId: agentCtx.wikiId,
          path: 'guides/xss-attacks', // In guides but should be security
          title: 'XSS Attack Prevention',
          content: '# XSS Attack Prevention\n\nCross-site scripting (XSS) is a security vulnerability...',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-b2-2',
          wikiId: agentCtx.wikiId,
          path: 'security/auth',
          title: 'Authentication',
          content: '# Authentication\n\nHow authentication works.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const page of pages) {
        await ctx.repos.wikiPages.save(page);
      }

      // Mock LLM to return a category mismatch
      ctx.llm.setDefaultResponse(`- path: guides/xss-attacks | current: guides | suggested: security | reason: XSS is a security vulnerability
- path: security/auth | current: security | suggested: security | reason: correct

CONFIDENCE: 0.9`);

      const agent = new CategoryAgent();
      await agent.run(createWikiTarget(), agentCtx);

      // Check that findings were persisted to the repository
      const savedFindings = await ctx.repos.findings.findByWiki(agentCtx.wikiId);

      assert.ok(
        savedFindings.length > 0,
        'CategoryAgent should save findings to the repository'
      );

      // Find the category mismatch finding
      const categoryFinding = savedFindings.find(f => f.type === 'category_mismatch');
      assert.ok(
        categoryFinding,
        'Should have a category_mismatch finding saved in the repository'
      );

      // Verify it has the correct data
      assert.ok(
        categoryFinding.affectedPaths.includes('guides/xss-attacks'),
        'Finding should reference the affected page path'
      );
    });
  });

  describe('Bug #3: WikiPage.category field must be settable', () => {
    it('allows setting category field when updating a page', async () => {
      const repoId = 'category-bug3-test';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create a page
      const page: WikiPage = {
        id: 'page-b3-1',
        wikiId: agentCtx.wikiId,
        path: 'security/auth',
        title: 'Authentication',
        content: '# Authentication\n\nHow auth works.',
        confidence: 0.7,
        sourceCommits: ['abc123'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);

      // Update the page with category information
      await ctx.repos.wikiPages.updateContent(page.id, {
        content: page.content,
        category: 'security',
        categoryConfidence: 0.95,
      });

      // Retrieve the page and check category is set
      const updatedPage = await ctx.repos.wikiPages.findById(page.id);

      assert.ok(updatedPage, 'Page should exist');
      assert.strictEqual(
        updatedPage.category,
        'security',
        'Page category should be set to "security"'
      );
      assert.strictEqual(
        updatedPage.categoryConfidence,
        0.95,
        'Page categoryConfidence should be set to 0.95'
      );
    });

    it('category field appears in wiki graph query', async () => {
      const repoId = 'category-bug3-graph-test';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create a page with category set
      const page: WikiPage = {
        id: 'page-b3-graph-1',
        wikiId: agentCtx.wikiId,
        path: 'api/endpoints',
        title: 'API Endpoints',
        content: '# API Endpoints\n\nREST API documentation.',
        confidence: 0.8,
        category: 'api',
        categoryConfidence: 0.9,
        sourceCommits: ['abc123'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(page);

      // Query using findByWiki and check category is preserved
      const pages = await ctx.repos.wikiPages.findByWiki(agentCtx.wikiId);
      const foundPage = pages.find(p => p.id === page.id);

      assert.ok(foundPage, 'Page should be found');
      assert.strictEqual(
        foundPage.category,
        'api',
        'Category should be preserved when querying pages'
      );
    });
  });

  describe('End-to-end category flow', () => {
    it('CategoryAgent detects mismatch, saves finding, and finding can be retrieved', async () => {
      const repoId = 'category-e2e-test';
      await createTestRepo(ctx, repoId, { 'README.md': '# Test' });
      const agentCtx = await ctx.agentContext(repoId);

      // Create pages
      const pages: WikiPage[] = [
        {
          id: 'page-e2e-1',
          wikiId: agentCtx.wikiId,
          path: 'guides/csrf-protection',
          title: 'CSRF Protection',
          content: '# CSRF Protection\n\nCross-site request forgery prevention techniques.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'page-e2e-2',
          wikiId: agentCtx.wikiId,
          path: 'security/overview',
          title: 'Security Overview',
          content: '# Security Overview\n\nSecurity practices.',
          confidence: 0.7,
          sourceCommits: ['abc123'],
          sourceAgentRunIds: [],
          links: [],
          backlinks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      for (const page of pages) {
        await ctx.repos.wikiPages.save(page);
      }

      // Mock LLM response
      ctx.llm.setDefaultResponse(`- path: guides/csrf-protection | current: guides | suggested: security | reason: CSRF is a security topic
- path: security/overview | current: security | suggested: security | reason: correct

CONFIDENCE: 0.85`);

      // Run CategoryAgent
      const agent = new CategoryAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Verify agent returned findings
      assert.ok(result.result.findings.length > 0, 'Agent should return findings');

      // Verify findings were saved to repository
      const openFindings = await ctx.repos.findings.findOpen(agentCtx.wikiId);
      const categoryFindings = openFindings.filter(f => f.type === 'category_mismatch');

      assert.ok(
        categoryFindings.length > 0,
        'Category mismatch findings should be saved and retrievable'
      );

      // Verify the finding has correct metadata
      const finding = categoryFindings[0]!;
      assert.strictEqual(finding.status, 'open', 'Finding should have open status');
      assert.ok(
        finding.description.includes('security'),
        'Finding description should mention the suggested category'
      );
    });
  });
});
