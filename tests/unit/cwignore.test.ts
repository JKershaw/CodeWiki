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
  createIgnoreFilter,
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
        // Use patterns that aren't in defaults
        await writeFile(join(clearDir, '.cwignore'), 'custom-pattern/');
        await loadIgnorePatterns(clearDir);

        clearIgnoreCache(clearDir);

        await writeFile(join(clearDir, '.cwignore'), 'different/');
        const patterns = await loadIgnorePatterns(clearDir);

        assert.ok(patterns.includes('different/**'));
        assert.ok(!patterns.includes('custom-pattern/**'));
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

    it('loads .gitignore patterns', async () => {
      const gitignoreDir = await mkdtemp(join(tmpdir(), 'cwignore-gitignore-'));
      try {
        await writeFile(join(gitignoreDir, '.gitignore'), '*.pyc\n__pycache__/\n.env');
        const patterns = await loadIgnorePatterns(gitignoreDir);

        // Should include defaults
        assert.ok(patterns.includes('node_modules/**'));

        // Should include .gitignore patterns
        assert.ok(patterns.includes('*.pyc'));
        assert.ok(patterns.includes('__pycache__/**'));
        assert.ok(patterns.includes('.env'));
      } finally {
        clearIgnoreCache();
        await rm(gitignoreDir, { recursive: true });
      }
    });

    it('merges .gitignore and .cwignore patterns (layered approach)', async () => {
      const layeredDir = await mkdtemp(join(tmpdir(), 'cwignore-layered-'));
      try {
        // Create .gitignore
        await writeFile(join(layeredDir, '.gitignore'), '*.pyc\n__pycache__/');
        // Create .cwignore with additional patterns
        await writeFile(join(layeredDir, '.cwignore'), 'docs/generated/\n*.tmp');

        const patterns = await loadIgnorePatterns(layeredDir);

        // Should include defaults
        assert.ok(patterns.includes('node_modules/**'));
        assert.ok(patterns.includes('.git/**'));

        // Should include .gitignore patterns
        assert.ok(patterns.includes('*.pyc'));
        assert.ok(patterns.includes('__pycache__/**'));

        // Should include .cwignore patterns
        assert.ok(patterns.includes('docs/generated/**'));
        assert.ok(patterns.includes('*.tmp'));
      } finally {
        clearIgnoreCache();
        await rm(layeredDir, { recursive: true });
      }
    });
  });

  describe('createIgnoreFilter', () => {
    it('creates an ignore filter with default patterns', async () => {
      const filterDir = await mkdtemp(join(tmpdir(), 'cwignore-filter-'));
      try {
        const filter = await createIgnoreFilter(filterDir);

        // Should ignore default patterns
        assert.ok(filter.ignores('node_modules/package/index.js'));
        assert.ok(filter.ignores('.git/config'));
        assert.ok(filter.ignores('dist/bundle.js'));
        assert.ok(filter.ignores('coverage/lcov.info'));

        // Should not ignore regular source files
        assert.ok(!filter.ignores('src/index.ts'));
        assert.ok(!filter.ignores('README.md'));
      } finally {
        clearIgnoreCache();
        await rm(filterDir, { recursive: true });
      }
    });

    it('supports negation patterns in .cwignore', async () => {
      const negationDir = await mkdtemp(join(tmpdir(), 'cwignore-negation-'));
      try {
        // First ignore all logs, but allow important.log
        await writeFile(join(negationDir, '.cwignore'), '*.log\n!important.log');

        const filter = await createIgnoreFilter(negationDir);

        // Regular logs should be ignored
        assert.ok(filter.ignores('debug.log'));
        assert.ok(filter.ignores('error.log'));

        // important.log should NOT be ignored (negation pattern)
        assert.ok(!filter.ignores('important.log'));
      } finally {
        clearIgnoreCache();
        await rm(negationDir, { recursive: true });
      }
    });

    it('allows .cwignore to override .gitignore with negation', async () => {
      const overrideDir = await mkdtemp(join(tmpdir(), 'cwignore-override-'));
      try {
        // .gitignore ignores all .env files
        await writeFile(join(overrideDir, '.gitignore'), '.env*');
        // .cwignore un-ignores .env.example for documentation
        await writeFile(join(overrideDir, '.cwignore'), '!.env.example');

        const filter = await createIgnoreFilter(overrideDir);

        // .env files should be ignored
        assert.ok(filter.ignores('.env'));
        assert.ok(filter.ignores('.env.local'));
        assert.ok(filter.ignores('.env.production'));

        // .env.example should NOT be ignored (overridden by .cwignore)
        assert.ok(!filter.ignores('.env.example'));
      } finally {
        clearIgnoreCache();
        await rm(overrideDir, { recursive: true });
      }
    });

    it('caches ignore filter instances', async () => {
      const cacheDir = await mkdtemp(join(tmpdir(), 'cwignore-filtercache-'));
      try {
        await writeFile(join(cacheDir, '.cwignore'), '*.tmp');
        const filter1 = await createIgnoreFilter(cacheDir);
        const filter2 = await createIgnoreFilter(cacheDir);

        // Should return the same cached instance
        assert.strictEqual(filter1, filter2);
      } finally {
        clearIgnoreCache();
        await rm(cacheDir, { recursive: true });
      }
    });
  });

  describe('DEFAULT_IGNORE_PATTERNS', () => {
    it('includes essential patterns', () => {
      // Version control
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('.git/**'));

      // Dependencies
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('node_modules/**'));

      // Build outputs
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('dist/**'));
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('build/**'));
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('out/**'));

      // Test coverage
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('coverage/**'));

      // Environment files
      assert.ok(DEFAULT_IGNORE_PATTERNS.includes('.env*'));
    });
  });
});
