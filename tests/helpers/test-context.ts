/**
 * Test context helpers for integration tests.
 * Creates isolated test environments with real repos and fake LLM.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as git from 'isomorphic-git';
import * as fs from 'fs';
import { createRepositories, type RepositoryConnection } from '../../src/repositories/index.js';
import { FileSystemGitService } from '../../src/services/git/git-service.js';
import { createRepositoryServiceFactory } from '../../src/services/repository/repository-service.js';
import { createUnifiedRepoAccessFactory } from '../../src/services/repository/unified-repo-access.js';
import { MockLLMService } from './mock-llm.js';
import { clearIgnoreCache } from '../../src/services/cwignore.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { Repositories } from '../../src/repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../src/services/repository/unified-repo-access.js';

export interface TestContext {
  /** Base directory for all test data */
  baseDir: string;
  /** Directory for wiki data storage */
  dataDir: string;
  /** Directory for git repositories */
  reposDir: string;
  /** MongoDB repositories (uses memory-server in tests) */
  repos: Repositories;
  /** Real git service */
  git: FileSystemGitService;
  /** Mock LLM service */
  llm: MockLLMService;
  /** Unified repo access factory */
  repoAccessFactory: UnifiedRepoAccessFactory;
  /** Create an AgentContext for a repo (auto-creates wiki if needed) */
  agentContext(repoId: string): Promise<AgentContext>;
  /** Clean up all test data */
  cleanup(): Promise<void>;
}

/**
 * Create an isolated test context with real services except LLM.
 *
 * Uses MongoDB for storage:
 * - If MONGODB_URI is set, uses that MongoDB instance
 * - Otherwise, uses mongodb-memory-server (in-memory MongoDB)
 */
export async function createTestContext(): Promise<TestContext> {
  const baseDir = await mkdtemp(join(tmpdir(), 'codewiki-test-'));
  const dataDir = join(baseDir, 'data');
  const reposDir = join(baseDir, 'repos');

  await mkdir(dataDir, { recursive: true });
  await mkdir(reposDir, { recursive: true });

  // Use the async factory - auto-detects MongoDB vs memory-server
  const connection = await createRepositories();
  const repos = connection.repositories;
  const gitService = new FileSystemGitService(reposDir);
  const llm = new MockLLMService();

  // Create repository service factory for unified access
  const repoServiceFactory = createRepositoryServiceFactory({
    gitService,
  });

  // Create unified repo access factory
  const repoAccessFactory = createUnifiedRepoAccessFactory({
    repos,
    repoServiceFactory,
    gitService,
  });

  return {
    baseDir,
    dataDir,
    reposDir,
    repos,
    git: gitService,
    llm,
    repoAccessFactory,
    async agentContext(repoId: string): Promise<AgentContext> {
      const wiki = await getOrCreateActiveWiki(repoId, repos);

      // Create unified repo access for the test repo
      let repoAccess;
      try {
        repoAccess = await repoAccessFactory.create(repoId);
      } catch {
        // Repo might not be registered yet, continue without repoAccess
      }

      return {
        repoId,
        wikiId: wiki.id,
        repos,
        llm,
        ...(repoAccess && { repoAccess }),
      };
    },
    async cleanup(): Promise<void> {
      clearIgnoreCache();
      await connection.close();
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a test git repository with some commits.
 */
export async function createTestRepo(
  ctx: TestContext,
  repoId: string,
  files: Record<string, string> = {}
): Promise<string> {
  const repoPath = join(ctx.reposDir, repoId);
  await mkdir(repoPath, { recursive: true });

  await git.init({ fs, dir: repoPath });
  await git.setConfig({ fs, dir: repoPath, path: 'user.email', value: 'test@example.com' });
  await git.setConfig({ fs, dir: repoPath, path: 'user.name', value: 'Test User' });

  // Create default files if none provided
  const filesToCreate = Object.keys(files).length > 0
    ? files
    : { 'README.md': '# Test Repo\n\nThis is a test repository.' };

  for (const [path, content] of Object.entries(filesToCreate)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath && dir.length > 0) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
    await git.add({ fs, dir: repoPath, filepath: path });
  }

  await git.commit({
    fs,
    dir: repoPath,
    message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });

  // Register repo with git service for local access
  ctx.git.registerLocalRepo(repoId, repoPath);

  // Register repo in the repositories
  await ctx.repos.repos.save({
    id: repoId,
    fullName: `test/${repoId}`,
    cloneUrl: repoPath,
    defaultBranch: 'main',
    status: 'ready',
    config: {
      throttle: { maxCallsPerMinute: 100, maxCostPerHour: 10 },
      enabledAgents: ['code-change'],
    },
    createdAt: new Date(),
    lastProcessedAt: null,
  });

  return repoPath;
}

/**
 * Add a commit to a test repository.
 */
export async function addCommit(
  ctx: TestContext,
  repoId: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  const repoPath = join(ctx.reposDir, repoId);

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath && dir.length > 0) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
    await git.add({ fs, dir: repoPath, filepath: path });
  }

  const sha = await git.commit({
    fs,
    dir: repoPath,
    message,
    author: { name: 'Test User', email: 'test@example.com' },
  });

  return sha;
}
