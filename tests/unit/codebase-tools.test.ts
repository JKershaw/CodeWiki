import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileTool, searchFilesTool, listDirectoryTool } from '../../src/services/llm/codebase-tools.js';
import type { ToolContext } from '../../src/services/llm/tools.js';
import { clearIgnoreCache } from '../../src/services/cwignore.js';

describe('codebase-tools', () => {
  let testDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    // Create a temporary directory with test files
    testDir = await mkdtemp(join(tmpdir(), 'codewiki-test-'));
    context = { repoPath: testDir };

    // Create test file structure
    await writeFile(join(testDir, 'README.md'), '# Test Project\n\nThis is a test project.');
    await writeFile(join(testDir, 'package.json'), '{"name": "test", "version": "1.0.0"}');
    await mkdir(join(testDir, 'src'));
    await writeFile(join(testDir, 'src', 'index.ts'), 'export const main = () => "hello";');
    await writeFile(join(testDir, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
    clearIgnoreCache();
  });

  describe('readFileTool', () => {
    it('reads a file at the root', async () => {
      const result = await readFileTool.execute({ path: 'README.md' }, context);
      expect(result).toContain('# Test Project');
      expect(result).toContain('This is a test project.');
    });

    it('reads a file in a subdirectory', async () => {
      const result = await readFileTool.execute({ path: 'src/index.ts' }, context);
      expect(result).toContain('export const main');
    });

    it('returns error for non-existent file', async () => {
      const result = await readFileTool.execute({ path: 'does-not-exist.txt' }, context);
      expect(result).toContain('Error');
    });

    it('blocks path traversal attempts', async () => {
      const result = await readFileTool.execute({ path: '../../../etc/passwd' }, context);
      expect(result).toContain('Error');
      expect(result).toContain('outside repository');
    });

    it('respects maxFileSize limit', async () => {
      // Create a large file
      await writeFile(join(testDir, 'large.txt'), 'x'.repeat(10000));
      const limitedContext = { ...context, maxFileSize: 100 };
      const result = await readFileTool.execute({ path: 'large.txt' }, limitedContext);
      expect(result).toContain('too large');
    });
  });

  describe('searchFilesTool', () => {
    it('finds files matching a pattern', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.ts' }, context);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/utils.ts');
    });

    it('finds markdown files', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.md' }, context);
      expect(result).toContain('README.md');
    });

    it('returns empty message when no matches', async () => {
      const result = await searchFilesTool.execute({ pattern: '**/*.xyz' }, context);
      expect(result).toContain('No files found');
    });
  });

  describe('listDirectoryTool', () => {
    it('lists root directory contents', async () => {
      const result = await listDirectoryTool.execute({ path: '.' }, context);
      expect(result).toContain('README.md');
      expect(result).toContain('package.json');
      expect(result).toContain('src/');
    });

    it('lists subdirectory contents', async () => {
      const result = await listDirectoryTool.execute({ path: 'src' }, context);
      expect(result).toContain('index.ts');
      expect(result).toContain('utils.ts');
    });

    it('returns error for non-existent directory', async () => {
      const result = await listDirectoryTool.execute({ path: 'nonexistent' }, context);
      expect(result).toContain('Error');
    });
  });

  describe('.cwignore integration', () => {
    beforeEach(async () => {
      // Create additional directories for ignore testing
      await mkdir(join(testDir, 'examples'));
      await writeFile(join(testDir, 'examples', 'test.md'), '# Example');
      await mkdir(join(testDir, 'dist'));
      await writeFile(join(testDir, 'dist', 'bundle.js'), 'bundled code');
      clearIgnoreCache();
    });

    it('searchFilesTool ignores patterns from .cwignore', async () => {
      // Before adding .cwignore, examples should be found
      const beforeResult = await searchFilesTool.execute({ pattern: '**/*.md' }, context);
      expect(beforeResult).toContain('examples/test.md');
      expect(beforeResult).toContain('README.md');

      // Add .cwignore
      clearIgnoreCache();
      await writeFile(join(testDir, '.cwignore'), 'examples/');

      // After adding .cwignore, examples should be ignored
      const afterResult = await searchFilesTool.execute({ pattern: '**/*.md' }, context);
      expect(afterResult).not.toContain('examples/test.md');
      expect(afterResult).toContain('README.md');
    });

    it('searchFilesTool applies multiple ignore patterns', async () => {
      await writeFile(join(testDir, '.cwignore'), `examples/
dist/
*.log`);

      // Create a log file
      await writeFile(join(testDir, 'debug.log'), 'log content');

      const result = await searchFilesTool.execute({ pattern: '**/*' }, context);
      expect(result).not.toContain('examples/');
      expect(result).not.toContain('dist/');
      expect(result).not.toContain('debug.log');
      expect(result).toContain('README.md');
      expect(result).toContain('src/index.ts');
    });

    it('listDirectoryTool filters ignored directories', async () => {
      await writeFile(join(testDir, '.cwignore'), 'examples/');

      const result = await listDirectoryTool.execute({ path: '.' }, context);
      expect(result).not.toContain('examples/');
      expect(result).toContain('src/');
      expect(result).toContain('README.md');
    });

    it('listDirectoryTool filters ignored files', async () => {
      await writeFile(join(testDir, 'debug.log'), 'log content');
      await writeFile(join(testDir, '.cwignore'), '*.log');

      const result = await listDirectoryTool.execute({ path: '.' }, context);
      expect(result).not.toContain('debug.log');
      expect(result).toContain('README.md');
    });

    it('always ignores node_modules regardless of .cwignore', async () => {
      await mkdir(join(testDir, 'node_modules'));
      await writeFile(join(testDir, 'node_modules', 'package.json'), '{}');

      // No .cwignore file
      const searchResult = await searchFilesTool.execute({ pattern: '**/*.json' }, context);
      expect(searchResult).toContain('package.json');
      expect(searchResult).not.toContain('node_modules');

      const listResult = await listDirectoryTool.execute({ path: '.' }, context);
      expect(listResult).not.toContain('node_modules');
    });
  });
});
