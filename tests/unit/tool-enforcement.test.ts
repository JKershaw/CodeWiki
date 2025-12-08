/**
 * Unit tests for the tool enforcement module.
 *
 * These tests verify that tool usage requirements are properly validated
 * and that agents are held accountable for using verification tools.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  validateToolUsage,
  isWarnOnly,
  hasToolRequirements,
  formatToolMetricsForLog,
  ToolEnforcementError,
  DEFAULT_TOOL_REQUIREMENTS,
} from '../../src/executor/tool-enforcement.js';
import type { ToolMetrics } from '../../src/agents/base-agent.js';

describe('Tool Enforcement', () => {
  describe('validateToolUsage', () => {
    it('returns valid when no requirements are set', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 0,
        toolsUsed: {},
        filesRead: [],
      };

      // 'quality' agent has no requirements
      const result = validateToolUsage('quality', metrics);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.message, 'OK');
    });

    it('returns invalid when minFilesRead not met', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 0,
        toolsUsed: {},
        filesRead: [],
      };

      // 'code-change' requires minFilesRead: 1
      const result = validateToolUsage('code-change', metrics);

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('processed 0 file(s)'));
      assert.ok(result.message.includes('1 required'));
    });

    it('returns valid when files are pre-fetched (no tool calls)', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 0,
        toolsUsed: {},
        filesRead: ['src/foo.ts', 'src/bar.ts'], // Pre-fetched files
      };

      // 'code-change' requires minFilesRead: 1, but minToolCalls: 0
      const result = validateToolUsage('code-change', metrics);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.message, 'OK');
    });

    it('returns valid when minToolCalls is met', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 2,
        toolsUsed: { read_file: 2 },
        filesRead: ['src/foo.ts', 'src/bar.ts'],
      };

      const result = validateToolUsage('code-change', metrics);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.message, 'OK');
      assert.strictEqual(result.toolCallCount, 2);
    });

    it('returns invalid when required tool is not used (with config override)', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 1,
        toolsUsed: { search_files: 1 }, // Used search_files but not read_file
        filesRead: [],
      };

      // Use config override to require specific tools
      const result = validateToolUsage('code-change', metrics, {
        requiredTools: ['read_file'],
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('did not use required tool'));
      assert.ok(result.message.includes('read_file'));
      assert.deepStrictEqual(result.missingTools, ['read_file']);
    });

    it('returns valid when all required tools are used (with config override)', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 3,
        toolsUsed: { read_file: 2, search_files: 1 },
        filesRead: ['src/foo.ts', 'src/bar.ts'],
      };

      const result = validateToolUsage('security', metrics, {
        requiredTools: ['read_file'],
      });

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.missingTools, []);
    });

    it('tracks toolsUsed in result', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 3,
        toolsUsed: { read_file: 2, list_directory: 1 },
        filesRead: ['file1.ts', 'file2.ts'],
      };

      const result = validateToolUsage('pattern', metrics);

      assert.deepStrictEqual(result.toolsUsed, ['read_file', 'list_directory']);
    });

    it('accepts config override', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 5,
        toolsUsed: { read_file: 3, search_files: 2 },
        filesRead: [],
      };

      // Override default config with stricter requirements
      const result = validateToolUsage('quality', metrics, {
        minToolCalls: 10,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('10 required'));
    });
  });

  describe('isWarnOnly', () => {
    it('returns true for warnOnly agents', () => {
      assert.strictEqual(isWarnOnly('narrative'), true);
      assert.strictEqual(isWarnOnly('dependency'), true);
      assert.strictEqual(isWarnOnly('writer'), true);
    });

    it('returns false for strict agents', () => {
      assert.strictEqual(isWarnOnly('code-change'), false);
      assert.strictEqual(isWarnOnly('pattern'), false);
      assert.strictEqual(isWarnOnly('security'), false);
      assert.strictEqual(isWarnOnly('technical-debt'), false);
    });

    it('returns false for agents with no config', () => {
      // Unknown agent type
      assert.strictEqual(isWarnOnly('unknown-agent' as any), false);
    });
  });

  describe('hasToolRequirements', () => {
    it('returns false for agents with only minFilesRead (pre-fetch is acceptable)', () => {
      // Analysis agents now use minFilesRead instead of minToolCalls
      // hasToolRequirements checks minToolCalls > 0 OR requiredTools
      assert.strictEqual(hasToolRequirements('code-change'), false);
      assert.strictEqual(hasToolRequirements('pattern'), false);
    });

    it('returns false for agents with no requirements', () => {
      assert.strictEqual(hasToolRequirements('quality'), false);
      assert.strictEqual(hasToolRequirements('link'), false);
    });

    it('returns false for unknown agents', () => {
      assert.strictEqual(hasToolRequirements('unknown-agent' as any), false);
    });
  });

  describe('formatToolMetricsForLog', () => {
    it('formats valid tool usage correctly', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 2,
        toolsUsed: { read_file: 2 },
        filesRead: ['a.ts', 'b.ts'],
      };

      const log = formatToolMetricsForLog('code-change', metrics);

      assert.ok(log.includes('✓'));
      assert.ok(log.includes('code-change'));
      assert.ok(log.includes('2 tool call(s)'));
      assert.ok(log.includes('read_file(2)'));
    });

    it('formats invalid tool usage with warning', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 0,
        toolsUsed: {},
        filesRead: [], // No files read = invalid for code-change
      };

      const log = formatToolMetricsForLog('code-change', metrics);

      assert.ok(log.includes('⚠'));
      assert.ok(log.includes('code-change'));
      assert.ok(log.includes('0 tool call(s)'));
      assert.ok(log.includes('none'));
    });

    it('formats valid pre-fetch usage correctly', () => {
      const metrics: ToolMetrics = {
        toolCallCount: 0,
        toolsUsed: {},
        filesRead: ['src/foo.ts', 'src/bar.ts'], // Pre-fetched files
      };

      const log = formatToolMetricsForLog('code-change', metrics);

      assert.ok(log.includes('✓')); // Valid because files were read
      assert.ok(log.includes('code-change'));
      assert.ok(log.includes('0 tool call(s)'));
    });
  });

  describe('ToolEnforcementError', () => {
    it('creates error with correct properties', () => {
      const validation = {
        valid: false,
        message: "Agent 'code-change' made 0 tool call(s), but 1 required",
        toolCallCount: 0,
        toolsUsed: [],
        missingTools: [],
      };

      const error = new ToolEnforcementError('code-change', validation);

      assert.strictEqual(error.name, 'ToolEnforcementError');
      assert.strictEqual(error.agentType, 'code-change');
      assert.strictEqual(error.validation, validation);
      assert.strictEqual(error.message, validation.message);
    });
  });

  describe('DEFAULT_TOOL_REQUIREMENTS', () => {
    it('has minFilesRead requirements for analysis agents (pre-fetch accepted)', () => {
      const analysisAgents = ['code-change', 'pattern', 'security', 'technical-debt', 'codebase-explorer'];

      for (const agent of analysisAgents) {
        const config = DEFAULT_TOOL_REQUIREMENTS[agent as keyof typeof DEFAULT_TOOL_REQUIREMENTS];
        assert.ok(config, `${agent} should have config`);
        assert.ok(config.minFilesRead && config.minFilesRead > 0, `${agent} should require files to be read`);
        assert.strictEqual(config.minToolCalls, 0, `${agent} should accept pre-fetch (minToolCalls: 0)`);
        assert.strictEqual(config.warnOnly, undefined, `${agent} should be strict (not warnOnly)`);
      }
    });

    it('has warnOnly for some agents', () => {
      const warnOnlyAgents = ['narrative', 'dependency', 'bootstrap', 'project-overview'];

      for (const agent of warnOnlyAgents) {
        const config = DEFAULT_TOOL_REQUIREMENTS[agent as keyof typeof DEFAULT_TOOL_REQUIREMENTS];
        assert.ok(config, `${agent} should have config`);
        assert.strictEqual(config.warnOnly, true, `${agent} should be warnOnly`);
      }
    });

    it('has no requirements for meta agents', () => {
      const metaAgents = ['quality', 'link', 'wiki-editor', 'structure', 'consistency'];

      for (const agent of metaAgents) {
        const config = DEFAULT_TOOL_REQUIREMENTS[agent as keyof typeof DEFAULT_TOOL_REQUIREMENTS];
        assert.ok(config, `${agent} should have config`);
        assert.strictEqual(config.minToolCalls, 0, `${agent} should not require tool calls`);
      }
    });
  });
});
