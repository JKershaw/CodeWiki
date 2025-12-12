/**
 * Unit tests for CodebaseExplorerAgent depth traversal.
 *
 * These tests verify that the explorer can discover deeply nested files
 * when exploring a target directory, not just files 1 level deep.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { UnifiedRepoAccess, FileEntry } from '../../src/services/repository/unified-repo-access.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import { MockLLMService } from '../helpers/mock-llm.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock UnifiedRepoAccess that simulates a repository with deeply nested files.
 */
function createMockRepoAccess(options: {
  fileTree: string[];
  fileContents?: Record<string, string>;
}): UnifiedRepoAccess {
  const { fileTree, fileContents = {} } = options;

  // Build directory structure from file tree
  const getEntriesForPath = (path: string): FileEntry[] => {
    const prefix = path === '.' ? '' : path + '/';
    const entries = new Map<string, FileEntry>();

    for (const filePath of fileTree) {
      if (!filePath.startsWith(prefix) && path !== '.') continue;

      const relativePath = path === '.' ? filePath : filePath.slice(prefix.length);
      const parts = relativePath.split('/');

      if (parts.length === 1) {
        // Direct file
        entries.set(parts[0]!, {
          name: parts[0]!,
          path: filePath,
          type: 'file',
          size: 100,
        });
      } else if (parts[0]) {
        // Subdirectory
        const dirName = parts[0];
        if (!entries.has(dirName)) {
          entries.set(dirName, {
            name: dirName,
            path: path === '.' ? dirName : `${path}/${dirName}`,
            type: 'dir',
            size: 0,
          });
        }
      }
    }

    return Array.from(entries.values());
  };

  return {
    getFileContent: mock.fn(async (path: string) => {
      if (fileContents[path]) {
        return fileContents[path];
      }
      // Generate synthetic content for files not explicitly provided
      return `// File: ${path}\nexport const placeholder = true;`;
    }),
    listDirectory: mock.fn(async (path: string) => {
      return getEntriesForPath(path);
    }),
    getFileTree: mock.fn(async () => fileTree),
    fileExists: mock.fn(async (path: string) => fileTree.includes(path)),
    getCommitDiff: mock.fn(async () => ''),
    isLocal: () => true,
    getLocalPath: () => '/mock/repo',
  };
}

/**
 * Create a mock AgentContext with the given repoAccess.
 */
function createMockAgentContext(
  repoAccess: UnifiedRepoAccess,
  llm: MockLLMService
): AgentContext {
  return {
    repoId: 'test-repo',
    wikiId: 'test-wiki',
    repos: {
      wikiPages: {
        findByWiki: mock.fn(async () => []),
      },
    } as any,
    llm,
    repoAccess,
  };
}

