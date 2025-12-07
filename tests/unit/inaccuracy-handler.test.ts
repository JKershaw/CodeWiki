/**
 * Unit tests for InaccuracyHandler.
 * Tests the handler's ability to correct wiki content based on source code.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { InaccuracyHandler } from '../../src/agents/consolidation/handlers/inaccuracy-handler.js';
import type { FindingGroup } from '../../src/domain/finding.js';
import { MockLLMService } from '../helpers/mock-llm.js';

describe('InaccuracyHandler', () => {
  let handler: InaccuracyHandler;

  beforeEach(() => {
    handler = new InaccuracyHandler();
  });

  describe('supportedTypes', () => {
    it('should support the inaccurate finding type', () => {
      assert.ok(handler.supportedTypes.includes('inaccurate'));
    });

    it('should only support inaccurate type', () => {
      assert.strictEqual(handler.supportedTypes.length, 1);
    });
  });

  describe('handle', () => {
    it('should return empty result when no pages found', async () => {
      const mockLLM = new MockLLMService();

      const group: FindingGroup = {
        type: 'inaccurate',
        findings: [{
          id: '1',
          wikiId: 'wiki1',
          repoId: 'repo1',
          sourceAgentRunId: 'run1',
          type: 'inaccurate',
          description: 'Test inaccuracy',
          affectedPaths: ['nonexistent/page'],
          severity: 'high',
          status: 'open',
          detectedAt: new Date(),
          addressedAt: null,
          addressedByAgentRunId: null,
          metadata: {
            claim: 'Test claim',
            sourceFile: 'src/test.ts',
          },
        }],
        affectedPaths: ['nonexistent/page'],
        severity: 'high',
      };

      // Create mock context with empty repos
      const context = {
        repoId: 'repo1',
        wikiId: 'wiki1',
        repos: {
          wikiPages: {
            findByPath: async () => null,
          },
        },
        git: {},
        llm: mockLLM,
      } as any;

      const result = await handler.handle(group, context);

      assert.strictEqual(result.updates.length, 0);
      assert.ok(result.result.summary.includes('No pages'));
    });

    it('should return empty result when no tool executor available', async () => {
      const mockLLM = new MockLLMService();

      const group: FindingGroup = {
        type: 'inaccurate',
        findings: [{
          id: '1',
          wikiId: 'wiki1',
          repoId: 'repo1',
          sourceAgentRunId: 'run1',
          type: 'inaccurate',
          description: 'Test inaccuracy',
          affectedPaths: ['architecture/auth'],
          severity: 'high',
          status: 'open',
          detectedAt: new Date(),
          addressedAt: null,
          addressedByAgentRunId: null,
          metadata: {
            claim: 'Uses JWT tokens',
            sourceFile: 'src/auth.ts',
          },
        }],
        affectedPaths: ['architecture/auth'],
        severity: 'high',
      };

      // Mock context with page but no tool executor (GitHub repo scenario)
      const context = {
        repoId: 'repo1',
        wikiId: 'wiki1',
        repos: {
          wikiPages: {
            findByPath: async () => ({
              id: 'page1',
              wikiId: 'wiki1',
              path: 'architecture/auth',
              title: 'Authentication',
              content: 'Uses JWT tokens for auth.',
              category: 'architecture',
              confidence: 0.8,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
        },
        git: {
          getRepoPath: () => { throw new Error('Not a local repo'); },
        },
        llm: mockLLM,
        repo: { isGitHubRepo: true }, // GitHub repo - no tool executor
      } as any;

      const result = await handler.handle(group, context);

      assert.ok(result.result.summary.includes('no tool executor') || result.updates.length === 0);
    });
  });
});
