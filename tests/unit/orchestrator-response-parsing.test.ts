/**
 * Unit tests for parseOrchestratorResponse function.
 * Tests markdown parsing and validation of LLM orchestrator responses.
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

  describe('valid markdown parsing', () => {
    it('should parse well-formed markdown response', () => {
      const response = `# Reasoning
Testing valid markdown format

# Work Items
code-change,abc123,Test reason`;

      const result = parseOrchestratorResponse(response, validCommitIds);

      assert.strictEqual(result.reasoning, 'Testing valid markdown format');
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
      assert.strictEqual(result.workItems[0].targetCommitId, 'abc123');
      assert.strictEqual(result.workItems[0].reason, 'Test reason');
    });

    it('should parse multiple work items', () => {
      const response = `# Reasoning
Multiple items test

# Work Items
code-change,abc123,First commit analysis
code-change,def456,Second commit analysis
writer,,Rewrite pages for readability`;

      const result = parseOrchestratorResponse(response, validCommitIds);

      assert.strictEqual(result.workItems.length, 3);
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
      assert.strictEqual(result.workItems[1].targetCommitId, 'def456');
      assert.strictEqual(result.workItems[2].agentType, 'writer');
      assert.strictEqual(result.workItems[2].targetCommitId, undefined);
    });

    it('should handle case-insensitive section headers', () => {
      const response = `# REASONING
Upper case headers

# WORK ITEMS
writer,,Test`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Upper case headers');
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should handle extra whitespace in headers', () => {
      const response = `#   Reasoning
With extra spaces

#  Work   Items
link,,Test links`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'With extra spaces');
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should handle multi-line reasoning', () => {
      const response = `# Reasoning
First line of reasoning.
Second line with more details.
Third line concluding the thought.

# Work Items
writer,,Test`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(
        result.reasoning,
        'First line of reasoning. Second line with more details. Third line concluding the thought.'
      );
    });
  });

  describe('comma handling in reasons', () => {
    it('should handle reasons containing commas', () => {
      const response = `# Reasoning
Test commas

# Work Items
code-change,abc123,This reason has, multiple, commas in it`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems[0].reason, 'This reason has, multiple, commas in it');
    });

    it('should handle empty targetCommitId with commas in reason', () => {
      const response = `# Reasoning
Test

# Work Items
writer,,Rewrite pages: intro, overview, and summary`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems[0].reason, 'Rewrite pages: intro, overview, and summary');
    });
  });

  describe('truncation handling', () => {
    it('should parse complete work items even if response is truncated', () => {
      // Simulates response cut off mid-line
      const response = `# Reasoning
Truncated response test

# Work Items
code-change,abc123,First complete item
code-change,def456,Second complete item
code-change,ghi789,Third item that gets cut o`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      // Should get all 3 items since all lines are parseable
      assert.strictEqual(result.workItems.length, 3);
    });

    it('should skip incomplete lines gracefully', () => {
      const response = `# Reasoning
Test

# Work Items
code-change,abc123,Complete item
incomplete-line-no-commas`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      // Only the complete item should be parsed
      assert.strictEqual(result.workItems.length, 1);
    });
  });

  describe('work item validation', () => {
    it('should filter out invalid agent types', () => {
      const response = `# Reasoning
Testing validation

# Work Items
invalid-agent,abc123,Bad agent type
code-change,abc123,Good agent type`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
    });

    it('should filter out analysis agents missing targetCommitId', () => {
      const response = `# Reasoning
Testing validation

# Work Items
code-change,,Missing commit ID
code-change,abc123,Has commit ID`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should filter out analysis agents with invalid commit IDs', () => {
      const response = `# Reasoning
Testing validation

# Work Items
code-change,invalid-sha,Bad SHA
code-change,abc123,Valid SHA`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should remove targetCommitId from meta/synthesis agents', () => {
      const response = `# Reasoning
Testing validation

# Work Items
writer,abc123,Should remove commit`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].targetCommitId, undefined);
    });

    it('should provide default reason when empty', () => {
      const response = `# Reasoning
Testing defaults

# Work Items
writer,,`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems[0].reason, 'No reason provided');
    });

    it('should provide default reasoning when section is empty', () => {
      const response = `# Reasoning

# Work Items
writer,,Test`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'No reasoning provided');
    });

    it('should provide default reasoning when section is missing', () => {
      const response = `# Work Items
writer,,Test`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'No reasoning provided');
    });
  });

  describe('edge cases', () => {
    it('should handle empty work items section', () => {
      const response = `# Reasoning
Nothing to do

# Work Items`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Nothing to do');
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should handle missing work items section', () => {
      const response = `# Reasoning
No work items section provided`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'No work items section provided');
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should handle completely empty response', () => {
      const response = '';

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'No reasoning provided');
      assert.strictEqual(result.workItems.length, 0);
    });

    it('should skip other markdown headers', () => {
      const response = `# Reasoning
Test reasoning

## Some other section
This should be ignored

# Work Items
writer,,Test

### Another header
Also ignored`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Test reasoning');
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should handle whitespace-only lines', () => {
      const response = `# Reasoning
Test



# Work Items

writer,,Test
   `;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 1);
    });

    it('should handle very large responses', () => {
      // Simulate a large response with many work items
      const workItems = Array.from({ length: 100 }, (_, i) => {
        const commitId = i % 3 === 0 ? 'abc123' : i % 3 === 1 ? 'def456' : 'ghi789';
        return `code-change,${commitId},Test item ${i} with some longer description`;
      });

      const response = `# Reasoning
Large response test with a longer reasoning string

# Work Items
${workItems.join('\n')}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, 100);
    });

    it('should trim whitespace from parsed values', () => {
      const response = `# Reasoning
  Test with whitespace

# Work Items
  code-change  ,  abc123  ,  Reason with spaces  `;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.reasoning, 'Test with whitespace');
      assert.strictEqual(result.workItems[0].agentType, 'code-change');
      assert.strictEqual(result.workItems[0].targetCommitId, 'abc123');
      assert.strictEqual(result.workItems[0].reason, 'Reason with spaces');
    });
  });

  describe('all agent types', () => {
    it('should accept all valid analysis agent types', () => {
      const analysisAgents = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
      const response = `# Reasoning
Test all analysis agents

# Work Items
${analysisAgents.map(agent => `${agent},abc123,Testing ${agent}`).join('\n')}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, analysisAgents.length);
    });

    it('should accept all valid meta agent types', () => {
      const metaAgents = ['link', 'structure', 'quality', 'consistency'];
      const response = `# Reasoning
Test all meta agents

# Work Items
${metaAgents.map(agent => `${agent},,Testing ${agent}`).join('\n')}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, metaAgents.length);
    });

    it('should accept all valid synthesis agent types', () => {
      const synthesisAgents = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer'];
      const response = `# Reasoning
Test all synthesis agents

# Work Items
${synthesisAgents.map(agent => `${agent},,Testing ${agent}`).join('\n')}`;

      const result = parseOrchestratorResponse(response, validCommitIds);
      assert.strictEqual(result.workItems.length, synthesisAgents.length);
    });
  });

  describe('codebase-explorer with targetPath', () => {
    const validPaths = new Set(['src/agents', 'src/services', 'src/services/llm']);

    it('should parse codebase-explorer with valid targetPath', () => {
      const response = `# Reasoning
Exploring low coverage directories

# Work Items
codebase-explorer,src/agents,Low coverage directory needs documentation`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].agentType, 'codebase-explorer');
      assert.strictEqual(result.workItems[0].targetPath, 'src/agents');
      assert.strictEqual(result.workItems[0].targetCommitId, undefined);
      assert.strictEqual(result.workItems[0].reason, 'Low coverage directory needs documentation');
    });

    it('should parse multiple codebase-explorer work items', () => {
      const response = `# Reasoning
Multiple exploration targets

# Work Items
codebase-explorer,src/agents,First directory
codebase-explorer,src/services/llm,Second directory`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 2);
      assert.strictEqual(result.workItems[0].targetPath, 'src/agents');
      assert.strictEqual(result.workItems[1].targetPath, 'src/services/llm');
    });

    it('should reject codebase-explorer without targetPath', () => {
      const response = `# Reasoning
Missing path

# Work Items
codebase-explorer,,No path provided`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 0);
    });

    it('should reject codebase-explorer with invalid path prefix', () => {
      const response = `# Reasoning
Invalid path

# Work Items
codebase-explorer,invalid/path,Not starting with src/`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 0);
    });

    it('should reject codebase-explorer with path not in validPaths', () => {
      const response = `# Reasoning
Unknown path

# Work Items
codebase-explorer,src/unknown/directory,Path not in coverage tree`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 0);
    });

    it('should allow codebase-explorer paths without validation when validPaths not provided', () => {
      const response = `# Reasoning
No validation

# Work Items
codebase-explorer,src/any/path,No path validation`;

      const result = parseOrchestratorResponse(response, validCommitIds);

      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].targetPath, 'src/any/path');
    });

    it('should allow codebase-explorer paths when validPaths is empty Set (null coverage tree)', () => {
      // When coverage tree is null, extractPathsFromTree returns empty Set
      // This should NOT reject all paths - empty Set means "no validation possible"
      const emptyPaths = new Set<string>();
      const response = `# Reasoning
Coverage tree unavailable

# Work Items
codebase-explorer,src/agents,Explore agents directory
codebase-explorer,src/services,Explore services directory`;

      const result = parseOrchestratorResponse(response, validCommitIds, emptyPaths);

      // Both paths should be accepted since we can't validate against empty set
      assert.strictEqual(result.workItems.length, 2);
      assert.strictEqual(result.workItems[0].targetPath, 'src/agents');
      assert.strictEqual(result.workItems[1].targetPath, 'src/services');
    });

    it('should accept lib/ paths for exploration', () => {
      const libPaths = new Set(['lib/utils']);
      const response = `# Reasoning
Exploring lib

# Work Items
codebase-explorer,lib/utils,Library utilities`;

      const result = parseOrchestratorResponse(response, validCommitIds, libPaths);

      assert.strictEqual(result.workItems.length, 1);
      assert.strictEqual(result.workItems[0].targetPath, 'lib/utils');
    });

    it('should normalize paths with trailing slashes', () => {
      const response = `# Reasoning
Paths with trailing slashes

# Work Items
codebase-explorer,src/agents/,First directory with trailing slash
codebase-explorer,src/services/,Second directory with trailing slash`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 2);
      assert.strictEqual(result.workItems[0].targetPath, 'src/agents');
      assert.strictEqual(result.workItems[1].targetPath, 'src/services');
    });

    it('should mix codebase-explorer with other agent types', () => {
      const response = `# Reasoning
Mixed work items

# Work Items
codebase-explorer,src/agents,Explore agents
code-change,abc123,Analyze recent commit
writer,,Improve page readability`;

      const result = parseOrchestratorResponse(response, validCommitIds, validPaths);

      assert.strictEqual(result.workItems.length, 3);
      assert.strictEqual(result.workItems[0].agentType, 'codebase-explorer');
      assert.strictEqual(result.workItems[0].targetPath, 'src/agents');
      assert.strictEqual(result.workItems[1].agentType, 'code-change');
      assert.strictEqual(result.workItems[1].targetCommitId, 'abc123');
      assert.strictEqual(result.workItems[2].agentType, 'writer');
    });
  });
});
