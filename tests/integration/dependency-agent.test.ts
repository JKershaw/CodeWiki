/**
 * Integration tests for DependencyAgent.
 * Tests the agent that tracks dependency changes and their implications.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { DependencyAgent } from '../../src/agents/analysis/dependency-agent.js';
import { dependencyAgentResponses } from '../fixtures/agent-responses.js';

describe('DependencyAgent', () => {
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

  describe('runOnCommit', () => {
    it('detects added dependencies from package.json', async () => {
      const repoId = 'dependency-added';

      // Create repo with initial package.json
      await createTestRepo(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            express: '^4.18.0',
          },
        }, null, 2),
      });

      // Add commit with new dependencies
      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            express: '^4.18.0',
            lodash: '^4.17.21',
            axios: '^1.6.0',
          },
        }, null, 2),
      }, 'Add lodash and axios dependencies');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add lodash and axios dependencies',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 4,
          linesDeleted: 1,
          affectedFiles: ['package.json'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(dependencyAgentResponses.dependenciesAdded(commitSha));

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should have findings about added dependencies
      assert.ok(result.result.findings.length > 0, 'Should have findings for added dependencies');

      // Should identify dependency additions
      const addedFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('added') ||
        f.description.toLowerCase().includes('lodash') ||
        f.description.toLowerCase().includes('axios')
      );
      assert.ok(addedFinding, 'Should identify dependency additions');

      // Should create wiki updates for dependencies
      assert.ok(result.updates.length > 0, 'Should create wiki updates');

      // Should have dependencies page update
      const dependenciesPage = result.updates.find(u =>
        u.path.includes('dependencies') || u.path.includes('architecture')
      );
      assert.ok(dependenciesPage, 'Should update dependencies documentation');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('detects dependency updates with breaking changes', async () => {
      const repoId = 'dependency-breaking';

      // Create repo with React 17
      await createTestRepo(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'react-app',
          version: '1.0.0',
          dependencies: {
            react: '^17.0.2',
            'react-dom': '^17.0.2',
          },
        }, null, 2),
      });

      // Update to React 18
      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'react-app',
          version: '1.0.0',
          dependencies: {
            react: '^18.2.0',
            'react-dom': '^18.2.0',
          },
        }, null, 2),
      }, 'Upgrade to React 18');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Upgrade to React 18',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 2,
          linesDeleted: 2,
          affectedFiles: ['package.json'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(dependencyAgentResponses.dependencyUpdatedWithBreakingChanges(commitSha));

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should identify breaking changes as high importance
      const breakingFinding = result.result.findings.find(f =>
        f.importance === 'high' ||
        f.description.toLowerCase().includes('breaking') ||
        f.description.toLowerCase().includes('major')
      );
      assert.ok(breakingFinding, 'Should identify breaking changes with high importance');

      // Should have high confidence for clear version change
      assert.ok(result.result.confidence >= 0.8, 'Should have high confidence for major update');
    });

    it('skips non-dependency commits', async () => {
      const repoId = 'dependency-skip';

      await createTestRepo(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          dependencies: { express: '^4.18.0' },
        }, null, 2),
        'README.md': '# Test',
      });

      // Add a commit that doesn't touch dependencies
      const commitSha = await addCommit(ctx, repoId, {
        'src/index.ts': `
export function main() {
  console.log('Hello, World!');
}
`,
      }, 'Add main entry point');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add main entry point',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 5,
          linesDeleted: 0,
          affectedFiles: ['src/index.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Note: The DependencyAgent checks for dependency files before calling LLM
      // So it should return early without LLM call

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should return with no dependency changes message
      assert.ok(
        result.result.summary.toLowerCase().includes('no dependency') ||
        result.result.summary.toLowerCase().includes('no changes'),
        'Summary should indicate no dependency changes'
      );

      // Should not make LLM call, so cost should be 0
      assert.strictEqual(result.costUsd, 0, 'Should not incur LLM cost for non-dependency commits');

      // Should not create any wiki updates
      assert.strictEqual(result.updates.length, 0, 'Should not create wiki pages');
    });

    it('handles various dependency file types', async () => {
      const repoId = 'dependency-types';

      // Test with Python requirements.txt
      await createTestRepo(ctx, repoId, {
        'requirements.txt': 'flask==2.0.0\nrequests==2.28.0',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'requirements.txt': 'flask==2.0.0\nrequests==2.28.0\nnumpy==1.24.0',
      }, 'Add numpy dependency');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add numpy dependency',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          linesAdded: 1,
          linesDeleted: 0,
          affectedFiles: ['requirements.txt'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Custom response for Python dependencies
      ctx.llm.setDefaultResponse(`SUMMARY:
Added numpy for numerical computing.

CHANGES:
- [ADDED] numpy [1.24.0] Scientific computing library

BREAKING_CHANGES:

SECURITY_NOTES:

IMPACT:
moderate

WIKI_UPDATES:
- [architecture/dependencies] [update] Add numpy to dependencies

CONFIDENCE: 0.85`);

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should detect dependency changes from requirements.txt
      assert.ok(result.result.findings.length > 0, 'Should detect dependencies from requirements.txt');
      assert.ok(result.costUsd > 0, 'Should make LLM call for requirements.txt changes');
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'dependency-nonexistent';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const agent = new DependencyAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await assert.rejects(
        async () => agent.runOnCommit('nonexistent-commit-id', agentCtx),
        /not found/i,
        'Should throw error for non-existent commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new DependencyAgent();
      assert.strictEqual(agent.type, 'dependency', 'Agent type should be dependency');
    });

    it('can handle commit targets', () => {
      const agent = new DependencyAgent();
      assert.ok(agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should handle commit targets');
    });

    it('cannot handle wiki targets', () => {
      const agent = new DependencyAgent();
      assert.ok(!agent.canHandle({ type: 'wiki' }), 'Should not handle wiki targets');
    });
  });
});
