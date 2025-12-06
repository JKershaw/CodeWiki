/**
 * Characterization tests for codebase-tools.
 *
 * These tests capture the existing behavior of the codebase tools
 * to ensure refactoring doesn't break functionality.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileTool, searchFilesTool, listDirectoryTool } from '../../src/services/llm/codebase-tools.js';
import type { ToolContext } from '../../src/services/llm/tools.js';

describe('codebase-tools', () => {
  let testDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `codebase-tools-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create test file structure
    await mkdir(join(testDir, 'src'), { recursive: true });
    await mkdir(join(testDir, 'node_modules'), { recursive: true });
    await writeFile(join(testDir, 'README.md'), '# Test Project\n\nThis is a test.');
    await writeFile(join(testDir, 'package.json'), '{"name": "test"}');
    await writeFile(join(testDir, 'src', 'index.ts'), 'export const main = () => console.log("hello");');
    await writeFile(join(testDir, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;');
    await writeFile(join(testDir, 'node_modules', 'dep.js'), 'module.exports = {};');

    // Create .cwignore file
    await writeFile(join(testDir, '.cwignore'), 'node_modules/**\n');

    context = {
      repoPath: testDir,
    };
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readFileTool', () => {
    it('has correct metadata', () => {
      assert.strictEqual(readFileTool.name, 'read_file');
      assert.ok(readFileTool.description.includes('Read'));
      assert.deepStrictEqual(readFileTool.inputSchema.required, ['path']);
      assert.ok('path' in readFileTool.inputSchema.properties);
    });

    it('reads file contents within repo boundary', async () => {
      const result = await readFileTool.execute({ path: 'README.md' }, context);
      assert.strictEqual(result, '# Test Project\n\nThis is a test.');
    });

    it('reads file in subdirectory', async () => {
      const result = await readFileTool.execute({ path: 'src/index.ts' }, context);
      assert.strictEqual(result, 'export const main = () => console.log("hello");');
    });

    it('returns error string for files outside repo', async () => {
      const result = await readFileTool.execute({ path: '../outside.txt' }, context);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('outside repository'));
    });

    it('returns error string for non-existent files', async () => {
      const result = await readFileTool.execute({ path: 'nonexistent.txt' }, context);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('nonexistent.txt'));
      assert.ok(result.includes('not found'));
    });

    it('returns error string for files exceeding size limit', async () => {
      // Create a file larger than the limit
      const largeContent = 'x'.repeat(150_000);
      await writeFile(join(testDir, 'large.txt'), largeContent);

      const result = await readFileTool.execute({ path: 'large.txt' }, context);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('too large'));
    });

    it('uses context.maxFileSize when provided', async () => {
      // Create a file that's under default limit but over custom limit
      const content = 'x'.repeat(500);
      await writeFile(join(testDir, 'medium.txt'), content);

      const customContext: ToolContext = {
        ...context,
        maxFileSize: 100, // Very small limit
      };

      const result = await readFileTool.execute({ path: 'medium.txt' }, customContext);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('too large'));
    });

    it('reads file when size is under custom limit', async () => {
      const content = 'small content';
      await writeFile(join(testDir, 'small.txt'), content);

      const customContext: ToolContext = {
        ...context,
        maxFileSize: 1000,
      };

      const result = await readFileTool.execute({ path: 'small.txt' }, customContext);
      assert.strictEqual(result, content);
    });
  });

  describe('searchFilesTool', () => {
    it('has correct metadata', () => {
      assert.strictEqual(searchFilesTool.name, 'search_files');
      assert.ok(searchFilesTool.description.includes('glob'));
      assert.deepStrictEqual(searchFilesTool.inputSchema.required, ['pattern']);
      assert.ok('pattern' in searchFilesTool.inputSchema.properties);
    });

    it('finds files matching glob pattern', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.ts' }, context);
      assert.ok(result.includes('src/index.ts'));
      assert.ok(result.includes('src/utils.ts'));
    });

    it('finds files with specific extension', async () => {
      const result = await searchFilesTool.execute({ pattern: '*.md' }, context);
      assert.ok(result.includes('README.md'));
      assert.ok(!result.includes('.ts'));
    });

    it('returns "No files found" for no matches', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.xyz' }, context);
      assert.strictEqual(result, 'No files found matching "**/*.xyz"');
    });

    it('respects .cwignore patterns', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.js' }, context);
      // node_modules should be ignored
      assert.ok(!result.includes('node_modules'));
      assert.ok(!result.includes('dep.js'));
    });

    it('returns newline-separated file paths', async () => {
      const result = await searchFilesTool.execute({ pattern: 'src/*.ts' }, context);
      const files = result.split('\n');
      assert.ok(files.length >= 2);
    });
  });

  describe('listDirectoryTool', () => {
    it('has correct metadata', () => {
      assert.strictEqual(listDirectoryTool.name, 'list_directory');
      assert.ok(listDirectoryTool.description.includes('directory'));
      assert.deepStrictEqual(listDirectoryTool.inputSchema.required, ['path']);
      assert.ok('path' in listDirectoryTool.inputSchema.properties);
    });

    it('lists directory contents', async () => {
      const result = await listDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('README.md'));
      assert.ok(result.includes('package.json'));
      assert.ok(result.includes('src/'));
    });

    it('adds / suffix for directories', async () => {
      const result = await listDirectoryTool.execute({ path: '.' }, context);
      assert.ok(result.includes('src/'));
    });

    it('lists subdirectory contents', async () => {
      const result = await listDirectoryTool.execute({ path: 'src' }, context);
      assert.ok(result.includes('index.ts'));
      assert.ok(result.includes('utils.ts'));
    });

    it('filters out ignored entries', async () => {
      const result = await listDirectoryTool.execute({ path: '.' }, context);
      // node_modules should be filtered out
      assert.ok(!result.includes('node_modules'));
    });

    it('returns error for paths outside repo', async () => {
      const result = await listDirectoryTool.execute({ path: '../' }, context);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('outside repository'));
    });

    it('returns error for non-existent directories', async () => {
      const result = await listDirectoryTool.execute({ path: 'nonexistent' }, context);
      assert.ok(result.startsWith('Error'));
      assert.ok(result.includes('nonexistent'));
      assert.ok(result.includes('not found'));
    });
  });

  describe('codebaseTools array', async () => {
    const { codebaseTools } = await import('../../src/services/llm/codebase-tools.js');

    it('contains all three tools', () => {
      assert.strictEqual(codebaseTools.length, 3);
      const names = codebaseTools.map(t => t.name);
      assert.ok(names.includes('read_file'));
      assert.ok(names.includes('search_files'));
      assert.ok(names.includes('list_directory'));
    });
  });
});
