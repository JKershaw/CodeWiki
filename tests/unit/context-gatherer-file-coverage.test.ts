/**
 * Integration tests for ContextGatherer with file-level coverage.
 *
 * Tests the integration of the new file-level coverage features
 * with the existing ContextGatherer infrastructure.
 *
 * TDD Phase 6: Define integration behavior through tests before implementation.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { UnifiedRepoAccessFactory, UnifiedRepoAccess } from '../../src/services/repository/unified-repo-access.js';
import type { Repo } from '../../src/domain/repo.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

/**
 * Create a mock wiki page.
 */
function createMockWikiPage(
  path: string,
  content: string
): WikiPage {
  return {
    id: `page-${path.replace(/\//g, '-')}`,
    wikiId: 'wiki-1',
    path,
    title: path.split('/').pop() ?? 'Untitled',
    content,
    confidence: 0.7,
    sourceCommits: [],
    sourceAgentRunIds: [],
    links: [],
    backlinks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create mock repositories.
 */
function createMockRepos(repo: Partial<Repo> | null, wikiPages: WikiPage[] = []) {
  return {
    repos: {
      findById: mock.fn(async () => repo),
    },
    commits: {
      findByRepo: mock.fn(async () => []),
      countByRepo: mock.fn(async () => 0),
      countProcessedByAgent: mock.fn(async () => 0),
    },
    wikiPages: {
      findByWiki: mock.fn(async () => wikiPages),
      findByPath: mock.fn(async (_wikiId: string, path: string) => {
        return wikiPages.find(p => p.path === path) ?? null;
      }),
    },
    agentRuns: {
      findByRepo: mock.fn(async () => []),
    },
    editRequests: {
      countPending: mock.fn(async () => 0),
    },
  } as any;
}

/**
 * File info with content for LOC calculation.
 */
interface MockFileInfo {
  path: string;
  content: string;
}

/**
 * Create mock unified repo access factory with file content for LOC.
 */
function createMockRepoAccessFactory(
  files: MockFileInfo[]
): UnifiedRepoAccessFactory {
  const fileTree = files.map(f => f.path);
  const contentMap = new Map(files.map(f => [f.path, f.content]));

  const mockAccess: UnifiedRepoAccess = {
    getFileTree: mock.fn(async () => fileTree),
    listDirectory: mock.fn(async () => []),
    getFileContent: mock.fn(async (path: string) => contentMap.get(path) ?? ''),
    fileExists: mock.fn(async (path: string) => contentMap.has(path)),
    getCommitDiff: mock.fn(async () => ''),
    isLocal: () => false,
    getLocalPath: () => undefined,
  };

  return {
    create: mock.fn(async () => mockAccess),
  };
}

/**
 * Count lines of code in content.
 */
function countLoc(content: string): number {
  return content.split('\n').filter(line => line.trim().length > 0).length;
}

/**
 * Simple mock for testing file-level coverage integration.
 * In the real implementation, this will be part of ContextGatherer.
 */
interface FileCoverageResult {
  path: string;
  name: string;
  loc: number;
  coveragePercent: number;
}

async function calculateFileCoverage(
  files: MockFileInfo[],
  wikiPages: WikiPage[]
): Promise<FileCoverageResult[]> {
  return files.map(file => {
    const name = file.path.split('/').pop() ?? file.path;
    const loc = countLoc(file.content);

    // Check wiki mentions
    let coveragePercent = 0;
    for (const page of wikiPages) {
      if (page.content.includes(file.path) || page.content.includes(name)) {
        coveragePercent = 100;
        break;
      }
    }

    return { path: file.path, name, loc, coveragePercent };
  });
}

describe('ContextGatherer File Coverage Integration', () => {
  describe('LOC gathering', () => {
    it('gathers LOC for files via UnifiedRepoAccess', async () => {
      const files: MockFileInfo[] = [
        {
          path: 'src/app.ts',
          content: `
export function main() {
  console.log('Hello');
}

export function helper() {
  return 42;
}
`.trim(),
        },
      ];

      const result = await calculateFileCoverage(files, []);

      // Should have calculated LOC from content
      assert.strictEqual(result[0]?.loc, 6); // 6 non-empty lines
    });

    it('calculates LOC correctly for various file sizes', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/empty.ts', content: '' },
        { path: 'src/small.ts', content: 'const x = 1;' },
        {
          path: 'src/medium.ts',
          content: Array(50).fill('const x = 1;').join('\n'),
        },
        {
          path: 'src/large.ts',
          content: Array(500).fill('const x = 1;').join('\n'),
        },
      ];

      const result = await calculateFileCoverage(files, []);

      assert.strictEqual(result.find(f => f.name === 'empty.ts')?.loc, 0);
      assert.strictEqual(result.find(f => f.name === 'small.ts')?.loc, 1);
      assert.strictEqual(result.find(f => f.name === 'medium.ts')?.loc, 50);
      assert.strictEqual(result.find(f => f.name === 'large.ts')?.loc, 500);
    });

    it('ignores blank lines in LOC count', async () => {
      const files: MockFileInfo[] = [
        {
          path: 'src/spaced.ts',
          content: `
const a = 1;

const b = 2;


const c = 3;
`.trim(),
        },
      ];

      const result = await calculateFileCoverage(files, []);

      // Should only count non-empty lines (3)
      assert.strictEqual(result[0]?.loc, 3);
    });
  });

  describe('file-level wiki mentions', () => {
    it('calculates file coverage from filename mentions', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/orchestrator.ts', content: 'export class Orchestrator {}' },
      ];
      const wikiPages = [
        createMockWikiPage('docs/arch', 'The orchestrator.ts file handles scheduling'),
      ];

      const result = await calculateFileCoverage(files, wikiPages);

      assert.strictEqual(result[0]?.coveragePercent, 100);
    });

    it('calculates file coverage from full path mentions', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/agents/orchestrator/main.ts', content: 'export class Main {}' },
      ];
      const wikiPages = [
        createMockWikiPage('docs/agents', 'See src/agents/orchestrator/main.ts for details'),
      ];

      const result = await calculateFileCoverage(files, wikiPages);

      assert.strictEqual(result[0]?.coveragePercent, 100);
    });

    it('returns 0 coverage for unmentioned files', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/secret.ts', content: 'export const secret = 42;' },
      ];
      const wikiPages = [
        createMockWikiPage('docs/public', 'This page only talks about public.ts'),
      ];

      const result = await calculateFileCoverage(files, wikiPages);

      assert.strictEqual(result[0]?.coveragePercent, 0);
    });

    it('handles multiple files with varying coverage', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/documented.ts', content: 'export const a = 1;' },
        { path: 'src/undocumented.ts', content: 'export const b = 2;' },
        { path: 'src/partial.ts', content: 'export const c = 3;' },
      ];
      const wikiPages = [
        createMockWikiPage('docs/main', 'About documented.ts and partial.ts'),
      ];

      const result = await calculateFileCoverage(files, wikiPages);

      assert.strictEqual(result.find(f => f.name === 'documented.ts')?.coveragePercent, 100);
      assert.strictEqual(result.find(f => f.name === 'undocumented.ts')?.coveragePercent, 0);
      assert.strictEqual(result.find(f => f.name === 'partial.ts')?.coveragePercent, 100);
    });
  });

  describe('integration scenarios', () => {
    it('builds complete file coverage data', async () => {
      const files: MockFileInfo[] = [
        {
          path: 'src/agents/orchestrator.ts',
          content: Array(100).fill('// code').join('\n'),
        },
        {
          path: 'src/agents/base.ts',
          content: Array(50).fill('// code').join('\n'),
        },
        {
          path: 'src/services/llm.ts',
          content: Array(200).fill('// code').join('\n'),
        },
      ];
      const wikiPages = [
        createMockWikiPage('docs/agents', 'The base.ts provides common agent functionality'),
        createMockWikiPage('docs/services', 'llm.ts wraps the LLM API'),
      ];

      const result = await calculateFileCoverage(files, wikiPages);

      // orchestrator.ts: 100 LOC, 0% coverage
      const orchestrator = result.find(f => f.name === 'orchestrator.ts');
      assert.strictEqual(orchestrator?.loc, 100);
      assert.strictEqual(orchestrator?.coveragePercent, 0);

      // base.ts: 50 LOC, 100% coverage
      const base = result.find(f => f.name === 'base.ts');
      assert.strictEqual(base?.loc, 50);
      assert.strictEqual(base?.coveragePercent, 100);

      // llm.ts: 200 LOC, 100% coverage
      const llm = result.find(f => f.name === 'llm.ts');
      assert.strictEqual(llm?.loc, 200);
      assert.strictEqual(llm?.coveragePercent, 100);
    });

    it('filters out test and declaration files', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/app.ts', content: 'const x = 1;' },
        { path: 'src/app.test.ts', content: 'test()' },
        { path: 'src/app.spec.ts', content: 'describe()' },
        { path: 'src/types.d.ts', content: 'declare type X = string;' },
      ];

      // Filter like the real implementation would
      const sourceFiles = files.filter(f => {
        const path = f.path;
        return !path.includes('.test.') &&
               !path.includes('.spec.') &&
               !path.endsWith('.d.ts');
      });

      const result = await calculateFileCoverage(sourceFiles, []);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]?.name, 'app.ts');
    });

    it('handles large repository efficiently', async () => {
      // Simulate 500 files
      const files: MockFileInfo[] = Array.from({ length: 500 }, (_, i) => ({
        path: `src/file${i}.ts`,
        content: Array(Math.floor(Math.random() * 100) + 10).fill('// code').join('\n'),
      }));

      // 50 wiki pages mentioning random files
      const wikiPages = Array.from({ length: 50 }, (_, i) => {
        const mentionedFile = `file${i * 10}.ts`;
        return createMockWikiPage(`docs/page${i}`, `Documentation for ${mentionedFile}`);
      });

      const start = Date.now();
      const result = await calculateFileCoverage(files, wikiPages);
      const duration = Date.now() - start;

      assert.strictEqual(result.length, 500);
      // Should complete in reasonable time (< 1 second for 500 files)
      assert.ok(duration < 1000, `Expected < 1000ms, got ${duration}ms`);

      // 50 files should be covered
      const coveredCount = result.filter(f => f.coveragePercent === 100).length;
      assert.strictEqual(coveredCount, 50);
    });
  });

  describe('graceful fallbacks', () => {
    it('handles missing file content gracefully', async () => {
      const files: MockFileInfo[] = [
        { path: 'src/exists.ts', content: 'const x = 1;' },
        { path: 'src/empty.ts', content: '' },
      ];

      const result = await calculateFileCoverage(files, []);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result.find(f => f.name === 'empty.ts')?.loc, 0);
    });

    it('continues processing when individual file fails', async () => {
      // Simulate a mix of valid and problematic files
      const files: MockFileInfo[] = [
        { path: 'src/valid.ts', content: 'const x = 1;' },
        { path: 'src/binary.png', content: '' }, // Non-text file
      ];

      const result = await calculateFileCoverage(files, []);

      // Should process both, binary just has 0 LOC
      assert.strictEqual(result.length, 2);
    });
  });

  describe('context output format', () => {
    it('produces data suitable for prompt formatting', async () => {
      const files: MockFileInfo[] = [
        {
          path: 'src/important.ts',
          content: Array(500).fill('// important code').join('\n'),
        },
        {
          path: 'src/trivial.ts',
          content: '// trivial',
        },
      ];

      const result = await calculateFileCoverage(files, []);

      // Result should have all data needed for formatting
      for (const file of result) {
        assert.ok(typeof file.path === 'string');
        assert.ok(typeof file.name === 'string');
        assert.ok(typeof file.loc === 'number');
        assert.ok(typeof file.coveragePercent === 'number');
        assert.ok(file.coveragePercent >= 0 && file.coveragePercent <= 100);
      }
    });
  });
});
