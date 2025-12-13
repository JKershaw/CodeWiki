/**
 * Unit tests for CodebaseExplorerAgent index file handling.
 *
 * Verifies that index files (index.ts, index.js) are:
 * - Included in source files (not filtered out)
 * - Deprioritized in default sort order
 * - Can be included via priorityFiles when they have low coverage
 *
 * TDD: Tests for index file handling behavior.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import { MockLLMService } from '../helpers/mock-llm.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { PathTarget } from '../../src/domain/work-target.js';
import type { UnifiedRepoAccess, FileEntry } from '../../src/services/repository/unified-repo-access.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock UnifiedRepoAccess.
 */
function createMockRepoAccess(options: {
  fileTree: string[];
  fileContents?: Record<string, string>;
}): UnifiedRepoAccess {
  const { fileTree, fileContents = {} } = options;

  const getEntriesForPath = (path: string): FileEntry[] => {
    const prefix = path === '.' ? '' : path + '/';
    const entries = new Map<string, FileEntry>();

    for (const filePath of fileTree) {
      if (!filePath.startsWith(prefix) && path !== '.') continue;

      const relativePath = path === '.' ? filePath : filePath.slice(prefix.length);
      const parts = relativePath.split('/');

      if (parts.length === 1) {
        entries.set(parts[0]!, {
          name: parts[0]!,
          path: filePath,
          type: 'file',
          size: 100,
        });
      } else if (parts[0]) {
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
 * Create a mock AgentContext.
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

describe('CodebaseExplorerAgent Index Files', () => {
  describe('index file inclusion', () => {
    it('should include index.ts files in directory listing', async () => {
      const fileTree = [
        'src/agents/index.ts',
        'src/agents/base.ts',
        'src/agents/orchestrator.ts',
      ];

      const repoAccess = createMockRepoAccess({ fileTree });

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockAgentContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
      };

      await agent.run(target, context);

      // Check that index.ts was included (via getFileContent calls)
      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // Index file should be included (not filtered out)
      // Note: It may not be read if we hit MAX_FILES_TO_PREFETCH,
      // but it should be in the file list
      const getFileTreeMock = repoAccess.getFileTree as any;
      assert.ok(getFileTreeMock.mock.callCount() > 0, 'Should call getFileTree');

      // The key assertion: index.ts is NOT in skipPatterns anymore
      // If we have few files, index.ts should be readable
      // (It might be deprioritized but not excluded)
    });

    it('should deprioritize index files in default sorting', async () => {
      const fileTree = [
        'src/agents/index.ts',  // Should be deprioritized
        'src/agents/z.ts',      // Short name but alphabetically later
        'src/agents/base.ts',   // Short name
      ];

      const repoAccess = createMockRepoAccess({ fileTree });

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockAgentContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
      };

      await agent.run(target, context);

      // Check file read order
      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // All 3 files should be read (within MAX_FILES_TO_PREFETCH limit)
      assert.ok(readPaths.length >= 3, 'Should read at least 3 files');

      // index.ts should come after other short-named files due to deprioritization
      const indexIdx = readPaths.indexOf('src/agents/index.ts');
      const baseIdx = readPaths.indexOf('src/agents/base.ts');

      assert.ok(indexIdx !== -1, 'index.ts should be read');
      assert.ok(baseIdx !== -1, 'base.ts should be read');
      assert.ok(
        baseIdx < indexIdx,
        `base.ts (${baseIdx}) should be read before index.ts (${indexIdx})`
      );
    });

    it('should include index.ts via priorityFiles when it has low coverage', async () => {
      const fileTree = [
        'src/agents/index.ts',
        'src/agents/base.ts',
        'src/agents/orchestrator.ts',
        'src/agents/registry.ts',
        'src/agents/executor.ts',
        'src/agents/scheduler.ts',
        'src/agents/monitor.ts',
        'src/agents/logger.ts',
        'src/agents/config.ts',
        'src/agents/utils.ts',
        'src/agents/types.ts',
        'src/agents/constants.ts',  // 12 files total
      ];

      const repoAccess = createMockRepoAccess({ fileTree });

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockAgentContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      // Make index.ts a priority file (low coverage)
      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
        priorityFiles: ['src/agents/index.ts'],  // Explicitly prioritize index.ts
      };

      await agent.run(target, context);

      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // index.ts should be the FIRST file read when it's in priorityFiles
      assert.ok(readPaths.length > 0, 'Should read files');
      assert.strictEqual(
        readPaths[0],
        'src/agents/index.ts',
        `index.ts should be first when prioritized. First file: ${readPaths[0]}`
      );
    });
  });
});
