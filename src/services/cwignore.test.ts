import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseIgnorePatterns,
  loadIgnorePatterns,
  clearIgnoreCache,
  DEFAULT_IGNORE_PATTERNS,
} from './cwignore.js';

describe('cwignore', () => {
  describe('parseIgnorePatterns', () => {
    it('parses simple patterns', () => {
      const content = `dist
build
*.log`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['dist', 'build', '*.log']);
    });

    it('ignores empty lines', () => {
      const content = `dist

build

*.log`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['dist', 'build', '*.log']);
    });

    it('ignores comment lines', () => {
      const content = `# This is a comment
dist
# Another comment
build`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['dist', 'build']);
    });

    it('trims whitespace from patterns', () => {
      const content = `  dist
   build   `;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['dist', 'build']);
    });

    it('adds /** to directory patterns ending with /', () => {
      const content = `examples/
dist/`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['examples/**', 'dist/**']);
    });

    it('skips negation patterns (not supported)', () => {
      const content = `dist
!dist/important
build`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['dist', 'build']);
    });

    it('handles glob patterns', () => {
      const content = `**/*.log
src/**/*.test.ts
coverage/**`;
      const patterns = parseIgnorePatterns(content);
      expect(patterns).toEqual(['**/*.log', 'src/**/*.test.ts', 'coverage/**']);
    });
  });

  describe('loadIgnorePatterns', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), 'cwignore-test-'));
      clearIgnoreCache();
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true });
      clearIgnoreCache();
    });

    it('returns default patterns when no .cwignore exists', async () => {
      const patterns = await loadIgnorePatterns(testDir);
      expect(patterns).toEqual(DEFAULT_IGNORE_PATTERNS);
    });

    it('merges .cwignore patterns with defaults', async () => {
      await writeFile(join(testDir, '.cwignore'), 'examples/\ndist/');
      const patterns = await loadIgnorePatterns(testDir);
      expect(patterns).toEqual([
        ...DEFAULT_IGNORE_PATTERNS,
        'examples/**',
        'dist/**',
      ]);
    });

    it('caches results for subsequent calls', async () => {
      await writeFile(join(testDir, '.cwignore'), 'dist/');
      const patterns1 = await loadIgnorePatterns(testDir);

      // Modify the file
      await writeFile(join(testDir, '.cwignore'), 'different/');
      const patterns2 = await loadIgnorePatterns(testDir);

      // Should still return cached result
      expect(patterns2).toEqual(patterns1);
    });

    it('clears cache correctly', async () => {
      await writeFile(join(testDir, '.cwignore'), 'dist/');
      await loadIgnorePatterns(testDir);

      clearIgnoreCache(testDir);

      await writeFile(join(testDir, '.cwignore'), 'different/');
      const patterns = await loadIgnorePatterns(testDir);

      expect(patterns).toContain('different/**');
      expect(patterns).not.toContain('dist/**');
    });

    it('handles complex .cwignore files', async () => {
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
      await writeFile(join(testDir, '.cwignore'), cwignoreContent);
      const patterns = await loadIgnorePatterns(testDir);

      // Should include defaults
      expect(patterns).toContain('node_modules/**');
      expect(patterns).toContain('.git/**');

      // Should include custom patterns
      expect(patterns).toContain('dist/**');
      expect(patterns).toContain('build/**');
      expect(patterns).toContain('coverage/**');
      expect(patterns).toContain('*.lcov');
      expect(patterns).toContain('.vscode/**');
      expect(patterns).toContain('.idea/**');
    });
  });

  describe('clearIgnoreCache', () => {
    let testDir1: string;
    let testDir2: string;

    beforeEach(async () => {
      testDir1 = await mkdtemp(join(tmpdir(), 'cwignore-test1-'));
      testDir2 = await mkdtemp(join(tmpdir(), 'cwignore-test2-'));
      clearIgnoreCache();
    });

    afterEach(async () => {
      await rm(testDir1, { recursive: true });
      await rm(testDir2, { recursive: true });
      clearIgnoreCache();
    });

    it('clears cache for specific repo', async () => {
      await writeFile(join(testDir1, '.cwignore'), 'dist/');
      await writeFile(join(testDir2, '.cwignore'), 'build/');

      await loadIgnorePatterns(testDir1);
      await loadIgnorePatterns(testDir2);

      // Clear only testDir1
      clearIgnoreCache(testDir1);

      // Modify both files
      await writeFile(join(testDir1, '.cwignore'), 'changed1/');
      await writeFile(join(testDir2, '.cwignore'), 'changed2/');

      const patterns1 = await loadIgnorePatterns(testDir1);
      const patterns2 = await loadIgnorePatterns(testDir2);

      // testDir1 should have new patterns
      expect(patterns1).toContain('changed1/**');
      // testDir2 should still have cached patterns
      expect(patterns2).toContain('build/**');
      expect(patterns2).not.toContain('changed2/**');
    });

    it('clears all caches when no repo specified', async () => {
      await writeFile(join(testDir1, '.cwignore'), 'dist/');
      await writeFile(join(testDir2, '.cwignore'), 'build/');

      await loadIgnorePatterns(testDir1);
      await loadIgnorePatterns(testDir2);

      // Clear all
      clearIgnoreCache();

      // Modify both files
      await writeFile(join(testDir1, '.cwignore'), 'changed1/');
      await writeFile(join(testDir2, '.cwignore'), 'changed2/');

      const patterns1 = await loadIgnorePatterns(testDir1);
      const patterns2 = await loadIgnorePatterns(testDir2);

      // Both should have new patterns
      expect(patterns1).toContain('changed1/**');
      expect(patterns2).toContain('changed2/**');
    });
  });
});
