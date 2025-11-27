/**
 * Unit tests for cwignore pattern parsing.
 * Tests pure functions - no mocking needed.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseIgnorePatterns,
  loadIgnorePatterns,
  clearIgnoreCache,
  DEFAULT_IGNORE_PATTERNS,
} from '../../src/services/cwignore.js';

describe('cwignore', () => {
  describe('parseIgnorePatterns', () => {
    it('parses simple patterns', () => {
      const content = `dist
build
*.log`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['dist', 'build', '*.log']);
    });

    it('ignores empty lines', () => {
      const content = `dist

build

*.log`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['dist', 'build', '*.log']);
    });

    it('ignores comment lines', () => {
      const content = `# This is a comment
dist
# Another comment
build`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['dist', 'build']);
    });

    it('trims whitespace from patterns', () => {
      const content = `  dist
   build   `;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['dist', 'build']);
    });

    it('adds /** to directory patterns ending with /', () => {
      const content = `examples/
dist/`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['examples/**', 'dist/**']);
    });

    it('skips negation patterns (not supported)', () => {
      const content = `dist
!dist/important
build`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['dist', 'build']);
    });

    it('handles glob patterns', () => {
      const content = `**/*.log
src/**/*.test.ts
coverage/**`;
      const patterns = parseIgnorePatterns(content);
      assert.deepStrictEqual(patterns, ['**/*.log', 'src/**/*.test.ts', 'coverage/**']);
    });
  });

  describe('loadIgnorePatterns', () => {
    let testDir: string;

    before(async () => {
      testDir = await mkdtemp(join(tmpdir(), 'cwignore-test-'));
    });

    beforeEach(() => {
      clearIgnoreCache();
    });

    after(async () => {
      clearIgnoreCache();
      await rm(testDir, { recursive: true });
    });

    it('returns default patterns when no .cwignore exists', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'cwignore-empty-'));
      try {
        const patterns = await loadIgnorePatterns(emptyDir);
        assert.deepStrictEqual(patterns, DEFAULT_IGNORE_PATTERNS);
      } finally {
        await rm(emptyDir, { recursive: true });
      }
    });

    it('merges .cwignore patterns with defaults', async () => {
      await writeFile(join(testDir, '.cwignore'), 'examples/\ndist/');
      const patterns = await loadIgnorePatterns(testDir);
      assert.deepStrictEqual(patterns, [
        ...DEFAULT_IGNORE_PATTERNS,
        'examples/**',
        'dist/**',
      ]);
    });

    it('caches results for subsequent calls', async () => {
      const cacheDir = await mkdtemp(join(tmpdir(), 'cwignore-cache-'));
      try {
        await writeFile(join(cacheDir, '.cwignore'), 'dist/');
        const patterns1 = await loadIgnorePatterns(cacheDir);

        // Modify the file
        await writeFile(join(cacheDir, '.cwignore'), 'different/');
        const patterns2 = await loadIgnorePatterns(cacheDir);

        // Should still return cached result
        assert.deepStrictEqual(patterns2, patterns1);
      } finally {
        clearIgnoreCache();
        await rm(cacheDir, { recursive: true });
      }
    });

    it('clears cache correctly', async () => {
      const clearDir = await mkdtemp(join(tmpdir(), 'cwignore-clear-'));
      try {
        await writeFile(join(clearDir, '.cwignore'), 'dist/');
        await loadIgnorePatterns(clearDir);

        clearIgnoreCache(clearDir);

        await writeFile(join(clearDir, '.cwignore'), 'different/');
        const patterns = await loadIgnorePatterns(clearDir);

        assert.ok(patterns.includes('different/**'));
        assert.ok(!patterns.includes('dist/**'));
      } finally {
        clearIgnoreCache();
        await rm(clearDir, { recursive: true });
      }
    });

    it('handles complex .cwignore files', async () => {
      const complexDir = await mkdtemp(join(tmpdir(), 'cwignore-complex-'));
      try {
        const cwignoreContent = `# Build outputs
dist/
build/

# Dependencies
node_modules/

# Test coverage
coverage/
*.lcov

# IDE files
.vscode/
.idea/
`;
        await writeFile(join(complexDir, '.cwignore'), cwignoreContent);
        const patterns = await loadIgnorePatterns(complexDir);

        // Should include defaults
        assert.ok(patterns.includes('node_modules/**'));
        assert.ok(patterns.includes('.git/**'));

        // Should include custom patterns
        assert.ok(patterns.includes('dist/**'));
        assert.ok(patterns.includes('build/**'));
        assert.ok(patterns.includes('coverage/**'));
        assert.ok(patterns.includes('*.lcov'));
        assert.ok(patterns.includes('.vscode/**'));
        assert.ok(patterns.includes('.idea/**'));
      } finally {
        clearIgnoreCache();
        await rm(complexDir, { recursive: true });
      }
    });
  });
});
