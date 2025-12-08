/**
import { createPathTarget } from '../../src/domain/work-target.js';
 * Real LLM tests for Specialized Agents.
 *
 * Tests for agents with unique APIs:
 * - SpecAgent (generates coding specifications from wiki)
 * - ResearchAgent (answers questions using wiki)
 * - CodebaseExplorerAgent (documents undocumented code)
 *
 * Run with: node --import tsx --test tests/llm/specialized-agents.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { createSpecAgent } from '../../src/agents/spec/spec-agent.js';
import { createResearchAgent } from '../../src/agents/research/research-agent.js';
import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import { createPathTarget } from '../../src/domain/work-target.js';
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

describe('Specialized Agents with Real LLM', { timeout: 180000 }, () => {
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
        confidence: 0.8,
        sourceCommits: ['abc123'],
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(wikiPage);
    }
  }

  describe('SpecAgent', () => {
    it('generates coding specification from wiki', async () => {
      const repoId = 'llm-spec-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# API Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki pages with architecture and pattern info
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'architecture/overview',
          title: 'Architecture Overview',
          content: `# Architecture

The project uses a layered architecture:
- Controllers handle HTTP requests
- Services contain business logic
- Repositories handle data access

All new endpoints should follow REST conventions.
`,
        },
        {
          path: 'patterns/repository',
          title: 'Repository Pattern',
          content: `# Repository Pattern

Each entity has a repository in \`src/repositories/\`.

Repositories implement:
- findById(id: string)
- findAll()
- save(entity)
- delete(id: string)
`,
        },
        {
          path: 'conventions/naming',
          title: 'Naming Conventions',
          content: `# Naming

- Files: kebab-case (user-repository.ts)
- Classes: PascalCase (UserRepository)
- Functions: camelCase (findById)
- Constants: SCREAMING_SNAKE_CASE
`,
        },
        {
          path: 'guides/testing',
          title: 'Testing Guide',
          content: `# Testing

Tests use Jest and live in \`tests/\` directory.

For repositories, create integration tests.
For services, create unit tests with mocks.
`,
        },
      ]);

      const specAgent = createSpecAgent(ctx.repos, getLLMService());
      // Use a task that matches keywords in the wiki content
      const result = await specAgent.generateSpec(
        agentCtx.wikiId,
        'Add a new repository for managing user data with standard CRUD operations'
      );

      // LLM-as-judge: Verify spec quality
      const specText = JSON.stringify({
        interpretation: result.interpretation,
        spec: result.spec,
        confidence: result.confidence,
        sourcesCount: result.sources.length,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The specification provides guidance for implementing a user repository. ' +
        'It should mention patterns (repository pattern, layered architecture), ' +
        'naming conventions (kebab-case, PascalCase), or testing approaches from the wiki.',
        specText,
        6
      );

      logTestResult('Spec generation quality', evalResult);
      console.log(formatEvaluationResult('Spec generation quality', evalResult));
    });

    it('handles wiki with no relevant content', async () => {
      const repoId = 'llm-spec-empty-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Empty Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      const specAgent = createSpecAgent(ctx.repos, getLLMService());
      const result = await specAgent.generateSpec(
        agentCtx.wikiId,
        'Add authentication with JWT'
      );

      // Should return low confidence with no sources
      assert.ok(result.confidence <= 0.1, `Expected low confidence, got ${result.confidence}`);
      assert.ok(result.sources.length === 0, 'Expected no sources');

      console.log('Empty wiki spec test passed');
    });
  });

  describe('ResearchAgent', () => {
    it('answers questions using wiki content', async () => {
      const repoId = 'llm-research-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Research Test Project',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create wiki pages with searchable content
      await createWikiPages(agentCtx.wikiId, [
        {
          path: 'auth/jwt',
          title: 'JWT Authentication',
          content: `# JWT Authentication

The API uses JWT tokens for authentication.

## Token Structure
- Access tokens expire after 15 minutes
- Refresh tokens expire after 7 days
- Tokens are signed using RS256

## Usage
Include the token in the Authorization header:
\`Authorization: Bearer <token>\`
`,
        },
        {
          path: 'auth/login',
          title: 'Login Flow',
          content: `# Login Flow

1. User sends credentials to POST /auth/login
2. Server validates credentials against database
3. If valid, server returns access token and refresh token
4. Client stores tokens securely

## Rate Limiting
Login is limited to 5 attempts per minute per IP.
`,
        },
        {
          path: 'api/endpoints',
          title: 'API Endpoints',
          content: `# API Endpoints

## Authentication
- POST /auth/login - Login with email/password
- POST /auth/refresh - Refresh access token
- POST /auth/logout - Invalidate tokens

## Users
- GET /users - List all users
- GET /users/:id - Get user by ID
`,
        },
      ]);

      const researchAgent = createResearchAgent(ctx.repos, getLLMService());
      const result = await researchAgent.query(
        agentCtx.wikiId,
        'How long do JWT tokens last before they expire?'
      );

      // LLM-as-judge: Verify answer quality
      const evalResult = await evaluateLLM(
        'The answer correctly states token expiration times. ' +
        'It should mention that access tokens expire after 15 minutes ' +
        'and/or refresh tokens expire after 7 days.',
        result.answer,
        6
      );

      logTestResult('Research question answering', evalResult);
      console.log(formatEvaluationResult('Research question answering', evalResult));
    });
  });

  describe('CodebaseExplorerAgent', () => {
    it('documents undocumented code directory', async () => {
      const repoId = 'llm-explorer-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Explorer Test Project',
        'src/services/index.ts': `
export * from './user-service.js';
export * from './email-service.js';
`,
        'src/services/user-service.ts': `
export interface User {
  id: string;
  email: string;
  name: string;
}

export class UserService {
  async findById(id: string): Promise<User | null> {
    // Implementation
    return null;
  }

  async create(data: Omit<User, 'id'>): Promise<User> {
    // Implementation
    return { id: '123', ...data };
  }
}
`,
        'src/services/email-service.ts': `
export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
}

export class EmailService {
  async send(options: EmailOptions): Promise<void> {
    console.log('Sending email to', options.to);
  }
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      const agent = new CodebaseExplorerAgent();
      const result = await agent.run(createPathTarget('src/services'), agentCtx);

      // LLM-as-judge: Verify exploration quality
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        wikiPagesCreated: result.updates.length,
        wikiPagePaths: result.updates.map(u => u.path),
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The exploration documents the services directory. ' +
        'It should describe UserService and EmailService, ' +
        'their interfaces, or the functionality they provide.',
        analysisText,
        6
      );

      logTestResult('Codebase exploration', evalResult);
      console.log(formatEvaluationResult('Codebase exploration', evalResult));
    });
  });
});
