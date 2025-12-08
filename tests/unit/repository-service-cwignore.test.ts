/**
 * Unit tests for .cwignore compliance in Local Repository Service.
 *
 * These tests verify that the repository service properly respects
 * .cwignore patterns when listing files and directories.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createRepositoryService,
  type RepositoryService,
} from '../../src/services/repository/repository-service.js';
import type { Repo } from '../../src/domain/repo.js';
import type { GitService } from '../../src/services/git/git-service.js';
import { clearIgnoreCache } from '../../src/services/cwignore.js';

describe('Local Repository Service - cwignore compliance', () => {
  let testDir: string;
  let service: RepositoryService;
  let repo: Repo;
  let mockGitService: GitService;

  before(async () => {
    // Create a temp directory structure for testing
    testDir = await mkdtemp(join(tmpdir(), 'repo-service-cwignore-'));

    // Create directory structure
    await mkdir(join(testDir, 'src'));
    await mkdir(join(testDir, 'src', 'utils'));
    await mkdir(join(testDir, 'node_modules'));
    await mkdir(join(testDir, 'node_modules', 'some-package'));
    await mkdir(join(testDir, 'dist'));
    await mkdir(join(testDir, '.git'));
    await mkdir(join(testDir, 'coverage'));
    await mkdir(join(testDir, 'docs'));

    // Create files
    await writeFile(join(testDir, 'src', 'index.ts'), 'export const x = 1;');
    await writeFile(join(testDir, 'src', 'utils', 'helper.ts'), 'export function help() {}');
    await writeFile(join(testDir, 'node_modules', 'some-package', 'index.js'), 'module.exports = {}');
    await writeFile(join(testDir, 'dist', 'bundle.js'), 'var x=1;');
    await writeFile(join(testDir, '.git', 'config'), '[core]');
    await writeFile(join(testDir, 'coverage', 'lcov.info'), 'coverage data');
    await writeFile(join(testDir, 'docs', 'README.md'), '# Docs');
    await writeFile(join(testDir, 'README.md'), '# Project');
    await writeFile(join(testDir, 'package.json'), '{}');
    await writeFile(join(testDir, '.env'), 'SECRET=value');
    await writeFile(join(testDir, '.env.local'), 'LOCAL_SECRET=value');
    await writeFile(join(testDir, 'debug.log'), 'log data');
  });

  beforeEach(() => {
    // Clear cwignore cache between tests
    clearIgnoreCache();

    // Create mock git service
    mockGitService = {
      registerLocalRepo: () => {},
      loadCommits: async () => [],
      getCommitDiff: async () => '',
    } as unknown as GitService;

    // Create the repo object
    repo = {
      id: 'test-repo',
      fullName: testDir,
      isGitHubRepo: false,
      cloneUrl: testDir,
      defaultBranch: 'main',
      status: 'ready',
      config: { throttle: { maxCallsPerMinute: 10, maxCostPerHour: 1 }, enabledAgents: [] },
      createdAt: new Date(),
      lastProcessedAt: null,
    };

    // Create the service
    service = createRepositoryService(repo, { gitService: mockGitService });
  });

  after(async () => {
    clearIgnoreCache();
    await rm(testDir, { recursive: true });
  });

  describe('getFileTree', () => {
    it('should exclude node_modules from file tree', async () => {
      const files = await service.getFileTree(repo);

      const nodeModulesFiles = files.filter(f => f.includes('node_modules'));
      assert.strictEqual(nodeModulesFiles.length, 0,
        `Expected no node_modules files, but found: ${nodeModulesFiles.join(', ')}`);
    });

    it('should exclude .git directory from file tree', async () => {
      const files = await service.getFileTree(repo);

      const gitFiles = files.filter(f => f.includes('.git'));
      assert.strictEqual(gitFiles.length, 0,
        `Expected no .git files, but found: ${gitFiles.join(', ')}`);
    });

    it('should exclude dist directory from file tree', async () => {
      const files = await service.getFileTree(repo);

      const distFiles = files.filter(f => f.startsWith('dist/'));
      assert.strictEqual(distFiles.length, 0,
        `Expected no dist files, but found: ${distFiles.join(', ')}`);
    });

    it('should exclude coverage directory from file tree', async () => {
      const files = await service.getFileTree(repo);

      const coverageFiles = files.filter(f => f.startsWith('coverage/'));
      assert.strictEqual(coverageFiles.length, 0,
        `Expected no coverage files, but found: ${coverageFiles.join(', ')}`);
    });

    it('should exclude .env files from file tree', async () => {
      const files = await service.getFileTree(repo);

      const envFiles = files.filter(f => f.startsWith('.env'));
      assert.strictEqual(envFiles.length, 0,
        `Expected no .env files, but found: ${envFiles.join(', ')}`);
    });

    it('should exclude *.log files from file tree', async () => {
      const files = await service.getFileTree(repo);

      const logFiles = files.filter(f => f.endsWith('.log'));
      assert.strictEqual(logFiles.length, 0,
        `Expected no .log files, but found: ${logFiles.join(', ')}`);
    });

    it('should include src files in file tree', async () => {
      const files = await service.getFileTree(repo);

      assert.ok(files.includes('src/index.ts'), 'Expected src/index.ts to be included');
      assert.ok(files.includes('src/utils/helper.ts'), 'Expected src/utils/helper.ts to be included');
    });

    it('should include docs and README', async () => {
      const files = await service.getFileTree(repo);

      assert.ok(files.includes('README.md'), 'Expected README.md to be included');
      assert.ok(files.includes('docs/README.md'), 'Expected docs/README.md to be included');
    });

    it('should include package.json', async () => {
      const files = await service.getFileTree(repo);

      assert.ok(files.includes('package.json'), 'Expected package.json to be included');
    });
  });

  describe('getFileTree with custom .cwignore', () => {
    before(async () => {
      // Create a custom .cwignore that also ignores docs
      await writeFile(join(testDir, '.cwignore'), 'docs/');
    });

    after(async () => {
      // Remove custom .cwignore
      try {
        await rm(join(testDir, '.cwignore'));
      } catch {
        // Ignore if doesn't exist
      }
    });

    it('should respect custom .cwignore patterns', async () => {
      clearIgnoreCache();
      const files = await service.getFileTree(repo);

      const docsFiles = files.filter(f => f.startsWith('docs/'));
      assert.strictEqual(docsFiles.length, 0,
        `Expected no docs files when .cwignore excludes docs/, but found: ${docsFiles.join(', ')}`);
    });
  });

  describe('listDirectory', () => {
    it('should exclude node_modules from root directory listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const nodeModulesEntry = entries.find(e => e.name === 'node_modules');
      assert.strictEqual(nodeModulesEntry, undefined,
        'Expected node_modules to be excluded from directory listing');
    });

    it('should exclude dist from root directory listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const distEntry = entries.find(e => e.name === 'dist');
      assert.strictEqual(distEntry, undefined,
        'Expected dist to be excluded from directory listing');
    });

    it('should exclude coverage from root directory listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const coverageEntry = entries.find(e => e.name === 'coverage');
      assert.strictEqual(coverageEntry, undefined,
        'Expected coverage to be excluded from directory listing');
    });

    it('should exclude .env files from root directory listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const envEntries = entries.filter(e => e.name.startsWith('.env'));
      assert.strictEqual(envEntries.length, 0,
        `Expected no .env files, but found: ${envEntries.map(e => e.name).join(', ')}`);
    });

    it('should exclude *.log files from root directory listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const logEntries = entries.filter(e => e.name.endsWith('.log'));
      assert.strictEqual(logEntries.length, 0,
        `Expected no .log files, but found: ${logEntries.map(e => e.name).join(', ')}`);
    });

    it('should include src directory in root listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const srcEntry = entries.find(e => e.name === 'src');
      assert.ok(srcEntry, 'Expected src to be included in directory listing');
      assert.strictEqual(srcEntry.type, 'dir');
    });

    it('should include docs directory in root listing', async () => {
      const entries = await service.listDirectory(repo, '');

      const docsEntry = entries.find(e => e.name === 'docs');
      assert.ok(docsEntry, 'Expected docs to be included in directory listing');
    });

    it('should include regular files in subdirectory listing', async () => {
      const entries = await service.listDirectory(repo, 'src');

      const indexEntry = entries.find(e => e.name === 'index.ts');
      assert.ok(indexEntry, 'Expected index.ts to be included in src listing');

      const utilsEntry = entries.find(e => e.name === 'utils');
      assert.ok(utilsEntry, 'Expected utils to be included in src listing');
    });
  });

  describe('listDirectory with .gitignore patterns', () => {
    before(async () => {
      // Create a .gitignore with additional patterns
      await writeFile(join(testDir, '.gitignore'), '*.pyc\n__pycache__/');

      // Create files matching .gitignore
      await mkdir(join(testDir, '__pycache__'));
      await writeFile(join(testDir, '__pycache__', 'module.cpython-39.pyc'), 'bytecode');
      await writeFile(join(testDir, 'script.pyc'), 'bytecode');
    });

    after(async () => {
      clearIgnoreCache();
      try {
        await rm(join(testDir, '.gitignore'));
        await rm(join(testDir, '__pycache__'), { recursive: true });
        await rm(join(testDir, 'script.pyc'));
      } catch {
        // Ignore if doesn't exist
      }
    });

    it('should respect .gitignore patterns in directory listing', async () => {
      clearIgnoreCache();
      const entries = await service.listDirectory(repo, '');

      const pycacheEntry = entries.find(e => e.name === '__pycache__');
      assert.strictEqual(pycacheEntry, undefined,
        'Expected __pycache__ to be excluded based on .gitignore');

      const pycEntry = entries.find(e => e.name === 'script.pyc');
      assert.strictEqual(pycEntry, undefined,
        'Expected *.pyc files to be excluded based on .gitignore');
    });

    it('should respect .gitignore patterns in file tree', async () => {
      clearIgnoreCache();
      const files = await service.getFileTree(repo);

      const pycacheFiles = files.filter(f => f.includes('__pycache__'));
      assert.strictEqual(pycacheFiles.length, 0,
        `Expected no __pycache__ files, but found: ${pycacheFiles.join(', ')}`);

      const pycFiles = files.filter(f => f.endsWith('.pyc'));
      assert.strictEqual(pycFiles.length, 0,
        `Expected no .pyc files, but found: ${pycFiles.join(', ')}`);
    });
  });
});
