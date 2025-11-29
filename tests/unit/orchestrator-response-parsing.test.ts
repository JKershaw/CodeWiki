/**
 * Unit tests for parseOrchestratorResponse function.
 * Tests JSON parsing, repair, and validation of LLM orchestrator responses.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { parseOrchestratorResponse } from '../../src/agents/orchestrator/prompts.js';

describe('parseOrchestratorResponse', () => {
  const validCommitIds = new Set(['abc123', 'def456', 'ghi789']);

  // Suppress console output during tests
  mock.method(console, 'warn', () => {});
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});

  describe('valid JSON parsing', () => {
    it('should parse well-formed JSON', () => {
      const response = JSON.stringify({
        reasoning: 'Testing valid JSON',
        workItems: [
          { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Test' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);

      assert.strictEqual(result.reasoning, 'Testing valid JSON');
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
    });

    it('should extract JSON from markdown code blocks', () => {
      const response = `Here's my analysis:
\`\`\`json
{
  "reasoning": "From markdown block",
  "workItems": []
}
\`\`\``;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'From markdown block');
    });

    it('should extract JSON from response with surrounding text', () => {
      const response = `I'll generate a work list:
{
  "reasoning": "Extracted from text",
  "workItems": []
}
That's my recommendation.`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Extracted from text');
    });
  });

  describe('JSON repair functionality', () => {
    it('should handle trailing commas in arrays', () => {
      const response = `{
  "reasoning": "Trailing comma test",
  "workItems": [
    { "agentType": "writer", "reason": "Test" },
  ]
}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Trailing comma test');
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should handle trailing commas in objects', () => {
      const response = `{
  "reasoning": "Object trailing comma",
  "workItems": [],
}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Object trailing comma');
    });

    it('should handle multiple trailing commas', () => {
      const response = `{
  "reasoning": "Multiple trailing commas",
  "workItems": [
    { "agentType": "writer", "reason": "First", },
    { "agentType": "link", "reason": "Second", },
  ],
}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Multiple trailing commas');
      assert.strictEqual(result.workItems.length, 2);
    });

    it('should handle JavaScript-style single-line comments', () => {
      const response = `{
  "reasoning": "Has comments", // This is a comment
  "workItems": [] // Another comment
}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Has comments');
    });

    it('should handle JavaScript-style block comments', () => {
      const response = `{
  "reasoning": "Block comment test",
  /* This is a block comment */
  "workItems": []
}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Block comment test');
    });
  });

  describe('truncated JSON repair', () => {
    it('should repair truncated JSON with complete work items', () => {
      // Simulates LLM response cut off after a complete work item
      const response = `{
  "reasoning": "Truncated but recoverable",
  "workItems": [
    { "agentType": "writer", "reason": "First item complete" },
    { "agentType": "link", "reason": "Second item complete" },`;
      // Missing closing ] and }

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Truncated but recoverable');
      assert.strictEqual(result.workItems.length, 2);
    });

    it('should repair JSON truncated after trailing comma', () => {
      const response = `{
  "reasoning": "Test truncation",
  "workItems": [
    { "agentType": "overview", "reason": "Complete" },
  `;
      // Cut off with trailing comma

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });
  });

  describe('error handling for unparseable JSON', () => {
    it('should throw for completely invalid JSON', () => {
      const response = 'This is not JSON at all, just random text.';

      assert.throws(
        () => parseOrchestratorResponse(response, validCommitIds),
        /Failed to parse orchestrator JSON response/
      );
    });

    it('should throw for truncated JSON mid-property', () => {
      // Truncated in the middle of a property value - can't be repaired
      const response = `{
  "reasoning": "This got cut off",
  "workItems": [
    { "agentType": "code-change", "targetCommitId": "abc123"`;

      assert.throws(
        () => parseOrchestratorResponse(response, validCommitIds),
        /Failed to parse orchestrator JSON response/
      );
    });

    it('should throw for JSON with unrecoverable syntax errors', () => {
      const response = `{
  "reasoning": "Bad syntax"
  "workItems": []
}`;  // Missing comma between properties

      assert.throws(
        () => parseOrchestratorResponse(response, validCommitIds),
        /Failed to parse orchestrator JSON response/
      );
    });
  });

  describe('work item validation', () => {
    it('should filter out invalid agent types', () => {
      const response = JSON.stringify({
        reasoning: 'Testing validation',
        workItems: [
          { agentType: 'invalid-agent', targetCommitId: 'abc123', reason: 'Bad' },
          { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Good' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
    });

    it('should filter out analysis agents missing targetCommitId', () => {
      const response = JSON.stringify({
        reasoning: 'Testing validation',
        workItems: [
          { agentType: 'code-change', reason: 'Missing commit ID' },
          { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Has commit ID' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should filter out analysis agents with invalid commit IDs', () => {
      const response = JSON.stringify({
        reasoning: 'Testing validation',
        workItems: [
          { agentType: 'code-change', targetCommitId: 'invalid-sha', reason: 'Bad SHA' },
          { agentType: 'code-change', targetCommitId: 'abc123', reason: 'Valid SHA' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should remove targetCommitId from meta/synthesis agents', () => {
      const response = JSON.stringify({
        reasoning: 'Testing validation',
        workItems: [
          { agentType: 'writer', targetCommitId: 'abc123', reason: 'Should remove commit' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].targetCommitId, undefined);
    });

    it('should provide default reason when missing', () => {
      const response = JSON.stringify({
        reasoning: 'Testing defaults',
        workItems: [
          { agentType: 'writer' }
        ]
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems[0].reason, 'No reason provided');
    });

    it('should provide default reasoning when missing', () => {
      const response = JSON.stringify({
        workItems: []
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'No reasoning provided');
    });
  });

  describe('edge cases', () => {
    it('should handle empty workItems array', () => {
      const response = JSON.stringify({
        reasoning: 'Nothing to do',
        workItems: []
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should handle missing workItems property', () => {
      const response = JSON.stringify({
        reasoning: 'No work items property'
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should handle workItems that is not an array', () => {
      const response = JSON.stringify({
        reasoning: 'Work items is object',
        workItems: { item1: 'foo' }
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should handle very large responses', () => {
      // Simulate a large response with many work items
      const workItems = Array.from({ length: 100 }, (_, i) => ({
        agentType: 'code-change',
        targetCommitId: i % 3 === 0 ? 'abc123' : i % 3 === 1 ? 'def456' : 'ghi789',
        reason: `Test item ${i} with some longer description to make it more realistic`
      }));

      const response = JSON.stringify({
        reasoning: 'Large response test with a longer reasoning string that explains the strategy',
        workItems
      });

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 100);
    });
  });
});
