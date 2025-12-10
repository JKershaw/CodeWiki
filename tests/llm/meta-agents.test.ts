/**
 * Real LLM tests for Meta Agents.
 *
 * Tests for agents that analyze and maintain wiki quality:
 * - ConsistencyAgent
 * - QualityAgent
 * - LinkAgent
 *
 * Run with: node --import tsx --test tests/llm/meta-agents.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { ConsistencyAgent } from '../../src/agents/meta/consistency-agent.js';
import { QualityAgent } from '../../src/agents/meta/quality-agent.js';
import { LinkAgent } from '../../src/agents/meta/link-agent.js';
import { StructureAgent } from '../../src/agents/meta/structure-agent.js';
import { SourceVerificationAgent } from '../../src/agents/meta/source-verification-agent.js';
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
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('Meta Agents with Real LLM', { timeout: 180000 }, () => {
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

  /**
   * Helper to create wiki pages directly.
   */
  async function createWikiPages(wikiId: string, pages: Array<{path: string, title: string, content: string}>): Promise<void> {
    for (const page of pages) {
      const wikiPage: WikiPage = {
        id: `page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        wikiId,
        path: page.path,
        title: page.title,
        content: page.content,
        confidence: 0.7,
        sourceCommits: ['abc123'],
        sourceAgentRunIds: [],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(wikiPage);
    }
  }

  describe('ConsistencyAgent', () => {
    it('detects terminology inconsistencies', async () => {
      const repoId = 'llm-consistency-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with inconsistent terminology
      await createWikiPages(agentCtx.wikiId, [
        { path: 'overview', title: 'Overview', content: '# Overview\n\nThe system uses a User entity for authentication.' },
        { path: 'auth/login', title: 'Login', content: '# Login\n\nThe Account object stores credentials.' },
        { path: 'auth/session', title: 'Sessions', content: '# Sessions\n\nSessions are linked to Member profiles.' },
        { path: 'api/users', title: 'User API', content: '# User API\n\nManage Customer records via REST.' },
        { path: 'database/schema', title: 'Schema', content: '# Schema\n\nThe Person table stores identity data.' },
      ]);

      const agent = new ConsistencyAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // LLM-as-judge: Verify inconsistency detection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis identifies terminology inconsistencies. ' +
        'It should note that User, Account, Member, Customer, and Person ' +
        'might refer to the same concept with different names.',
        analysisText,
        6
      );

      logTestResult('Terminology inconsistency detection', evalResult);
      console.log(formatEvaluationResult('Terminology inconsistency detection', evalResult));
    });
  });

  describe('QualityAgent', () => {
    it('identifies low quality pages', async () => {
      const repoId = 'llm-quality-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Documentation Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with varying quality
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'high-quality',
          title: 'Well Written Page',
          content: `# Well Written Page

## Overview

This page demonstrates comprehensive documentation with clear sections,
proper formatting, and detailed explanations.

## Details

The implementation follows best practices for:
- Clear structure
- Proper headings
- Explanatory content

## Examples

Here's how to use this feature:
\`\`\`typescript
const example = new Example();
example.run();
\`\`\`
`,
        },
        {
          path: 'low-quality-1',
          title: 'Stub',
          content: '# Stub\n\nTODO',
        },
        {
          path: 'low-quality-2',
          title: 'Empty',
          content: '# Empty\n\n...',
        },
        {
          path: 'low-quality-3',
          title: 'Notes',
          content: '# Notes\n\nsome notes here idk',
        },
        {
          path: 'medium-quality',
          title: 'Partial',
          content: '# Partial\n\nThis page has some content but needs more detail.',
        },
      ]);

      const agent = new QualityAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // LLM-as-judge: Verify quality assessment
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis identifies pages that need improvement. ' +
        'It should flag stub pages, empty content, or pages marked with TODO.',
        analysisText,
        6
      );

      logTestResult('Quality assessment', evalResult);
      console.log(formatEvaluationResult('Quality assessment', evalResult));
    });
  });

  describe('LinkAgent', () => {
    it('suggests relevant cross-references', async () => {
      const repoId = 'llm-link-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Linked Documentation',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create related pages that should be linked
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'auth/overview',
          title: 'Authentication Overview',
          content: '# Authentication\n\nThe authentication system handles user login and sessions.',
        },
        {
          path: 'auth/jwt',
          title: 'JWT Tokens',
          content: '# JWT Tokens\n\nJSON Web Tokens are used for session management.',
        },
        {
          path: 'api/users',
          title: 'Users API',
          content: '# Users API\n\nThe users endpoint requires authentication headers.',
        },
        {
          path: 'security/best-practices',
          title: 'Security Best Practices',
          content: '# Security\n\nAlways validate tokens and use HTTPS for authentication.',
        },
        {
          path: 'guides/login-flow',
          title: 'Login Flow',
          content: '# Login Flow\n\nUsers authenticate via the login endpoint to receive tokens.',
        },
      ]);

      const agent = new LinkAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // LLM-as-judge: Verify link suggestions
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        suggestedLinks: result.updates.length,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis identifies pages that should be linked together. ' +
        'It should suggest connecting authentication-related pages ' +
        '(auth, jwt, security, login) to each other.',
        analysisText,
        6
      );

      logTestResult('Link suggestions', evalResult);
      console.log(formatEvaluationResult('Link suggestions', evalResult));
    });

    it('populates links array in WikiPageUpdate (fix verification)', async () => {
      const repoId = 'llm-link-array-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Links Array Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages that should be linked
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'database/overview',
          title: 'Database Overview',
          content: '# Database\n\nThe database layer handles data persistence using PostgreSQL.',
        },
        {
          path: 'database/migrations',
          title: 'Database Migrations',
          content: '# Migrations\n\nDatabase migrations manage schema changes over time.',
        },
        {
          path: 'database/models',
          title: 'Data Models',
          content: '# Models\n\nData models define the structure of database tables.',
        },
        {
          path: 'api/crud',
          title: 'CRUD Operations',
          content: '# CRUD\n\nCreate, Read, Update, Delete operations interact with the database.',
        },
      ]);

      const agent = new LinkAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Structural assertion: updates should have links array populated
      assert.ok(result.updates.length > 0, 'Should generate link updates');

      // Verify each update has a populated links array
      let updatesWithLinks = 0;
      for (const update of result.updates) {
        if (update.links && update.links.length > 0) {
          updatesWithLinks++;
          // Verify links are valid page paths (not empty strings)
          for (const link of update.links) {
            assert.ok(link.length > 0, 'Link path should not be empty');
            assert.ok(!link.includes('['), 'Link should be a path, not markdown');
          }
        }
      }

      assert.ok(
        updatesWithLinks > 0,
        `Expected at least one update with links array populated, got ${updatesWithLinks} of ${result.updates.length}`
      );

      // Log for visibility
      console.log(`\n✓ LinkAgent populated links array in ${updatesWithLinks}/${result.updates.length} updates`);
      for (const update of result.updates) {
        if (update.links && update.links.length > 0) {
          console.log(`  - ${update.path}: links to [${update.links.join(', ')}]`);
        }
      }

      logTestResult('Links array population', {
        score: updatesWithLinks > 0 ? 10 : 0,
        reasoning: `${updatesWithLinks} updates have links array populated`,
        passed: updatesWithLinks > 0,
      });
    });

    it('produces links for obviously-related same-category pages (regression test)', async () => {
      // This test catches the "zero links" issue where the link agent runs
      // but produces no links due to LLM output parsing failures.
      const repoId = 'llm-link-obvious-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Obvious Links Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with OBVIOUS relationships that any LLM should connect
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'auth/login',
          title: 'Login System',
          content: '# Login System\n\nHandles user authentication. Users enter credentials and receive a JWT token for session management.',
        },
        {
          path: 'auth/logout',
          title: 'Logout System',
          content: '# Logout System\n\nHandles user logout. Invalidates the JWT token and clears the session.',
        },
        {
          path: 'auth/jwt',
          title: 'JWT Token Management',
          content: '# JWT Token Management\n\nManages JSON Web Tokens for authentication. Creates, validates, and refreshes tokens used by login and logout.',
        },
        {
          path: 'auth/session',
          title: 'Session Management',
          content: '# Session Management\n\nTracks user sessions. Sessions are created on login and destroyed on logout.',
        },
        {
          path: 'auth/password',
          title: 'Password Handling',
          content: '# Password Handling\n\nSecure password hashing and validation. Used by the login system to verify credentials.',
        },
      ]);

      const agent = new LinkAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Count total links across all updates
      let totalLinks = 0;
      for (const update of result.updates) {
        if (update.links) {
          totalLinks += update.links.length;
        }
      }

      // With 5 auth-related pages, we should get AT LEAST 3 links
      // (being conservative - some LLMs may not link every page)
      const minimumExpectedLinks = 3;

      // If we got zero links, log diagnostic information
      if (totalLinks === 0) {
        console.error('\n❌ ZERO LINKS PRODUCED - Diagnostic Information:');
        console.error('   Summary:', result.result.summary);
        console.error('   Updates count:', result.updates.length);
        console.error('   Findings count:', result.result.findings.length);
        console.error('   Confidence:', result.result.confidence);

        // Check if it's a parse failure (no updates but agent ran)
        if (result.updates.length === 0 && result.costUsd > 0) {
          console.error('   ⚠️  LLM was called but no updates generated - likely OUTPUT PARSING FAILURE');
          console.error('   The LLM response did not match expected format: - source -> target | strength | reason');
        }
      }

      assert.ok(
        totalLinks >= minimumExpectedLinks,
        `Expected at least ${minimumExpectedLinks} links for 5 obviously-related auth pages, got ${totalLinks}. ` +
        `This may indicate the LLM output is not being parsed correctly. ` +
        `Summary: "${result.result.summary}"`
      );

      // Log success details
      console.log(`\n✓ LinkAgent produced ${totalLinks} links for 5 auth pages`);
      for (const update of result.updates) {
        if (update.links && update.links.length > 0) {
          console.log(`  - ${update.path}: ${update.links.length} links -> [${update.links.join(', ')}]`);
        }
      }

      logTestResult('Obvious same-category links', {
        score: totalLinks >= minimumExpectedLinks ? 10 : Math.floor((totalLinks / minimumExpectedLinks) * 10),
        reasoning: `Produced ${totalLinks} links (minimum expected: ${minimumExpectedLinks})`,
        passed: totalLinks >= minimumExpectedLinks,
      });
    });

    it('detects and reports when LLM output format is not parseable', async () => {
      // This test verifies we can detect parse failures vs genuine "no links needed"
      const repoId = 'llm-link-parse-detection-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Parse Detection Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages that DEFINITELY need linking
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'api/users',
          title: 'Users API',
          content: '# Users API\n\nREST endpoints for user management. GET /users, POST /users, etc.',
        },
        {
          path: 'api/posts',
          title: 'Posts API',
          content: '# Posts API\n\nREST endpoints for blog posts. Users create posts via this API.',
        },
        {
          path: 'api/comments',
          title: 'Comments API',
          content: '# Comments API\n\nREST endpoints for comments on posts. Users can comment on any post.',
        },
      ]);

      const agent = new LinkAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // The result summary should NOT indicate "not enough pages" (we have 3)
      assert.ok(
        !result.result.summary.toLowerCase().includes('not enough'),
        `With 3 pages, should not say "not enough pages": "${result.result.summary}"`
      );

      // The result should show some activity (findings or updates)
      const hasActivity = result.updates.length > 0 || result.result.findings.length > 0;

      // If there's cost but no activity, that indicates a parse failure
      if (result.costUsd > 0 && !hasActivity) {
        console.warn('\n⚠️  LLM was called but produced no updates or findings');
        console.warn('   This strongly suggests the LLM output format was not parseable');
        console.warn('   Summary:', result.result.summary);
      }

      // With 3 related API pages, we should get at least some links
      let totalLinks = 0;
      for (const update of result.updates) {
        if (update.links) {
          totalLinks += update.links.length;
        }
      }

      assert.ok(
        totalLinks >= 2,
        `Expected at least 2 links for 3 related API pages, got ${totalLinks}. ` +
        `Cost: $${result.costUsd.toFixed(4)}, Updates: ${result.updates.length}, Findings: ${result.result.findings.length}`
      );

      logTestResult('Parse detection', {
        score: totalLinks >= 2 ? 10 : 0,
        reasoning: `Produced ${totalLinks} links with proper parsing`,
        passed: totalLinks >= 2,
      });
    });

    it('achieves minimum link efficiency ratio (regression for zero-link at scale)', async () => {
      // This test catches the production issue where 55 pages had 0 links.
      // At scale, the link agent was producing zero links even though it "ran successfully".
      // We test with more pages to simulate scale effects.
      const repoId = 'llm-link-efficiency-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Link Efficiency Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create 10 pages across different categories - simulating a more realistic wiki
      await createWikiPages(agentCtx.wikiId, [
        { path: 'api/users', title: 'Users API', content: '# Users API\n\nREST endpoints for user CRUD operations.' },
        { path: 'api/auth', title: 'Auth API', content: '# Auth API\n\nAuthentication endpoints. Login returns JWT token.' },
        { path: 'api/posts', title: 'Posts API', content: '# Posts API\n\nBlog post endpoints. Users create posts.' },
        { path: 'models/user', title: 'User Model', content: '# User Model\n\nUser entity with email, password hash, name.' },
        { path: 'models/post', title: 'Post Model', content: '# Post Model\n\nBlog post with title, content, author (User).' },
        { path: 'services/auth', title: 'Auth Service', content: '# Auth Service\n\nHandles JWT creation, validation, password hashing.' },
        { path: 'services/email', title: 'Email Service', content: '# Email Service\n\nSends emails to users for notifications.' },
        { path: 'guides/setup', title: 'Setup Guide', content: '# Setup Guide\n\nHow to set up the development environment.' },
        { path: 'guides/testing', title: 'Testing Guide', content: '# Testing Guide\n\nHow to run tests and write new ones.' },
        { path: 'architecture/overview', title: 'Architecture Overview', content: '# Architecture\n\nSystem uses layered architecture: API -> Services -> Models.' },
      ]);

      const agent = new LinkAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Count metrics
      const totalPages = 10;
      let totalLinks = 0;
      let pagesWithLinks = 0;

      for (const update of result.updates) {
        if (update.links && update.links.length > 0) {
          totalLinks += update.links.length;
          pagesWithLinks++;
        }
      }

      // Calculate efficiency metrics
      const linksPerPage = totalLinks / totalPages;
      const linkCoverage = pagesWithLinks / totalPages;

      console.log(`\nLink Efficiency Metrics (${totalPages} pages):`);
      console.log(`  Total links: ${totalLinks}`);
      console.log(`  Pages with links: ${pagesWithLinks}/${totalPages} (${(linkCoverage * 100).toFixed(1)}%)`);
      console.log(`  Links per page: ${linksPerPage.toFixed(2)}`);
      console.log(`  Summary: ${result.result.summary}`);

      // Production issue: 0 links for 55 pages = 0% efficiency
      // Healthy wiki: At least 50% of pages should have links
      // And at least 0.5 links per page on average
      const minLinkCoverage = 0.3;  // At least 30% of pages should get links
      const minLinksPerPage = 0.3;  // At least 0.3 links per page average

      if (linkCoverage < minLinkCoverage) {
        console.error(`\n❌ LOW LINK COVERAGE: Only ${(linkCoverage * 100).toFixed(1)}% of pages have links`);
        console.error(`   This is the issue seen in production where 55 pages had 0 links`);
      }

      if (linksPerPage < minLinksPerPage) {
        console.error(`\n❌ LOW LINK DENSITY: Only ${linksPerPage.toFixed(2)} links per page`);
        console.error(`   Expected at least ${minLinksPerPage} links per page for a connected wiki`);
      }

      // Parse the summary to check for detected relationships
      const summaryMatch = result.result.summary.match(/Found (\d+) link relationships/);
      const detectedRelationships = summaryMatch ? parseInt(summaryMatch[1]!, 10) : 0;

      console.log(`  Detected relationships: ${detectedRelationships}`);

      // If LLM detected relationships but few links created, it's a parse issue
      if (detectedRelationships > 0 && totalLinks === 0) {
        console.error(`\n❌ PARSE FAILURE: LLM detected ${detectedRelationships} relationships but 0 links created`);
      }

      assert.ok(
        linkCoverage >= minLinkCoverage,
        `Link coverage too low: ${(linkCoverage * 100).toFixed(1)}% (expected >= ${minLinkCoverage * 100}%). ` +
        `This indicates the link agent is not connecting pages effectively.`
      );

      assert.ok(
        linksPerPage >= minLinksPerPage,
        `Link density too low: ${linksPerPage.toFixed(2)} links/page (expected >= ${minLinksPerPage}). ` +
        `Wiki will feel disconnected.`
      );

      logTestResult('Link efficiency at scale', {
        score: (linkCoverage >= minLinkCoverage && linksPerPage >= minLinksPerPage) ? 10 :
               (linkCoverage >= minLinkCoverage * 0.5) ? 5 : 0,
        reasoning: `Coverage: ${(linkCoverage * 100).toFixed(1)}%, Density: ${linksPerPage.toFixed(2)} links/page`,
        passed: linkCoverage >= minLinkCoverage && linksPerPage >= minLinksPerPage,
      });
    });
  });

  describe('StructureAgent', () => {
    it('analyzes wiki structure and identifies issues', async () => {
      const repoId = 'llm-structure-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Structure Test Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with structural issues
      await createWikiPages(agentCtx.wikiId, [
        // Very long page (over 5000 chars)
        { path: 'docs/very-long-page', title: 'Long', content: '# Long Page\n\n' + 'This is a very long page with lots of content. '.repeat(200) },
        // Single-page category
        { path: 'lonely/only-page', title: 'Only Page', content: '# Only\n\nLonely page in its own category.' },
        // Short title
        { path: 'api/x', title: 'X', content: '# X\n\nPage with very short title.' },
        // Normal pages for a category without overview
        { path: 'services/auth', title: 'Auth Service', content: '# Auth\n\nAuthentication service.' },
        { path: 'services/email', title: 'Email Service', content: '# Email\n\nEmail service.' },
        { path: 'services/cache', title: 'Cache Service', content: '# Cache\n\nCache service.' },
        { path: 'services/queue', title: 'Queue Service', content: '# Queue\n\nQueue service.' },
        { path: 'services/logger', title: 'Logger Service', content: '# Logger\n\nLogger service.' },
      ]);

      const agent = new StructureAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // LLM-as-judge: Verify structure analysis
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis identifies structural issues in the wiki. ' +
        'It should detect problems like: overly long pages, single-page categories, ' +
        'pages with short titles, or categories missing overview pages.',
        analysisText,
        6
      );

      logTestResult('Structure analysis', evalResult);
      console.log(formatEvaluationResult('Structure analysis', evalResult));
    });
  });

  describe('SourceVerificationAgent', () => {
    it('verifies wiki claims against source code', async () => {
      const repoId = 'llm-source-verification-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Source Verification Test',
        'src/config.ts': `
export const CONFIG = {
  maxRetries: 3,
  timeout: 5000,
  apiUrl: 'https://api.example.com',
};
`,
        'src/auth.ts': `
export function authenticate(token: string): boolean {
  return token.startsWith('Bearer ');
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki pages with verifiable claims (some accurate, some not)
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'config/settings',
          title: 'Configuration',
          content: `# Configuration

The configuration is stored in \`src/config.ts\`.

## Settings
- maxRetries: 3 (maximum retry attempts)
- timeout: 5000ms (request timeout)
- apiUrl: The API endpoint URL
`,
        },
        {
          path: 'auth/overview',
          title: 'Authentication',
          content: `# Authentication

The authentication system is implemented in \`src/auth.ts\`.

The \`authenticate\` function validates tokens by checking if they start with "Bearer ".
`,
        },
      ]);

      const agent = new SourceVerificationAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // LLM-as-judge: Verify the verification process
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis attempts to verify wiki claims against source code. ' +
        'It should mention verifying pages, extracting claims, ' +
        'and comparing them to actual source files.',
        analysisText,
        6
      );

      logTestResult('Source verification', evalResult);
      console.log(formatEvaluationResult('Source verification', evalResult));
    });
  });
});
