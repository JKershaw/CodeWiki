/**
 * Unit tests for GitService using isomorphic-git.
 * Tests the git operations in isolation with temporary repositories.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as git from 'isomorphic-git';
import * as fs from 'fs';
import { FileSystemGitService } from '../../src/services/git/git-service.js';

describe('GitService (isomorphic-git)', () => {
  let testDir: string;
  let reposDir: string;
  let gitService: FileSystemGitService;

  before(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'git-service-test-'));
    reposDir = join(testDir, 'repos');
    await mkdir(reposDir, { recursive: true });
    gitService = new FileSystemGitService(reposDir);
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a test repository with isomorphic-git.
   */
  async function createTestRepo(repoId: string, files: Record<string, string> = {}): Promise<string> {
    const repoPath = join(reposDir, repoId);
    await mkdir(repoPath, { recursive: true });

    await git.init({ fs, dir: repoPath });
    await git.setConfig({ fs, dir: repoPath, path: 'user.email', value: 'test@example.com' });
    await git.setConfig({ fs, dir: repoPath, path: 'user.name', value: 'Test User' });

    const filesToCreate = Object.keys(files).length > 0
      ? files
      : { 'README.md': '# Test Repo\n\nThis is a test repository.' };

    for (const [filePath, content] of Object.entries(filesToCreate)) {
      const fullPath = join(repoPath, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dir !== repoPath && dir.length > 0) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(fullPath, content);
      await git.add({ fs, dir: repoPath, filepath: filePath });
    }

    await git.commit({
      fs,
      dir: repoPath,
      message: 'Initial commit',
      author: { name: 'Test User', email: 'test@example.com' },
    });

    return repoPath;
  }

  /**
   * Helper to add a commit to a test repository.
   */
  async function addCommit(repoPath: string, files: Record<string, string>, message: string): Promise<string> {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(repoPath, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dir !== repoPath && dir.length > 0) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(fullPath, content);
      await git.add({ fs, dir: repoPath, filepath: filePath });
    }

    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
      author: { name: 'Test User', email: 'test@example.com' },
    });

    return sha;
  }

  describe('registerLocalRepo', () => {
    it('registers a local repository path', async () => {
      const repoId = 'local-repo-1';
      const localPath = '/some/local/path';

      gitService.registerLocalRepo(repoId, localPath);
      const result = gitService.getRepoPath(repoId);

      assert.strictEqual(result, localPath);
    });
  });

  describe('getRepoPath', () => {
    it('returns registered local path if available', () => {
      const repoId = 'path-test-repo';
      const localPath = '/custom/path';

      gitService.registerLocalRepo(repoId, localPath);
      assert.strictEqual(gitService.getRepoPath(repoId), localPath);
    });

    it('returns default path under baseDir if not registered', () => {
      const repoId = 'unregistered-repo';
      const result = gitService.getRepoPath(repoId);
      assert.strictEqual(result, join(reposDir, repoId));
    });
  });

  describe('isCloned', () => {
    it('returns true for existing repository', async () => {
      const repoId = 'cloned-repo';
      await createTestRepo(repoId);

      const result = await gitService.isCloned(repoId);
      assert.strictEqual(result, true);
    });

    it('returns false for non-existent repository', async () => {
      const result = await gitService.isCloned('non-existent-repo');
      assert.strictEqual(result, false);
    });
  });

  describe('loadCommits', () => {
    it('loads all commits from a repository', async () => {
      const repoId = 'commits-repo';
      const repoPath = await createTestRepo(repoId);
      await addCommit(repoPath, { 'file1.ts': 'const x = 1;' }, 'Add file1');
      await addCommit(repoPath, { 'file2.ts': 'const y = 2;' }, 'Add file2');

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId);

      assert.strictEqual(commits.length, 3); // Initial + 2 additional
      assert.ok(commits[0].sha);
      assert.ok(commits[0].message);
      assert.ok(commits[0].authorName);
      assert.ok(commits[0].authorEmail);
      assert.ok(commits[0].committedAt instanceof Date);
    });

    it('loads commits with limit option', async () => {
      const repoId = 'limited-commits-repo';
      const repoPath = await createTestRepo(repoId);
      await addCommit(repoPath, { 'file1.ts': 'const x = 1;' }, 'Add file1');
      await addCommit(repoPath, { 'file2.ts': 'const y = 2;' }, 'Add file2');

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId, { limit: 2 });

      assert.strictEqual(commits.length, 2);
    });

    it('includes diff summary with file counts', async () => {
      const repoId = 'diff-summary-repo';
      const repoPath = await createTestRepo(repoId);
      await addCommit(repoPath, { 'new-file.ts': 'console.log("hello");' }, 'Add new file');

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId, { limit: 1 });

      const commit = commits[0];
      assert.ok(commit.diffSummary);
      assert.ok(commit.diffSummary.affectedFiles.length > 0);
    });
  });

  describe('getCommitDiff', () => {
    it('returns unified diff for a commit', async () => {
      const repoId = 'diff-repo';
      const repoPath = await createTestRepo(repoId, { 'test.ts': 'line1\nline2\n' });
      await addCommit(repoPath, { 'test.ts': 'line1\nline2\nline3\n' }, 'Add line3');

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId, { limit: 1 });
      const diff = await gitService.getCommitDiff(repoId, commits[0].sha);

      assert.ok(diff.includes('line3'));
      assert.ok(diff.includes('+') || diff.includes('-'));
    });

    it('handles initial commit (no parent)', async () => {
      const repoId = 'initial-diff-repo';
      const repoPath = await createTestRepo(repoId, { 'README.md': '# Hello' });

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId);
      const initialCommit = commits[commits.length - 1]; // Oldest commit

      const diff = await gitService.getCommitDiff(repoId, initialCommit.sha);
      assert.ok(diff.includes('README.md') || diff.includes('Hello'));
    });
  });

  describe('getFileAtCommit', () => {
    it('returns file content at specific commit', async () => {
      const repoId = 'file-at-commit-repo';
      const repoPath = await createTestRepo(repoId, { 'config.json': '{"version": 1}' });
      const sha1 = (await gitService.loadCommits(repoId)).pop()?.sha;

      await addCommit(repoPath, { 'config.json': '{"version": 2}' }, 'Update version');

      gitService.registerLocalRepo(repoId, repoPath);

      const oldContent = await gitService.getFileAtCommit(repoId, sha1!, 'config.json');
      assert.strictEqual(oldContent, '{"version": 1}');
    });

    it('returns null for non-existent file', async () => {
      const repoId = 'missing-file-repo';
      const repoPath = await createTestRepo(repoId);

      gitService.registerLocalRepo(repoId, repoPath);
      const commits = await gitService.loadCommits(repoId);

      const content = await gitService.getFileAtCommit(repoId, commits[0].sha, 'nonexistent.txt');
      assert.strictEqual(content, null);
    });
  });

  describe('deleteRepo', () => {
    it('deletes a cloned repository', async () => {
      const repoId = 'to-delete-repo';
      await createTestRepo(repoId);

      assert.strictEqual(await gitService.isCloned(repoId), true);

      await gitService.deleteRepo(repoId);

      assert.strictEqual(await gitService.isCloned(repoId), false);
    });
  });
});
