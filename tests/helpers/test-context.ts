/**
 * Test context helpers for integration tests.
 * Creates isolated test environments with real repos and fake LLM.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import simpleGit from 'simple-git';
import { createFileRepositories } from '../../src/repositories/file-based/index.js';
import { FileSystemGitService } from '../../src/services/git/git-service.js';
import { MockLLMService } from './mock-llm.js';
import { clearIgnoreCache } from '../../src/services/cwignore.js';
import type { AgentContext } from '../../src/agents/base-agent.js';
import type { Repositories } from '../../src/repositories/index.js';

export interface TestContext {
  /** Base directory for all test data */
  baseDir: string;
  /** Directory for wiki data storage */
  dataDir: string;
  /** Directory for git repositories */
  reposDir: string;
  /** Real file-based repositories */
  repos: Repositories;
  /** Real git service */
  git: FileSystemGitService;
  /** Mock LLM service */
  llm: MockLLMService;
  /** Create an AgentContext for a repo */
  agentContext(repoId: string): AgentContext;
  /** Clean up all test data */
  cleanup(): Promise<void>;
}

/**
 * Create an isolated test context with real services except LLM.
 */
export async function createTestContext(): Promise<TestContext> {
  const baseDir = await mkdtemp(join(tmpdir(), 'codewiki-test-'));
  const dataDir = join(baseDir, 'data');
  const reposDir = join(baseDir, 'repos');

  await mkdir(dataDir, { recursive: true });
  await mkdir(reposDir, { recursive: true });

  const repos = createFileRepositories(dataDir);
  const git = new FileSystemGitService(reposDir);
  const llm = new MockLLMService();

  return {
    baseDir,
    dataDir,
    reposDir,
    repos,
    git,
    llm,
    agentContext(repoId: string): AgentContext {
      return { repoId, repos, git, llm };
    },
    async cleanup(): Promise<void> {
      clearIgnoreCache();
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

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('commit.gpgsign', 'false');

  // Create default files if none provided
  const filesToCreate = Object.keys(files).length > 0
    ? files
    : { 'README.md': '# Test Repo\n\nThis is a test repository.' };

  for (const [path, content] of Object.entries(filesToCreate)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
  }

  await git.add('.');
  await git.commit('Initial commit');

  // Register repo in the repositories
  await ctx.repos.repos.save({
    id: repoId,
    fullName: `test/${repoId}`,
    cloneUrl: repoPath,
    defaultBranch: 'main',
    status: 'ready',
    config: {
      maxConcurrency: 1,
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
  const git = simpleGit(repoPath);

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
  }

  await git.add('.');
  await git.commit(message);

  const log = await git.log({ maxCount: 1 });
  return log.latest!.hash;
}
