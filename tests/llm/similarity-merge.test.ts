/**
 * LLM integration tests for similarity-triggered merge behavior.
 *
 * When a page creation is attempted and similarity is detected with an existing page,
 * the system should merge the content instead of rejecting. This test verifies:
 * 1. Content is actually merged (not lost)
 * 2. Merged content is coherent (LLM-as-judge)
 * 3. Metadata (filesAccessed, targetPaths) is accumulated
 *
 * Run with: node --import tsx --test tests/llm/similarity-merge.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import 'dotenv/config';

import { createLLMTestContext, createTestRepo, type LLMTestContext } from './helpers/test-context.js';
import { assertLLM, formatEvaluationResult, getLLMService } from './helpers/llm-assert.js';
import { handleUpdateWikiPage, createUpdateWikiPageCommand } from '../../src/commands/update-wiki-page.js';
import { createWikiPage } from '../../src/domain/wiki-page.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';

describe('Similarity-triggered Merge', { timeout: 120000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    // Verify API key is configured
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    console.log(`Using model: ${getLLMService().getModel()}`);

    ctx = await createLLMTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('content merging', () => {
    it('merges content when creating page with similar title', async () => {
      const repoId = 'similarity-merge-test-1';
      await createTestRepo(ctx, repoId, {
        'src/auth/login.ts': 'export function login() { /* auth logic */ }',
        'src/auth/logout.ts': 'export function logout() { /* logout logic */ }',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create existing page about authentication
      const existingPage = createWikiPage({
        id: uuid(),
        wikiId: wiki.id,
        path: 'services/auth',
        title: 'Auth Service',
        content: `# Auth Service

This document describes the auth service for the application.

## Overview

The auth service handles user login and session management.
It uses JWT tokens for secure authentication.

## Key Components

- Login handler
- Session manager
- Token validation`,
        filesAccessed: ['src/auth/login.ts'],
        targetPaths: ['src/auth/'],
      });
      await ctx.repos.wikiPages.save(existingPage);

      // Try to create a similar page (similar title shares 2 of 3 words)
      const newContent = `# Auth Service Handler

Documentation for the authentication module.

## Logout Functionality

The logout function handles:
- Session termination
- Token invalidation
- Cleanup of user state

## Security Considerations

- Tokens expire after 24 hours
- Refresh tokens are rotated on use`;

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'components/auth-handler',
        title: 'Auth Service Handler',  // Similar to "Auth Service" (2/3 words match = 0.67)
        content: newContent,
        agentRunId: 'test-agent-run',
        confidenceDelta: 0.3,
        filesAccessed: ['src/auth/logout.ts'],
        targetPaths: ['src/handlers/'],
      });

      const result = await handleUpdateWikiPage(command, ctx.repos, wiki.id);

      // Should succeed (merged into similar page)
      assert.strictEqual(result.success, true, `Expected success but got error: ${result.error}`);

      // Should return the original page path
      assert.strictEqual(result.data?.path, 'services/auth');

      // Content should be merged
      const mergedContent = result.data?.content ?? '';

      // Verify both original and new content are present
      assert.ok(
        mergedContent.includes('JWT tokens') || mergedContent.includes('Token validation'),
        'Original content about tokens should be preserved'
      );
      assert.ok(
        mergedContent.includes('Logout Functionality') || mergedContent.includes('Session termination'),
        'New content about logout should be merged'
      );

      // Metadata should be accumulated
      assert.ok(
        result.data?.filesAccessed?.includes('src/auth/login.ts'),
        'Original filesAccessed should be preserved'
      );
      assert.ok(
        result.data?.filesAccessed?.includes('src/auth/logout.ts'),
        'New filesAccessed should be added'
      );
      assert.ok(
        result.data?.targetPaths?.includes('src/auth/'),
        'Original targetPaths should be preserved'
      );
      assert.ok(
        result.data?.targetPaths?.includes('src/handlers/'),
        'New targetPaths should be added'
      );

      // Verify no duplicate page was created
      const allPages = await ctx.repos.wikiPages.findByWiki(wiki.id);
      assert.strictEqual(allPages.length, 1, 'Should have only one page (merged)');
    });

    it('produces coherent merged content (LLM-as-judge)', async () => {
      const repoId = 'similarity-merge-test-2';
      await createTestRepo(ctx, repoId, {
        'src/api/endpoints.ts': 'export const endpoints = { /* API routes */ }',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create existing page
      const existingPage = createWikiPage({
        id: uuid(),
        wikiId: wiki.id,
        path: 'api/overview',
        title: 'API Overview',
        content: `# API Overview

## REST Endpoints

The API provides the following REST endpoints:

- GET /users - List all users
- POST /users - Create a new user
- GET /users/:id - Get user by ID

## Authentication

All endpoints require a valid API key.`,
      });
      await ctx.repos.wikiPages.save(existingPage);

      // Try to create similar page with additional information (2/3 words match: "api" and "overview")
      const newContent = `# API Overview Guide

## Error Handling

The API returns standard HTTP status codes:

- 200: Success
- 400: Bad request
- 401: Unauthorized
- 404: Not found
- 500: Server error

## Rate Limiting

API calls are limited to 100 requests per minute.`;

      const command = createUpdateWikiPageCommand({
        type: 'create',
        path: 'docs/api-reference',
        title: 'API Overview Guide',  // Similar to "API Overview" (2/3 words match)
        content: newContent,
        agentRunId: 'test-agent-run',
        confidenceDelta: 0.3,
      });

      const result = await handleUpdateWikiPage(command, ctx.repos, wiki.id);

      assert.strictEqual(result.success, true);

      // Use LLM-as-judge to verify the merged content is coherent
      const mergedContent = result.data?.content ?? '';

      const llmResult = await assertLLM(
        `The documentation covers API-related topics including REST endpoints,
        authentication, error handling, and rate limiting. The content is present
        and reasonably organized, even if merged from multiple sources.`,
        mergedContent
      );

      console.log(formatEvaluationResult('Merged content coherence', llmResult));
    });
  });

  describe('no duplicate pages', () => {
    it('consolidates similar pages instead of creating duplicates', async () => {
      const repoId = 'similarity-merge-test-3';
      await createTestRepo(ctx, repoId, {
        'src/utils/helpers.ts': 'export function helper() {}',
      });
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);

      // Create existing page
      const existingPage = createWikiPage({
        id: uuid(),
        wikiId: wiki.id,
        path: 'utilities/overview',
        title: 'Utility Functions',
        content: `# Utility Functions

Common utility functions used throughout the codebase.

## String Helpers

- capitalize(str) - Capitalizes first letter
- truncate(str, len) - Truncates to length`,
      });
      await ctx.repos.wikiPages.save(existingPage);

      // Try to create three similar pages in sequence
      // Each title shares 2 words with "Utility Functions" giving 2/3 = 0.67 similarity (above 0.5 threshold)
      const similarPages = [
        { title: 'Utility Functions Overview', content: '# Utility Functions Overview\n\n## Array Helpers\n\n- flatten(arr)' },
        { title: 'Utility Functions Guide', content: '# Utility Functions Guide\n\n## Date Helpers\n\n- formatDate(d)' },
        { title: 'Utility Functions Reference', content: '# Utility Functions Reference\n\n## Number Helpers\n\n- round(n)' },
      ];

      for (const page of similarPages) {
        const command = createUpdateWikiPageCommand({
          type: 'create',
          path: `docs/${page.title.toLowerCase().replace(/\s+/g, '-')}`,
          title: page.title,
          content: page.content,
          agentRunId: 'test-agent-run',
          confidenceDelta: 0.2,
          skipValidation: true,  // Skip content length validation for test
        });

        const result = await handleUpdateWikiPage(command, ctx.repos, wiki.id);
        assert.strictEqual(result.success, true, `Failed to process ${page.title}`);
      }

      // Should still have only one page (all merged)
      const allPages = await ctx.repos.wikiPages.findByWiki(wiki.id);
      assert.strictEqual(allPages.length, 1, 'Should have only one consolidated page');

      // The consolidated page should contain content from all attempts
      const consolidatedContent = allPages[0]?.content ?? '';
      assert.ok(consolidatedContent.includes('String Helpers'), 'Original content');
      assert.ok(consolidatedContent.includes('Array Helpers'), 'First merge');
      assert.ok(consolidatedContent.includes('Date Helpers'), 'Second merge');
      assert.ok(consolidatedContent.includes('Number Helpers'), 'Third merge');
    });
  });
});
