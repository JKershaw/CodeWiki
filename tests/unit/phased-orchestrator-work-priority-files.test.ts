/**
 * Unit tests for PhasedOrchestrator work generation with priorityFiles.
 *
 * Tests that exploration work items include priorityFiles from lowCoverageFiles,
 * ensuring the codebase-explorer agent reads undocumented files first.
 *
 * TDD: These tests expose the bug where phased-orchestrator didn't pass
 * priorityFiles to work items, unlike strategies.ts which did it correctly.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  createExplorationWorkItem,
  MAX_PRIORITY_FILES,
} from '../../src/agents/orchestrator/phased-orchestrator.js';
import type { PathTarget } from '../../src/domain/work-target.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

describe('PhasedOrchestrator Priority Files in Work Items', () => {
  describe('createExplorationWorkItem helper', () => {
    it('should include priorityFiles from lowCoverageFiles for the target directory', () => {
      const lowCoverageFiles = [
        { path: 'src/agents/base.ts', coverage: 0, directory: 'src/agents' },
        { path: 'src/agents/orchestrator.ts', coverage: 25, directory: 'src/agents' },
        { path: 'src/agents/registry.ts', coverage: 0, directory: 'src/agents' },
        { path: 'src/services/llm.ts', coverage: 0, directory: 'src/services' }, // Different dir
      ];

      const workItem = createExplorationWorkItem(
        'src/agents',
        'test-repo',
        lowCoverageFiles
      );

      assert.ok(workItem, 'Should create work item');
      assert.strictEqual(workItem.agentType, 'codebase-explorer');

      const target = workItem.target as PathTarget;
      assert.strictEqual(target.type, 'path');
      assert.strictEqual(target.path, 'src/agents');
      assert.ok(target.priorityFiles, 'Should have priorityFiles');
      assert.ok(target.priorityFiles.length > 0, 'priorityFiles should not be empty');

      // Should only include files from src/agents
      assert.ok(
        target.priorityFiles.every((f: string) => f.startsWith('src/agents/')),
        `All priorityFiles should be in src/agents. Got: ${target.priorityFiles.join(', ')}`
      );

      // Should NOT include files from src/services
      assert.ok(
        !target.priorityFiles.includes('src/services/llm.ts'),
        'Should not include files from other directories'
      );
    });

    it('should handle directory with no low-coverage files gracefully', () => {
      const lowCoverageFiles = [
        { path: 'src/services/llm.ts', coverage: 0, directory: 'src/services' },
      ];

      const workItem = createExplorationWorkItem(
        'src/agents', // No files in lowCoverageFiles for this dir
        'test-repo',
        lowCoverageFiles
      );

      const target = workItem.target as PathTarget;

      // priorityFiles should be undefined or empty
      assert.ok(
        !target.priorityFiles || target.priorityFiles.length === 0,
        'Should have no priorityFiles for directory without low-coverage files'
      );
    });

    it('should cap priorityFiles to MAX_PRIORITY_FILES', () => {
      // Create 30 low-coverage files in one directory
      const lowCoverageFiles = Array.from({ length: 30 }, (_, i) => ({
        path: `src/large/file${i}.ts`,
        coverage: 0,
        directory: 'src/large',
      }));

      const workItem = createExplorationWorkItem(
        'src/large',
        'test-repo',
        lowCoverageFiles
      );

      const target = workItem.target as PathTarget;

      assert.ok(target.priorityFiles, 'Should have priorityFiles');
      assert.ok(
        target.priorityFiles.length <= MAX_PRIORITY_FILES,
        `Should cap priorityFiles to ${MAX_PRIORITY_FILES}. Got ${target.priorityFiles.length}`
      );
    });
  });
});
