/**
 * Real LLM tests for CategoryAgent.
 *
 * Tests that the CategoryAgent correctly:
 * - Identifies pages that are in the wrong category
 * - Suggests appropriate categories based on content
 * - Recognizes well-categorized pages (no false positives)
 * - Handles edge cases appropriately
 *
 * Run with: node --import tsx --test tests/llm/category-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import 'dotenv/config';

import { CategoryAgent } from '../../src/agents/meta/category-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
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

describe('CategoryAgent with Real LLM', { timeout: 180000 }, () => {
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

  describe('Category Detection', () => {
    it('identifies pages in the wrong category', async () => {
      const repoId = 'llm-category-mismatch-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Category Test Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages where some are clearly miscategorized
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'guides/sql-injection-prevention',
          title: 'SQL Injection Prevention',
          content: `# SQL Injection Prevention

## Overview

SQL injection is a critical security vulnerability where attackers can manipulate database queries.

## Prevention Techniques

1. **Parameterized Queries**: Always use prepared statements
2. **Input Validation**: Validate and sanitize all user input
3. **Least Privilege**: Database accounts should have minimal permissions
4. **WAF Rules**: Configure web application firewall rules

## Code Examples

\`\`\`typescript
// BAD - vulnerable to SQL injection
const query = \`SELECT * FROM users WHERE id = \${userId}\`;

// GOOD - parameterized query
const query = 'SELECT * FROM users WHERE id = ?';
db.execute(query, [userId]);
\`\`\`
`,
        },
        {
          path: 'security/authentication',
          title: 'Authentication System',
          content: `# Authentication System

## Overview

The authentication system handles user login, sessions, and access control.

## Components

- JWT token generation
- Session management
- Password hashing with bcrypt
- Multi-factor authentication support
`,
        },
        {
          path: 'api/users-endpoint',
          title: 'Users API Endpoint',
          content: `# Users API Endpoint

## GET /api/users

Returns a list of all users.

### Request
\`\`\`
GET /api/users
Authorization: Bearer <token>
\`\`\`

### Response
\`\`\`json
{
  "users": [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"}
  ]
}
\`\`\`
`,
        },
      ]);

      const agent = new CategoryAgent();
      const result = await agent.runOnWiki(agentCtx);

      // LLM-as-judge: Verify category mismatch detection
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should identify that "guides/sql-injection-prevention" is miscategorized. ' +
        'This page is about security (SQL injection prevention) but is placed in the "guides" category. ' +
        'It should be in the "security" category. The other pages (security/authentication and api/users-endpoint) ' +
        'are correctly categorized.',
        analysisText,
        6
      );

      logTestResult('Category mismatch detection', evalResult);
      console.log(formatEvaluationResult('Category mismatch detection', evalResult));
    });

    it('recognizes well-categorized pages without false positives', async () => {
      const repoId = 'llm-category-correct-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Well Organized Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages that are all correctly categorized
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'architecture/event-sourcing',
          title: 'Event Sourcing Pattern',
          content: `# Event Sourcing Pattern

## Overview

Event sourcing is an architectural pattern where state changes are stored as a sequence of events.

## Benefits

- Complete audit trail
- Temporal queries
- Event replay for debugging
`,
        },
        {
          path: 'architecture/cqrs',
          title: 'CQRS Pattern',
          content: `# CQRS Pattern

## Overview

Command Query Responsibility Segregation separates read and write models.

## Architecture

- Command handlers for writes
- Query handlers for reads
- Separate data stores possible
`,
        },
        {
          path: 'guides/getting-started',
          title: 'Getting Started Guide',
          content: `# Getting Started

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

\`\`\`bash
npm install
npm run dev
\`\`\`

## Next Steps

1. Read the architecture docs
2. Try the tutorials
`,
        },
      ]);

      const agent = new CategoryAgent();
      const result = await agent.runOnWiki(agentCtx);

      // LLM-as-judge: Verify no false positives
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        mismatchCount: result.result.findings.length,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should find that all pages are correctly categorized. ' +
        'Event sourcing and CQRS are architectural patterns (correctly in "architecture"). ' +
        'Getting started is a how-to guide (correctly in "guides"). ' +
        'There should be zero or minimal findings for category mismatches.',
        analysisText,
        6
      );

      logTestResult('No false positives for correct categories', evalResult);
      console.log(formatEvaluationResult('No false positives for correct categories', evalResult));
    });

    it('suggests appropriate categories based on content', async () => {
      const repoId = 'llm-category-suggestion-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Category Suggestion Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with content that clearly belongs elsewhere
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'misc/rate-limiting',
          title: 'Rate Limiting Implementation',
          content: `# Rate Limiting Implementation

## Overview

Rate limiting protects the API from abuse and ensures fair resource usage.

## Algorithm

We use a token bucket algorithm:
- Each user gets 100 tokens per minute
- Each request consumes 1 token
- Tokens regenerate at a fixed rate

## Configuration

\`\`\`typescript
const rateLimiter = new RateLimiter({
  windowMs: 60000,
  max: 100,
});
\`\`\`
`,
        },
        {
          path: 'misc/jwt-validation',
          title: 'JWT Token Validation',
          content: `# JWT Token Validation

## Security Considerations

- Always verify the signature
- Check token expiration
- Validate the issuer claim
- Use secure key storage

## Implementation

\`\`\`typescript
function validateToken(token: string): boolean {
  const decoded = jwt.verify(token, SECRET_KEY);
  return decoded.exp > Date.now();
}
\`\`\`
`,
        },
      ]);

      const agent = new CategoryAgent();
      const result = await agent.runOnWiki(agentCtx);

      // LLM-as-judge: Verify category suggestions
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should suggest better categories for these pages. ' +
        '"misc/rate-limiting" would fit better in "api" or "architecture" (it\'s about API protection). ' +
        '"misc/jwt-validation" would fit better in "security" (it\'s about token security). ' +
        'The agent should identify that "misc" is not an appropriate category for these topics.',
        analysisText,
        6
      );

      logTestResult('Category suggestions', evalResult);
      console.log(formatEvaluationResult('Category suggestions', evalResult));
    });

    it('handles edge case with single-page categories', async () => {
      const repoId = 'llm-category-single-page-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Single Page Category Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create a variety of pages including lonely categories
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'security/overview',
          title: 'Security Overview',
          content: '# Security Overview\n\nMain security documentation.',
        },
        {
          path: 'security/auth',
          title: 'Authentication',
          content: '# Authentication\n\nUser authentication system.',
        },
        {
          path: 'lonely/single-page',
          title: 'Lonely Page',
          content: '# Lonely Page\n\nThis page is alone in its category. It discusses testing strategies.',
        },
      ]);

      const agent = new CategoryAgent();
      const result = await agent.runOnWiki(agentCtx);

      // LLM-as-judge: Verify handling of single-page categories
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should handle single-page categories appropriately. ' +
        'The "lonely/single-page" page might be better placed in an existing category ' +
        'if its content fits (e.g., if it\'s about testing, it could go in a testing category). ' +
        'The agent should analyze based on content, not just category size.',
        analysisText,
        5
      );

      logTestResult('Single-page category handling', evalResult);
      console.log(formatEvaluationResult('Single-page category handling', evalResult));
    });
  });

  describe('Confidence Scoring', () => {
    it('assigns appropriate confidence levels', async () => {
      const repoId = 'llm-category-confidence-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Confidence Test Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages with varying clarity of categorization
      await createWikiPages(agentCtx.wikiId, [
        {
          // Clearly security content in guides - should have high confidence mismatch
          path: 'guides/xss-prevention',
          title: 'XSS Prevention',
          content: `# XSS Prevention

## Cross-Site Scripting Attacks

XSS attacks inject malicious scripts into web pages. Prevention requires:
- Input sanitization
- Output encoding
- Content Security Policy headers
`,
        },
        {
          // Ambiguous - could be architecture or patterns
          path: 'patterns/dependency-injection',
          title: 'Dependency Injection',
          content: `# Dependency Injection

## Overview

A design pattern for achieving loose coupling between classes.
Also an architectural concern for large applications.
`,
        },
      ]);

      const agent = new CategoryAgent();
      const result = await agent.runOnWiki(agentCtx);

      // LLM-as-judge: Verify confidence appropriateness
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        overallConfidence: result.result.confidence,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should assign appropriate confidence levels. ' +
        'The XSS prevention page is clearly security content (high confidence mismatch). ' +
        'The dependency injection page is ambiguous between patterns/architecture (should have ' +
        'lower confidence or be marked as correctly categorized since "patterns" is reasonable).',
        analysisText,
        5
      );

      logTestResult('Confidence scoring', evalResult);
      console.log(formatEvaluationResult('Confidence scoring', evalResult));
    });
  });
});
