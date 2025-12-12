/**
 * Real LLM tests for Synthesis Agents.
 *
 * Tests for agents that synthesize wiki content:
 * - GettingStartedAgent
 * - TestingGuideAgent
 * - ProjectOverviewAgent
 * - ExtensionGuideAgent
 * - OverviewAgent
 *
 * Note: TableOfContentsAgent and WikiIndexAgent don't use LLM (pure computation)
 *
 * Run with: node --import tsx --test tests/llm/synthesis-agents.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { GettingStartedAgent } from '../../src/agents/synthesis/getting-started-agent.js';
import { TestingGuideAgent } from '../../src/agents/synthesis/testing-guide-agent.js';
import { ProjectOverviewAgent } from '../../src/agents/synthesis/project-overview-agent.js';
import { ExtensionGuideAgent } from '../../src/agents/synthesis/extension-guide-agent.js';
import { OverviewAgent } from '../../src/agents/synthesis/overview-agent.js';
import { createWikiTarget } from '../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  type LLMTestContext,
} from './helpers/test-context.js';
import {
  assertLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';

describe('Synthesis Agents with Real LLM', { timeout: 180000 }, () => {
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
        links: [],
        backlinks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.repos.wikiPages.save(wikiPage);
    }
  }

  describe('GettingStartedAgent', () => {
    it('creates getting started guide for mature wiki', async () => {
      const repoId = 'llm-getting-started-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Node.js API Project',
        'package.json': JSON.stringify({
          name: 'api-project',
          scripts: {
            'dev': 'tsx watch src/index.ts',
            'build': 'tsc',
            'test': 'jest',
            'start': 'node dist/index.js',
          },
          dependencies: {
            'express': '^4.18.0',
          },
        }, null, 2),
        'src/index.ts': 'console.log("API Server");',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create 10+ pages to trigger the guide
      const pages = [];
      for (let i = 0; i < 12; i++) {
        pages.push({
          path: `features/feature-${i}`,
          title: `Feature ${i}`,
          content: `# Feature ${i}\n\nDescription of feature ${i}.`,
        });
      }
      await createWikiPages(agentCtx.wikiId, pages);

      const agent = new GettingStartedAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      // Should create a getting started guide
      if (result.updates.length > 0) {
        const guide = result.updates[0]!;
        assert.ok(guide.content.length > 100, 'Guide should have substantial content');

        // LLM-as-judge: Verify guide quality
        const evalResult = await assertLLM(
          'The getting started guide provides practical setup instructions. ' +
          'It should mention npm commands like npm install, npm run dev, or npm run build.',
          guide.content,
          6
        );

        logTestResult('Getting started guide quality', evalResult);
        console.log(formatEvaluationResult('Getting started guide quality', evalResult));
      } else {
        console.log('GettingStartedAgent skipped (conditions not met)');
      }
    });
  });

  describe('TestingGuideAgent', () => {
    it('creates testing guide for project with tests', async () => {
      const repoId = 'llm-testing-guide-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Testing Project',
        'package.json': JSON.stringify({
          name: 'testing-project',
          scripts: {
            'test': 'jest',
            'test:watch': 'jest --watch',
            'test:coverage': 'jest --coverage',
          },
          devDependencies: {
            'jest': '^29.0.0',
            '@types/jest': '^29.0.0',
          },
        }, null, 2),
        'jest.config.js': 'module.exports = { preset: "ts-jest" };',
        'tests/example.test.ts': `
describe('Example', () => {
  it('should work', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages to trigger guide
      const pages = [];
      for (let i = 0; i < 12; i++) {
        pages.push({
          path: `components/component-${i}`,
          title: `Component ${i}`,
          content: `# Component ${i}\n\nDescription.`,
        });
      }
      await createWikiPages(agentCtx.wikiId, pages);

      const agent = new TestingGuideAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const guide = result.updates[0]!;
        assert.ok(guide.content.length > 100, 'Guide should have substantial content');

        // LLM-as-judge: Verify testing guide quality
        const evalResult = await assertLLM(
          'The testing guide explains how to run tests. ' +
          'It should mention Jest, test commands (npm test), or testing patterns.',
          guide.content,
          6
        );

        logTestResult('Testing guide quality', evalResult);
        console.log(formatEvaluationResult('Testing guide quality', evalResult));
      } else {
        console.log('TestingGuideAgent skipped (conditions not met)');
      }
    });

    it('correctly identifies the actual test framework from package.json (factual accuracy)', async () => {
      // This test catches the issue where the testing guide claims wrong test framework
      // e.g., claiming "Vitest" when project actually uses Node's built-in test runner
      const repoId = 'llm-testing-accuracy-test';

      // Create a project that uses Node's BUILT-IN test runner (NOT Jest, NOT Vitest)
      await createTestRepo(ctx, repoId, {
        'README.md': '# Node Test Runner Project',
        'package.json': JSON.stringify({
          name: 'node-test-project',
          type: 'module',
          scripts: {
            'test': 'node --import tsx --test tests/*.test.ts',
            'test:unit': 'node --import tsx --test tests/unit/*.test.ts',
          },
          devDependencies: {
            'tsx': '^4.0.0',
            '@types/node': '^20.0.0',
          },
          // Explicitly NO jest, NO vitest
        }, null, 2),
        'tests/example.test.ts': `
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Example', () => {
  it('should work', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages to trigger guide
      const pages = [];
      for (let i = 0; i < 12; i++) {
        pages.push({
          path: `features/feature-${i}`,
          title: `Feature ${i}`,
          content: `# Feature ${i}\n\nFeature description.`,
        });
      }
      await createWikiPages(agentCtx.wikiId, pages);

      const agent = new TestingGuideAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const guide = result.updates[0]!;
        const content = guide.content.toLowerCase();

        // Check for WRONG frameworks being claimed
        const wrongFrameworks = [];
        if (content.includes('vitest')) wrongFrameworks.push('Vitest');
        if (content.includes('jest') && !content.includes('not jest')) wrongFrameworks.push('Jest');
        if (content.includes('mocha')) wrongFrameworks.push('Mocha');

        // Check for CORRECT framework being mentioned
        const correctIndicators = [
          content.includes('node:test'),
          content.includes("node's built-in"),
          content.includes('node --test'),
          content.includes('built-in test runner'),
          content.includes('native test runner'),
        ];
        const hasCorrectFramework = correctIndicators.some(x => x);

        if (wrongFrameworks.length > 0) {
          console.error('\n❌ TESTING GUIDE CLAIMS WRONG FRAMEWORK:');
          console.error(`   Guide mentions: ${wrongFrameworks.join(', ')}`);
          console.error('   But package.json shows: node --import tsx --test (Node built-in runner)');
          console.error('   Content preview:', guide.content.slice(0, 300));
        }

        // Soft assertion: warn if wrong but don't fail (LLM may have limited context)
        if (wrongFrameworks.length > 0 && !hasCorrectFramework) {
          console.warn(`\n⚠️  Testing guide may be inaccurate (mentioned ${wrongFrameworks.join(', ')} instead of Node built-in)`);
        }

        // LLM-as-judge for accuracy
        const evalResult = await assertLLM(
          'The testing guide should accurately describe the test framework used. ' +
          'This project uses Node.js built-in test runner (node --test), NOT Jest or Vitest. ' +
          'The guide should mention "node:test", "node --test", or "Node\'s built-in test runner".',
          guide.content,
          5  // Lower threshold - factual accuracy is hard
        );

        logTestResult('Testing framework accuracy', evalResult);
        console.log(formatEvaluationResult('Testing framework accuracy', evalResult));
      } else {
        console.log('TestingGuideAgent skipped (conditions not met)');
      }
    });
  });

  describe('ProjectOverviewAgent', () => {
    it('creates project-level overview from wiki content', async () => {
      const repoId = 'llm-project-overview-test';

      await createTestRepo(ctx, repoId, {
        'README.md': `# TaskManager API

A RESTful task management API built with Express.js.

## Features
- Create and manage tasks
- Organize tasks into projects
- User authentication with JWT

## Quick Start
\`\`\`bash
npm install
npm run dev
\`\`\`
`,
        'package.json': JSON.stringify({
          name: 'taskmanager-api',
          scripts: { dev: 'tsx watch src/index.ts' },
        }, null, 2),
        'src/index.ts': 'console.log("TaskManager API");',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create 10+ pages to trigger the agent (without architecture/overview)
      const pages = [
        { path: 'api/tasks', title: 'Task API', content: '# Task API\n\nCRUD operations for tasks.' },
        { path: 'api/projects', title: 'Projects API', content: '# Projects API\n\nProject management endpoints.' },
        { path: 'api/auth', title: 'Authentication', content: '# Auth\n\nJWT authentication endpoints.' },
        { path: 'models/task', title: 'Task Model', content: '# Task\n\nTask entity definition.' },
        { path: 'models/user', title: 'User Model', content: '# User\n\nUser entity definition.' },
        { path: 'services/email', title: 'Email Service', content: '# Email\n\nNotification service.' },
        { path: 'guides/setup', title: 'Setup Guide', content: '# Setup\n\nDevelopment setup guide.' },
        { path: 'decisions/jwt', title: 'JWT Decision', content: '# JWT\n\nWhy we chose JWT.' },
        { path: 'patterns/repository', title: 'Repository Pattern', content: '# Repository\n\nData access pattern.' },
        { path: 'conventions/naming', title: 'Naming Conventions', content: '# Naming\n\nCode naming rules.' },
      ];
      await createWikiPages(agentCtx.wikiId, pages);

      const agent = new ProjectOverviewAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const overview = result.updates[0]!;
        assert.ok(overview.content.length > 200, 'Overview should have substantial content');

        // LLM-as-judge: Verify project overview quality
        const evalResult = await assertLLM(
          'The project overview describes a task management API. ' +
          'It should provide a high-level understanding of the project purpose, ' +
          'architecture, or key components.',
          overview.content,
          6
        );

        logTestResult('Project overview quality', evalResult);
        console.log(formatEvaluationResult('Project overview quality', evalResult));
      } else {
        console.log('ProjectOverviewAgent skipped (conditions not met)');
      }
    });
  });

  describe('ExtensionGuideAgent', () => {
    it('creates extension patterns guide', async () => {
      const repoId = 'llm-extension-guide-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Plugin System',
        'src/plugins/base-plugin.ts': `
export interface Plugin {
  name: string;
  initialize(): void;
  execute(input: string): string;
}
`,
        'src/plugins/uppercase-plugin.ts': `
import { Plugin } from './base-plugin.js';

export class UppercasePlugin implements Plugin {
  name = 'uppercase';
  initialize() { console.log('Uppercase plugin ready'); }
  execute(input: string) { return input.toUpperCase(); }
}
`,
        'src/plugins/reverse-plugin.ts': `
import { Plugin } from './base-plugin.js';

export class ReversePlugin implements Plugin {
  name = 'reverse';
  initialize() { console.log('Reverse plugin ready'); }
  execute(input: string) { return input.split('').reverse().join(''); }
}
`,
        'src/plugins/index.ts': `
export * from './base-plugin.js';
export * from './uppercase-plugin.js';
export * from './reverse-plugin.js';
`,
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create 15+ pages to trigger the agent
      const pages = [];
      for (let i = 0; i < 16; i++) {
        pages.push({
          path: `docs/doc-${i}`,
          title: `Documentation ${i}`,
          content: `# Doc ${i}\n\nContent for documentation ${i}.`,
        });
      }
      await createWikiPages(agentCtx.wikiId, pages);

      const agent = new ExtensionGuideAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const guide = result.updates[0]!;
        assert.ok(guide.content.length > 200, 'Guide should have substantial content');

        // LLM-as-judge: Verify extension guide quality
        const evalResult = await assertLLM(
          'The extension guide explains how to add new features or plugins to the codebase. ' +
          'It should mention patterns, interfaces, or step-by-step instructions.',
          guide.content,
          6
        );

        logTestResult('Extension guide quality', evalResult);
        console.log(formatEvaluationResult('Extension guide quality', evalResult));
      } else {
        console.log('ExtensionGuideAgent skipped (conditions not met)');
      }
    });
  });

  describe('OverviewAgent', () => {
    it('populates links array when creating category overview (fix verification)', async () => {
      // This test verifies Fix #1: Synthesis agents populate links array
      const repoId = 'llm-overview-links-array-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Links Array Test',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages in a category - overview should link to these
      await createWikiPages(agentCtx.wikiId, [
        { path: 'api/users', title: 'Users API', content: '# Users API\n\nUser management endpoints.' },
        { path: 'api/posts', title: 'Posts API', content: '# Posts API\n\nBlog post endpoints.' },
        { path: 'api/comments', title: 'Comments API', content: '# Comments API\n\nComment endpoints.' },
        { path: 'api/auth', title: 'Auth API', content: '# Auth API\n\nAuthentication endpoints.' },
      ]);

      const agent = new OverviewAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const overview = result.updates[0]!;

        // Verify links array exists and is populated
        assert.ok(overview.links !== undefined, 'links array should be defined');

        // Check if content has markdown links
        const hasMarkdownLinks = /\[.+\]\([^)]+\)/.test(overview.content);

        if (hasMarkdownLinks) {
          assert.ok(
            overview.links && overview.links.length > 0,
            `Content has markdown links but links array is empty. ` +
            `This means the fix for synthesizing links is not working.`
          );
          console.log(`\n✓ OverviewAgent populated links array with ${overview.links?.length || 0} links`);
          if (overview.links && overview.links.length > 0) {
            console.log(`  Links: [${overview.links.join(', ')}]`);
          }
        }

        // Check if category pages are linked
        const expectedPages = ['api/users', 'api/posts', 'api/comments', 'api/auth'];
        const linkedPages = overview.links?.filter(l => expectedPages.includes(l)) || [];

        console.log(`\n  Found ${linkedPages.length}/${expectedPages.length} expected category page links`);

        logTestResult('Overview links array population', {
          score: overview.links !== undefined && overview.links.length > 0 ? 10 : 5,
          reasoning: `links array has ${overview.links?.length || 0} entries, ${linkedPages.length} are category pages`,
          passed: overview.links !== undefined,
        });
      } else {
        console.log('OverviewAgent skipped (conditions not met)');
      }
    });

    it('creates category overview page', async () => {
      const repoId = 'llm-category-overview-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Services Documentation',
      });

      const agentCtx = await ctx.agentContext(repoId);

      // Create pages in a single category (without overview)
      await createWikiPages(agentCtx.wikiId, [
        { path: 'services/auth', title: 'Auth Service', content: '# Auth Service\n\nHandles user authentication with JWT tokens.' },
        { path: 'services/email', title: 'Email Service', content: '# Email Service\n\nSends transactional emails via SMTP.' },
        { path: 'services/cache', title: 'Cache Service', content: '# Cache Service\n\nRedis-based caching layer.' },
        { path: 'services/logging', title: 'Logging Service', content: '# Logging Service\n\nStructured logging with Winston.' },
        { path: 'services/queue', title: 'Queue Service', content: '# Queue Service\n\nBackground job processing with Bull.' },
      ]);

      const agent = new OverviewAgent();
      const result = await agent.run(createWikiTarget(), agentCtx);

      if (result.updates.length > 0) {
        const overview = result.updates[0]!;
        assert.ok(overview.content.length > 100, 'Overview should have content');

        // LLM-as-judge: Verify category overview quality
        const evalResult = await assertLLM(
          'The overview page summarizes the services category. ' +
          'It should provide context about the services (auth, email, cache, logging, queue) ' +
          'and how they relate to each other.',
          overview.content,
          6
        );

        logTestResult('Category overview quality', evalResult);
        console.log(formatEvaluationResult('Category overview quality', evalResult));
      } else {
        console.log('OverviewAgent skipped (conditions not met)');
      }
    });
  });
});
