/**
 * Unit tests for the polymorphic Agent interface.
 * Tests that agents correctly implement canHandle() and run() with WorkTarget.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCommitTarget, createPathTarget, createWikiTarget } from '../../src/domain/work-target.js';

describe('Agent Polymorphic Interface', () => {
  describe('canHandle', () => {
    it('commit-based agents should handle commit targets', async () => {
      // Import dynamically to avoid circular dependencies
      const { CodeChangeAgent } = await import('../../src/agents/analysis/code-change-agent.js');
      const agent = new CodeChangeAgent();

      const commitTarget = createCommitTarget('abc123');
      const pathTarget = createPathTarget('src/utils');
      const wikiTarget = createWikiTarget();

      assert.strictEqual(agent.canHandle(commitTarget), true);
      assert.strictEqual(agent.canHandle(pathTarget), false);
      assert.strictEqual(agent.canHandle(wikiTarget), false);
    });

    it('wiki-based agents should handle wiki targets', async () => {
      const { LinkAgent } = await import('../../src/agents/meta/link-agent.js');
      const agent = new LinkAgent();

      const commitTarget = createCommitTarget('abc123');
      const pathTarget = createPathTarget('src/utils');
      const wikiTarget = createWikiTarget();

      assert.strictEqual(agent.canHandle(commitTarget), false);
      assert.strictEqual(agent.canHandle(pathTarget), false);
      assert.strictEqual(agent.canHandle(wikiTarget), true);
    });

    it('path-based agents should handle path targets', async () => {
      const { CodebaseExplorerAgent } = await import('../../src/agents/analysis/codebase-explorer-agent.js');
      const agent = new CodebaseExplorerAgent();

      const commitTarget = createCommitTarget('abc123');
      const pathTarget = createPathTarget('src/utils');
      const wikiTarget = createWikiTarget();

      assert.strictEqual(agent.canHandle(commitTarget), false);
      assert.strictEqual(agent.canHandle(pathTarget), true);
      assert.strictEqual(agent.canHandle(wikiTarget), false);
    });
  });

  describe('run with unsupported target', () => {
    it('commit-based agent should throw for wiki target', async () => {
      const { CodeChangeAgent } = await import('../../src/agents/analysis/code-change-agent.js');
      const agent = new CodeChangeAgent();

      const wikiTarget = createWikiTarget();

      // Mock context - not actually called since it should throw immediately
      const mockContext = {} as any;

      await assert.rejects(
        () => agent.run(wikiTarget, mockContext),
        /cannot handle target type/i
      );
    });

    it('wiki-based agent should throw for commit target', async () => {
      const { LinkAgent } = await import('../../src/agents/meta/link-agent.js');
      const agent = new LinkAgent();

      const commitTarget = createCommitTarget('abc123');

      const mockContext = {} as any;

      await assert.rejects(
        () => agent.run(commitTarget, mockContext),
        /cannot handle target type/i
      );
    });
  });
});
