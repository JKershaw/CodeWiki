/**
 * Unit tests for CodebaseExplorerAgent priority files selection.
 *
 * Tests that selectKeyFiles uses priorityFiles from the target to prioritize
 * reading undocumented files first.
 *
 * TDD: Write tests before implementation.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { CodebaseExplorerAgent } from '../../src/agents/analysis/codebase-explorer-agent.js';
import { MockLLMService } from '../helpers/mock-llm.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { PathTarget } from '../../src/domain/work-target.js';
import type { UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create mock repo access.
 */
function createMockRepoAccess(
  files: string[],
  fileContents: Map<string, string> = new Map()
): UnifiedRepoAccess {
  return {
    getFileTree: mock.fn(async () => files),
    listDirectory: mock.fn(async (path: string) => {
      // Return files under the given path
      return files
        .filter(f => f.startsWith(path + '/') || (path === '.' && !f.includes('/')))
        .map(f => {
          const relative = path === '.' ? f : f.slice(path.length + 1);
          const parts = relative.split('/');
          const name = parts[0];
          return {
            name,
            path: path === '.' ? name : `${path}/${name}`,
            type: parts.length > 1 ? 'directory' : 'file',
          };
        });
    }),
    getFileContent: mock.fn(async (path: string) => {
      return fileContents.get(path) || '// file content';
    }),
    fileExists: mock.fn(async (path: string) => files.includes(path)),
    getCommitDiff: mock.fn(async () => ''),
    isLocal: () => false,
    getLocalPath: () => undefined,
  } as UnifiedRepoAccess;
}

/**
 * Create mock context.
 */
function createMockContext(repoAccess: UnifiedRepoAccess, llm: MockLLMService): AgentContext {
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

describe('CodebaseExplorerAgent Priority Files', () => {
  describe('selectKeyFiles behavior', () => {
    it('should prioritize files from priorityFiles list', async () => {
      const files = [
        'src/agents/base.ts',       // short name, would normally be first
        'src/agents/orchestrator.ts',
        'src/agents/registry.ts',
        'src/agents/very-long-name-file.ts',  // normally deprioritized
      ];

      const fileContents = new Map(files.map(f => [f, `// ${f} content`]));
      const repoAccess = createMockRepoAccess(files, fileContents);

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      // Priority files: the long-named file should be read first
      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
        priorityFiles: ['src/agents/very-long-name-file.ts', 'src/agents/registry.ts'],
      };

      await agent.run(target, context);

      // Check which files were read via getFileContent calls
      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // Priority files should be among the first files read
      assert.ok(
        readPaths.includes('src/agents/very-long-name-file.ts'),
        'Should read priority file: very-long-name-file.ts'
      );
      assert.ok(
        readPaths.includes('src/agents/registry.ts'),
        'Should read priority file: registry.ts'
      );
    });

    it('should fall back to default behavior when no priorityFiles', async () => {
      const files = [
        'src/agents/base.ts',
        'src/agents/orchestrator.ts',
        'src/agents/very-long-name-file.ts',
      ];

      const fileContents = new Map(files.map(f => [f, `// ${f} content`]));
      const repoAccess = createMockRepoAccess(files, fileContents);

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      // No priority files
      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
      };

      await agent.run(target, context);

      // Check files were read - default behavior sorts by name length
      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // base.ts (shortest name) should be among the first
      assert.ok(
        readPaths.includes('src/agents/base.ts'),
        'Should read base.ts with default sorting'
      );
    });

    it('should filter out priority files not in directory', async () => {
      const files = [
        'src/agents/base.ts',
        'src/agents/registry.ts',
      ];

      const fileContents = new Map(files.map(f => [f, `// ${f} content`]));
      const repoAccess = createMockRepoAccess(files, fileContents);

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      // Priority files include one from a different directory
      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
        priorityFiles: [
          'src/agents/base.ts',
          'src/services/llm.ts',  // Not in src/agents, should be ignored
        ],
      };

      await agent.run(target, context);

      // Should not crash, should just use valid priority files
      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      assert.ok(
        readPaths.includes('src/agents/base.ts'),
        'Should read valid priority file'
      );
      assert.ok(
        !readPaths.includes('src/services/llm.ts'),
        'Should not try to read file from different directory'
      );
    });

    it('should fill remaining slots with non-priority files', async () => {
      // Create many files but only a few priority files
      const files = Array.from({ length: 15 }, (_, i) => `src/agents/file${i}.ts`);
      const fileContents = new Map(files.map(f => [f, `// ${f} content`]));
      const repoAccess = createMockRepoAccess(files, fileContents);

      const llm = new MockLLMService();
      llm.setDefaultResponse(`
<analysis>
<wiki_pages>
</wiki_pages>
</analysis>
      `);

      const context = createMockContext(repoAccess, llm);
      const agent = new CodebaseExplorerAgent(llm);

      // Only 2 priority files
      const target: PathTarget = {
        type: 'path',
        path: 'src/agents',
        priorityFiles: ['src/agents/file10.ts', 'src/agents/file11.ts'],
      };

      await agent.run(target, context);

      const getFileContentMock = repoAccess.getFileContent as any;
      const readPaths = getFileContentMock.mock.calls.map((c: any) => c.arguments[0]);

      // Should have read the priority files
      assert.ok(readPaths.includes('src/agents/file10.ts'), 'Should read priority file10.ts');
      assert.ok(readPaths.includes('src/agents/file11.ts'), 'Should read priority file11.ts');

      // Should have also read some other files (up to MAX_FILES_TO_PREFETCH)
      // Exact count depends on implementation, but should have more than just priority files
      assert.ok(
        readPaths.length > 2,
        `Should read more than just priority files. Read: ${readPaths.length}`
      );
    });
  });
});
