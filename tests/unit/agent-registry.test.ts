/**
 * Unit tests for the agent registry.
 * Tests that the registry correctly manages and exposes agents.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getAgent,
  getAllAgents,
  getAgentPrompt,
  getAvailableAgentTypes,
} from '../../src/agents/registry.js';

describe('Agent Registry', () => {
  describe('getAgent', () => {
    it('should return CodeChangeAgent for "code-change"', () => {
      const agent = getAgent('code-change');
      assert.ok(agent, 'Should return an agent');
      assert.strictEqual(agent!.type, 'code-change');
    });

    it('should return null for unknown agent type', () => {
      const agent = getAgent('unknown-agent');
      assert.strictEqual(agent, null);
    });

    it('should return agents for all standard types', () => {
      const standardTypes = [
        'code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency',
        'codebase-explorer', 'link', 'structure', 'quality', 'consistency', 'wiki-editor',
        'consolidation', 'overview', 'writer', 'project-overview', 'getting-started',
        'testing-guide', 'extension-guide', 'bootstrap', 'wiki-index', 'toc',
      ];

      for (const type of standardTypes) {
        const agent = getAgent(type);
        assert.ok(agent, `Should return agent for "${type}"`);
        assert.strictEqual(agent!.type, type, `Agent type should be "${type}"`);
      }
    });
  });

  describe('getAllAgents', () => {
    it('should return an array of agents', () => {
      const agents = getAllAgents();
      assert.ok(Array.isArray(agents), 'Should return an array');
      assert.ok(agents.length >= 22, `Should have at least 22 agents, got ${agents.length}`);
    });

    it('should include all standard agent types', () => {
      const agents = getAllAgents();
      const types = agents.map(a => a.type);

      const expectedTypes = [
        'code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency',
        'codebase-explorer', 'link', 'structure', 'quality', 'consistency', 'wiki-editor',
        'consolidation', 'overview', 'writer', 'project-overview', 'getting-started',
        'testing-guide', 'extension-guide', 'bootstrap', 'wiki-index', 'toc',
      ];

      for (const expected of expectedTypes) {
        assert.ok(types.includes(expected), `Should include "${expected}" agent`);
      }
    });
  });

  describe('getAgentPrompt', () => {
    it('should return prompt for agents with LLM', () => {
      const prompt = getAgentPrompt('code-change');
      assert.ok(prompt !== null, 'Should return a prompt');
      assert.ok(typeof prompt === 'string', 'Prompt should be a string');
      assert.ok(prompt.length > 100, 'Prompt should be substantial');
    });

    it('should return null for agents without LLM', () => {
      const prompt = getAgentPrompt('toc');
      assert.strictEqual(prompt, null, 'TOC agent should have no prompt');
    });

    it('should return null for unknown agent type', () => {
      const prompt = getAgentPrompt('unknown-agent');
      assert.strictEqual(prompt, null);
    });
  });

  describe('getAvailableAgentTypes', () => {
    it('should return an array of agent type strings', () => {
      const types = getAvailableAgentTypes();
      assert.ok(Array.isArray(types), 'Should return an array');
      assert.ok(types.length >= 22, `Should have at least 22 types, got ${types.length}`);
      assert.ok(types.every(t => typeof t === 'string'), 'All types should be strings');
    });

    it('should include orchestrator', () => {
      const types = getAvailableAgentTypes();
      assert.ok(types.includes('orchestrator'), 'Should include orchestrator');
    });
  });
});