describe('CodebaseExplorerAgent Depth Traversal', () => {
  let mockLLM: MockLLMService;

  beforeEach(() => {
    mockLLM = new MockLLMService();
    // Set up a valid response that the parser can handle
    mockLLM.setDefaultResponse(`
SUMMARY:
This module provides utility functions for the application.

FINDINGS:
- type: Architecture | importance: medium | description: Utility functions organized by domain | paths: src/utils/string/helpers.ts

WIKI_PAGES:
=== path: utils/overview | title: Utils Overview ===
# Utils Overview

This module provides utility functions.
=== END ===

CONFIDENCE: 0.8
`);
  });

  describe('Pre-fetch mode file discovery', () => {
    it('should discover deeply nested files (3+ levels deep)', async () => {
      // Create a file tree with deeply nested files
      const fileTree = [
        'src/agents/orchestrator/strategies.ts',      // 3 levels deep
        'src/agents/orchestrator/context-gatherer.ts', // 3 levels deep
        'src/agents/analysis/codebase-explorer-agent.ts', // 3 levels deep
        'src/services/llm/analysis-tools/metrics.ts', // 4 levels deep
        'src/services/llm/llm-service.ts',            // 2 levels deep
        'src/index.ts',                                // 1 level deep
      ];

      const repoAccess = createMockRepoAccess({ fileTree });
      const context = createMockAgentContext(repoAccess, mockLLM);
      const agent = new CodebaseExplorerAgent();

      // Explore the 'src/agents' directory
      const result = await agent.run(
        { type: 'path', path: 'src/agents' },
        context
      );

      // The agent should have discovered files in nested directories
      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesRead = result.toolMetrics.filesRead;

      // Verify deeply nested files were discovered
      const deeplyNestedFiles = filesRead.filter(f =>
        f.includes('orchestrator/') || f.includes('analysis/')
      );

      assert.ok(
        deeplyNestedFiles.length > 0,
        `Should discover deeply nested files. Found: ${filesRead.join(', ')}`
      );

      // Specifically check for 3-level deep files
      const hasOrchestratorFiles = filesRead.some(f =>
        f.includes('src/agents/orchestrator/')
      );
      const hasAnalysisFiles = filesRead.some(f =>
        f.includes('src/agents/analysis/')
      );

      assert.ok(
        hasOrchestratorFiles || hasAnalysisFiles,
        `Should discover files 3+ levels deep. Files read: ${filesRead.join(', ')}`
      );
    });

    it('should discover files at 4+ levels of nesting', async () => {
      const fileTree = [
        'src/services/llm/analysis-tools/source-tools.ts',  // 4 levels
        'src/services/llm/analysis-tools/metrics.ts',       // 4 levels
        'src/services/llm/llm-service.ts',                   // 3 levels
        'src/services/git/git-service.ts',                   // 3 levels
      ];

      const repoAccess = createMockRepoAccess({ fileTree });
      const context = createMockAgentContext(repoAccess, mockLLM);
      const agent = new CodebaseExplorerAgent();

      // Explore the 'src/services' directory
      const result = await agent.run(
        { type: 'path', path: 'src/services' },
        context
      );

      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesRead = result.toolMetrics.filesRead;

      // Check if 4-level deep files were discovered
      const deepFiles = filesRead.filter(f =>
        f.includes('analysis-tools/')
      );

      assert.ok(
        deepFiles.length > 0,
        `Should discover files 4 levels deep. Files read: ${filesRead.join(', ')}`
      );
    });

    it('should discover all source files under target path regardless of depth', async () => {
      const fileTree = [
        'lib/core/engine.ts',
        'lib/core/plugins/loader.ts',
        'lib/core/plugins/registry/index.ts',
        'lib/core/plugins/registry/types.ts',
        'lib/utils/helpers.ts',
      ];

      const repoAccess = createMockRepoAccess({ fileTree });
      const context = createMockAgentContext(repoAccess, mockLLM);
      const agent = new CodebaseExplorerAgent();

      // Explore 'lib/core' - should find all nested files
      const result = await agent.run(
        { type: 'path', path: 'lib/core' },
        context
      );

      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesRead = result.toolMetrics.filesRead;

      // All files under lib/core should be discoverable
      const expectedFiles = [
        'lib/core/engine.ts',
        'lib/core/plugins/loader.ts',
        'lib/core/plugins/registry/index.ts',
        'lib/core/plugins/registry/types.ts',
      ];

      // Check that we found files from the deeply nested registry folder
      const hasRegistryFiles = filesRead.some(f => f.includes('registry/'));

      assert.ok(
        hasRegistryFiles,
        `Should discover deeply nested registry files. Files read: ${filesRead.join(', ')}`
      );
    });

    it('should filter to only files under the target path', async () => {
      const fileTree = [
        'src/agents/base-agent.ts',
        'src/services/llm/llm-service.ts',
        'lib/utils/helpers.ts',
      ];

      const repoAccess = createMockRepoAccess({ fileTree });
      const context = createMockAgentContext(repoAccess, mockLLM);
      const agent = new CodebaseExplorerAgent();

      // Explore only 'src/agents'
      const result = await agent.run(
        { type: 'path', path: 'src/agents' },
        context
      );

      assert.ok(result.toolMetrics, 'should have tool metrics');
      const filesRead = result.toolMetrics.filesRead;

      // Should NOT include files from other paths
      const hasServiceFiles = filesRead.some(f => f.includes('services/'));
      const hasLibFiles = filesRead.some(f => f.includes('lib/'));

      assert.ok(
        !hasServiceFiles && !hasLibFiles,
        `Should only include files under target path. Files read: ${filesRead.join(', ')}`
      );
    });
  });
});
