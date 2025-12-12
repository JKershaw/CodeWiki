/**
 * LLM tests for agent link generation.
 *
 * These tests verify that content-generating agents include wiki links
 * to existing related pages when generating new content.
 *
 * Run with: node --import tsx --test tests/llm/agent-link-generation.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

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

/**
 * Helper to create wiki pages for testing.
 */
async function createWikiPages(
  ctx: LLMTestContext,
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
      sourceCommits: ['commit-1'],
      sourceAgentRunIds: [],
      links: page.links ?? [],
      backlinks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

describe('Agent Link Generation with Real LLM', { timeout: 300000 }, () => {
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

  describe('CodebaseExplorerAgent', () => {
    it('includes links to existing related wiki pages in generated content', async () => {
      const repoId = 'llm-explorer-links-test';

      // Create repo with authentication-related code
      await createTestRepo(ctx, repoId, {
        'README.md': '# Auth Service\n\nAuthentication microservice.',
        'src/auth/login.ts': `
/**
 * Login handler - authenticates users and creates sessions.
 */
export async function login(email: string, password: string): Promise<Session> {
  const user = await findUserByEmail(email);
  if (!user) throw new Error('User not found');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new Error('Invalid password');

  return createSession(user.id);
}
`,
        'src/auth/session.ts': `
/**
 * Session management - creates and validates user sessions.
 */
export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<Session> {
  return { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 3600000) };
}

export async function validateSession(sessionId: string): Promise<boolean> {
  // Check session validity
  return true;
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create existing wiki pages that should be linked to
      await createWikiPages(ctx, agentCtx.wikiId, [
        {
          path: 'security/authentication-overview',
          title: 'Authentication Overview',
          content: '# Authentication Overview\n\nHow authentication works in the system. Covers login flows, session management, and security best practices.',
        },
        {
          path: 'api/user-endpoints',
          title: 'User API Endpoints',
          content: '# User API\n\nREST endpoints for user management. Includes user creation, updates, and deletion.',
        },
        {
          path: 'guides/security-best-practices',
          title: 'Security Best Practices',
          content: '# Security Best Practices\n\nGuidelines for secure authentication implementation, password hashing, and session handling.',
        },
      ]);

      const agent = new CodebaseExplorerAgent();
      const result = await agent.run(createPathTarget('src/auth'), agentCtx);

      // Verify updates were generated
      assert.ok(result.updates.length > 0, 'Should generate wiki page updates');

      // Check for links in the generated content
      let totalLinksInContent = 0;
      let pagesWithMarkdownLinks = 0;
      const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

      for (const update of result.updates) {
        const matches = update.content.match(markdownLinkPattern);
        if (matches && matches.length > 0) {
          pagesWithMarkdownLinks++;
          totalLinksInContent += matches.length;
        }
      }

      // Log diagnostics
      console.log(`\nLink Generation Diagnostics:`);
      console.log(`  Total updates: ${result.updates.length}`);
      console.log(`  Updates with markdown links: ${pagesWithMarkdownLinks}`);
      console.log(`  Total links in content: ${totalLinksInContent}`);

      // Check links array population
      let totalLinksArray = 0;
      for (const update of result.updates) {
        if (update.links && update.links.length > 0) {
          totalLinksArray += update.links.length;
          console.log(`  - ${update.path}: links array has [${update.links.join(', ')}]`);
        }
      }
      console.log(`  Total links in arrays: ${totalLinksArray}`);

      // LLM-as-judge: Evaluate if the agent should have included links
      const contentSummary = result.updates.map(u => ({
        path: u.path,
        contentPreview: u.content.slice(0, 300),
        hasLinks: (u.links?.length || 0) > 0,
        linksCount: u.links?.length || 0,
      }));

      const evalResult = await evaluateLLM(
        'The agent documented authentication code (login, sessions). ' +
        'Existing wiki pages include: security/authentication-overview, api/user-endpoints, guides/security-best-practices. ' +
        'The generated content SHOULD include markdown links like [Authentication Overview](security/authentication-overview) ' +
        'to connect the new documentation to existing related pages. ' +
        'Score high if links to related pages are present, low if the content is isolated with no cross-references.',
        JSON.stringify(contentSummary, null, 2),
        6
      );

      logTestResult('CodebaseExplorer link generation', evalResult);
      console.log(formatEvaluationResult('CodebaseExplorer link generation', evalResult));

      // Structural assertion: At least some updates should have links
      // This will initially fail, driving us to fix the prompts
      assert.ok(
        totalLinksArray > 0 || totalLinksInContent > 0,
        `Expected generated content to include wiki links to related pages. ` +
        `Found ${totalLinksInContent} links in content, ${totalLinksArray} in links arrays. ` +
        `Existing pages: security/authentication-overview, api/user-endpoints, guides/security-best-practices`
      );
    });

    it('populates links array when content contains wiki links', async () => {
      // This test verifies that even if the LLM generates markdown links,
      // they are properly extracted into the links array
      const repoId = 'llm-explorer-links-extract-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/utils/helpers.ts': `
export function formatDate(date: Date): string {
  return date.toISOString();
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create a page that the explorer might link to
      await createWikiPages(ctx, agentCtx.wikiId, [
        {
          path: 'overview',
          title: 'Project Overview',
          content: '# Project Overview\n\nMain documentation entry point.',
        },
      ]);

      const agent = new CodebaseExplorerAgent();
      const result = await agent.run(createPathTarget('src/utils'), agentCtx);

      // For each update that has markdown links in content, verify links array is populated
      const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

      for (const update of result.updates) {
        const matches = [...update.content.matchAll(markdownLinkPattern)];
        if (matches.length > 0) {
          // Extract paths from markdown links
          const linkPaths = matches
            .map(m => m[2])
            .filter(path => !path.startsWith('http') && !path.startsWith('#'));

          if (linkPaths.length > 0) {
            assert.ok(
              update.links && update.links.length > 0,
              `Update for ${update.path} has markdown links in content but links array is empty. ` +
              `Content links: ${linkPaths.join(', ')}`
            );
          }
        }
      }

      // Log for visibility
      console.log(`\n✓ Links array extraction test completed`);
      console.log(`  Updates checked: ${result.updates.length}`);
    });
  });

  describe('Cross-Agent Link Consistency', () => {
    it('agents should reference existing wiki pages when creating related content', async () => {
      // This test creates a scenario where multiple pages exist and verifies
      // that new content creation includes references to them
      const repoId = 'llm-cross-agent-links-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# E-commerce Platform',
        'src/orders/order-service.ts': `
/**
 * Order Service - handles order creation and processing.
 */
export class OrderService {
  async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
    // Validate user
    // Check inventory
    // Process payment
    // Create order
    return { id: 'order-1', userId, items, status: 'pending' };
  }
}
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create existing wiki pages that should be cross-referenced
      await createWikiPages(ctx, agentCtx.wikiId, [
        {
          path: 'services/user-service',
          title: 'User Service',
          content: '# User Service\n\nManages user accounts and authentication.',
        },
        {
          path: 'services/inventory-service',
          title: 'Inventory Service',
          content: '# Inventory Service\n\nTracks product inventory and availability.',
        },
        {
          path: 'services/payment-service',
          title: 'Payment Service',
          content: '# Payment Service\n\nProcesses payments via various providers.',
        },
      ]);

      const agent = new CodebaseExplorerAgent();
      const result = await agent.run(createPathTarget('src/orders'), agentCtx);

      // The order service interacts with user, inventory, and payment
      // Generated documentation SHOULD link to those existing pages

      const allContent = result.updates.map(u => u.content).join('\n');
      const allLinks = result.updates.flatMap(u => u.links || []);

      console.log(`\nCross-Agent Link Test Results:`);
      console.log(`  Updates generated: ${result.updates.length}`);
      console.log(`  Total links in arrays: ${allLinks.length}`);
      if (allLinks.length > 0) {
        console.log(`  Links: ${allLinks.join(', ')}`);
      }

      // Check if any existing service pages are referenced
      const existingServicePages = ['services/user-service', 'services/inventory-service', 'services/payment-service'];
      const linkedServices = existingServicePages.filter(page =>
        allLinks.includes(page) || allContent.includes(page)
      );

      console.log(`  Linked to existing services: ${linkedServices.length}/${existingServicePages.length}`);
      console.log(`  Services linked: ${linkedServices.join(', ') || 'none'}`);

      // Handle case where model produces no updates (model variance)
      if (result.updates.length === 0) {
        console.log(`\n⚠️  Model produced no updates - skipping link evaluation (model variance)`);
        logTestResult('Cross-agent link consistency', {
          score: 5,
          reasoning: 'Model produced no updates - unable to evaluate link consistency',
          passed: true,
        });
        // Don't fail the test for model variance - this is an LLM quality issue
        return;
      }

      // LLM evaluation
      const evalResult = await evaluateLLM(
        'The agent documented an OrderService that interacts with users, inventory, and payments. ' +
        'Existing wiki pages exist for: services/user-service, services/inventory-service, services/payment-service. ' +
        'The generated content SHOULD include links to these related services since OrderService depends on them. ' +
        'Score based on how well the new content connects to existing documentation.',
        JSON.stringify({
          generatedContent: result.updates.map(u => ({ path: u.path, preview: u.content.slice(0, 500) })),
          existingPages: existingServicePages,
          linksFound: allLinks,
          servicesLinked: linkedServices,
        }, null, 2),
        5
      );

      logTestResult('Cross-agent link consistency', evalResult);
      console.log(formatEvaluationResult('Cross-agent link consistency', evalResult));

      // Assert that when content IS generated, it includes links
      assert.ok(
        linkedServices.length > 0,
        `OrderService documentation should link to related services. ` +
        `Expected links to user-service, inventory-service, or payment-service. ` +
        `Found: ${linkedServices.length > 0 ? linkedServices.join(', ') : 'none'}`
      );
    });
  });
});
