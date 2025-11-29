/**
 * Integration tests for TableOfContentsAgent.
 * Tests the agent that adds table of contents to wiki pages.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import { TableOfContentsAgent } from '../../src/agents/synthesis/toc-agent.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('TableOfContentsAgent', () => {
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
   * Helper to create a wiki page with specified content.
   */
  async function createPage(
    wikiId: string,
    id: string,
    path: string,
    title: string,
    content: string,
    confidence: number = 0.7
  ): Promise<WikiPage> {
    const page: WikiPage = {
      id,
      wikiId,
      path,
      title,
      content,
      confidence,
      sourceCommits: [],
      links: [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await ctx.repos.wikiPages.save(page);
    return page;
  }

  describe('runOnWiki', () => {
    it('adds TOC to pages with 3+ headings', async () => {
      const repoId = 'toc-multiple-headings';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page with multiple headings but no TOC
      const contentWithHeadings = `# Architecture Guide

This guide explains the architecture.

## Overview

The system uses a modular architecture.

## Components

The main components are listed below.

### Services

Services handle business logic.

### Repositories

Repositories handle data access.

## Conclusion

This covers the basics.`;

      await createPage(wiki.id, 'arch-guide', 'architecture/guide', 'Architecture Guide', contentWithHeadings);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should add TOC to the architecture guide
      assert.ok(result.updates.length > 0, 'Should update at least one page');

      const archUpdate = result.updates.find(u => u.path === 'architecture/guide');
      assert.ok(archUpdate, 'Should update architecture guide');
      assert.ok(archUpdate.content.includes('## Table of Contents'), 'Should add TOC heading');
      assert.ok(archUpdate.content.includes('[Overview]'), 'Should include Overview link');
      assert.ok(archUpdate.content.includes('[Components]'), 'Should include Components link');
      assert.ok(archUpdate.content.includes('[Services]'), 'Should include Services link (nested)');
      assert.ok(archUpdate.content.includes('[Conclusion]'), 'Should include Conclusion link');

      // Should have no LLM cost
      assert.strictEqual(result.costUsd, 0, 'Should have no LLM cost');
    });

    it('skips pages with less than 3 headings', async () => {
      const repoId = 'toc-few-headings';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page with only 2 headings (h2 and below)
      const contentFewHeadings = `# Simple Page

Introduction paragraph.

## Section One

Content for section one.`;

      await createPage(wiki.id, 'simple-page', 'docs/simple', 'Simple Page', contentFewHeadings);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not update the simple page
      const simpleUpdate = result.updates.find(u => u.path === 'docs/simple');
      assert.ok(!simpleUpdate, 'Should not add TOC to page with few headings');
    });

    it('skips pages that already have TOC', async () => {
      const repoId = 'toc-already-exists';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page that already has TOC
      const contentWithToc = `# Guide

## Table of Contents

- [Section One](#section-one)
- [Section Two](#section-two)
- [Section Three](#section-three)

## Section One

Content one.

## Section Two

Content two.

## Section Three

Content three.`;

      await createPage(wiki.id, 'has-toc', 'docs/with-toc', 'Guide', contentWithToc);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not update the page with existing TOC
      const tocUpdate = result.updates.find(u => u.path === 'docs/with-toc');
      assert.ok(!tocUpdate, 'Should not add TOC to page that already has one');
    });

    it('skips navigation and index pages', async () => {
      const repoId = 'toc-skip-nav';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create navigation pages with many headings
      const navContent = `# Navigation

## Section A

Links here.

## Section B

More links.

## Section C

Even more.`;

      await createPage(wiki.id, 'nav-page', 'navigation/main', 'Navigation', navContent);
      await createPage(wiki.id, 'index-page', 'guides/index', 'Guides Index', navContent);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not update navigation or index pages
      const navUpdate = result.updates.find(u => u.path === 'navigation/main');
      const indexUpdate = result.updates.find(u => u.path === 'guides/index');
      assert.ok(!navUpdate, 'Should not add TOC to navigation page');
      assert.ok(!indexUpdate, 'Should not add TOC to index page');
    });

    it('skips low-confidence pages', async () => {
      const repoId = 'toc-low-confidence';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page with low confidence
      const content = `# Low Confidence Page

## Section One

Content.

## Section Two

More content.

## Section Three

Even more.`;

      await createPage(wiki.id, 'low-conf', 'docs/uncertain', 'Uncertain', content, 0.3);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not update low-confidence page
      const lowConfUpdate = result.updates.find(u => u.path === 'docs/uncertain');
      assert.ok(!lowConfUpdate, 'Should not add TOC to low-confidence page');
    });

    it('handles nested headings with proper indentation', async () => {
      const repoId = 'toc-nested-headings';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page with deeply nested headings
      const content = `# API Reference

## Endpoints

### GET /users

Get all users.

### POST /users

Create a user.

#### Request Body

The request body format.

#### Response

The response format.

## Authentication

How to authenticate.`;

      await createPage(wiki.id, 'api-ref', 'api/reference', 'API Reference', content);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      const apiUpdate = result.updates.find(u => u.path === 'api/reference');
      assert.ok(apiUpdate, 'Should update API reference');

      // Check indentation in TOC (h3 should be indented 2 spaces, h4 should be 4 spaces)
      assert.ok(apiUpdate.content.includes('- [Endpoints]'), 'h2 should not be indented');
      assert.ok(apiUpdate.content.includes('  - [GET /users]'), 'h3 should be indented');
      assert.ok(apiUpdate.content.includes('    - [Request Body]'), 'h4 should be double indented');
    });

    it('limits updates per run', async () => {
      const repoId = 'toc-limit-updates';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create many pages that need TOC
      const contentTemplate = `# Page {n}

## Section A

Content A.

## Section B

Content B.

## Section C

Content C.`;

      for (let i = 0; i < 10; i++) {
        await createPage(
          wiki.id,
          `multi-${i}`,
          `docs/page-${i}`,
          `Page ${i}`,
          contentTemplate.replace('{n}', String(i))
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should limit updates to 5 per run
      assert.ok(result.updates.length <= 5, `Should limit to 5 updates per run, got ${result.updates.length}`);
      assert.ok(result.updates.length > 0, 'Should update at least one page');
    });

    it('skips when wiki has less than 5 pages', async () => {
      const repoId = 'toc-few-pages';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create only 3 pages
      const content = `# Page

## A

Content.

## B

More.

## C

Even more.`;

      for (let i = 0; i < 3; i++) {
        await createPage(wiki.id, `few-${i}`, `docs/page-${i}`, `Page ${i}`, content);
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      // Should not process when wiki is too small
      assert.strictEqual(result.updates.length, 0, 'Should not process small wikis');
      assert.ok(result.result.summary.includes('need'), 'Summary should indicate more pages needed');
    });

    it('creates proper anchor links', async () => {
      const repoId = 'toc-anchors';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create a page with headings that need anchor normalization
      const content = `# Guide

## Getting Started

Intro.

## Configuration Options

Settings.

## API Reference & Examples

Examples.`;

      await createPage(wiki.id, 'anchor-test', 'docs/guide', 'Guide', content);

      // Create additional pages to meet minimum
      for (let i = 0; i < 5; i++) {
        await createPage(
          wiki.id,
          `filler-${i}`,
          `other/page-${i}`,
          `Page ${i}`,
          `# Page ${i}\n\nSimple content.`
        );
      }

      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnWiki(agentCtx);

      const guideUpdate = result.updates.find(u => u.path === 'docs/guide');
      assert.ok(guideUpdate, 'Should update guide');

      // Check anchor formatting
      assert.ok(guideUpdate.content.includes('#getting-started'), 'Should create proper anchor for "Getting Started"');
      assert.ok(guideUpdate.content.includes('#configuration-options'), 'Should create proper anchor for "Configuration Options"');
      assert.ok(guideUpdate.content.includes('#api-reference-examples'), 'Should handle special characters in anchors');
    });
  });

  describe('runOnCommit', () => {
    it('throws error when called', async () => {
      const agent = new TableOfContentsAgent();
      const agentCtx = await ctx.agentContext('any-repo');

      await assert.rejects(
        async () => agent.runOnCommit('any-commit-id', agentCtx),
        /does not run on commits/,
        'Should throw error explaining agent does not run on commits'
      );
    });
  });
});
