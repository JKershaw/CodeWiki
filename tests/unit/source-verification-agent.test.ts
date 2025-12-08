/**
 * Unit tests for SourceVerificationAgent.
 * Tests the agent's ability to verify wiki content against source code.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SourceVerificationAgent } from '../../src/agents/meta/source-verification-agent.js';
import { createWikiTarget, createCommitTarget } from '../../src/domain/work-target.js';

describe('SourceVerificationAgent', () => {
  let agent: SourceVerificationAgent;

  beforeEach(() => {
    agent = new SourceVerificationAgent();
  });

  describe('canHandle', () => {
    it('should handle wiki targets', () => {
      const wikiTarget = createWikiTarget();
      assert.strictEqual(agent.canHandle(wikiTarget), true);
    });

    it('should not handle commit targets', () => {
      const commitTarget = createCommitTarget('abc123');
      assert.strictEqual(agent.canHandle(commitTarget), false);
    });
  });

  describe('getSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = agent.getSystemPrompt();
      assert.ok(prompt.length > 0);
      assert.ok(prompt.includes('Source Verification'));
    });

    it('should mention source code verification', () => {
      const prompt = agent.getSystemPrompt();
      assert.ok(prompt.includes('source code'));
      assert.ok(prompt.includes('verify') || prompt.includes('FACTUAL ACCURACY'));
    });
  });

  describe('type', () => {
    it('should have the correct agent type', () => {
      assert.strictEqual(agent.type, 'source-verification');
    });
  });

  describe('run with invalid target', () => {
    it('should throw for commit targets', async () => {
      const commitTarget = createCommitTarget('abc123');
      const mockContext = {} as any;

      await assert.rejects(
        () => agent.run(commitTarget, mockContext),
        /cannot handle target type/i
      );
    });
  });

  describe('runOnCommit', () => {
    it('should throw as this agent does not process commits', async () => {
      const mockContext = {} as any;

      await assert.rejects(
        () => agent.run(createCommitTarget('abc123'), mockContext),
        /cannot handle target type/i
      );
    });
  });
});
